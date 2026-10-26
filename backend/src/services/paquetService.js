// ============================================================================
// paquetService — export « paquet d'archive » (migration 035 ; le paquet
// d'information diffusé d'un SAE, OAIS/NF Z42-013).
//
// Un ZIP autonome, lisible sans DocuFlow :
//   fichiers/<référence>/v<n>-<nom>   les fichiers (version courante, ou toutes)
//   manifeste.json                    organisation, export, et pour chaque
//                                     document : fiche, propriétés de classe,
//                                     fichiers et empreintes SHA-256, intégrité,
//                                     gel, événements du journal chaîné
//   empreintes.sha256                 vérifiable par « sha256sum -c »
//   index.html                        sommaire consultable hors ligne
// Les empreintes sont RECALCULÉES sur les octets exportés, et comparées à
// celles de l'archivage : un écart est signalé dans le manifeste. L'export
// est journalisé (PAQUET_EXPORTE) avec l'empreinte du ZIP entier.
// ============================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../config/db');
const aclService = require('./aclService');
const integrite = require('./integriteService');
const documentAuditService = require('./documentAuditService');
const { EcrivainZip, segmentSur } = require('../helpers/zip');

const MAX_DOCUMENTS = 200;
const erreur = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Octets d'un fichier stocké (disque ou Cloudinary) ; null si introuvable. */
async function lireOctets(f) {
  if (!f.cloudinary_public_id) {
    const { FILES_DIR } = require('../config/paths');
    const chemin = path.join(FILES_DIR, f.stored_name || '');
    return f.stored_name && fs.existsSync(chemin) ? fs.readFileSync(chemin) : null;
  }
  const url = require('./storageService').signedCloudinaryUrl(f);
  if (!url) return null;
  try {
    return Buffer.from((await module.exports.http.get(url, { responseType: 'arraybuffer', timeout: 120000 })).data);
  } catch (err) {
    if (err.response && [404, 410].includes(err.response.status)) return null;
    throw err;
  }
}

/**
 * Prépare l'export : documents lisibles par l'utilisateur, hors corbeille,
 * volume borné. Lève 400/403/404/413 avant d'écrire le moindre octet.
 */
async function preparer(tenantId, user, ids, { versions = 'courante' } = {}) {
  const liste = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!liste.length) throw erreur(400, 'Aucun document à exporter.');
  if (liste.length > MAX_DOCUMENTS) throw erreur(400, `${MAX_DOCUMENTS} documents au plus par paquet.`);
  const { rows: docs } = await db.query(
    `SELECT d.*, c.name AS classe_nom, fo.name AS dossier_nom
       FROM documents d
       LEFT JOIN metadata_schemas c ON c.id = d.classe_id AND c.tenant_id = d.tenant_id
       LEFT JOIN document_folders fo ON fo.id = d.dossier_id AND fo.tenant_id = d.tenant_id
      WHERE d.tenant_id = $1 AND d.id = ANY($2::int[]) AND d.deleted_at IS NULL`,
    [tenantId, liste]
  );
  if (docs.length !== liste.length) throw erreur(404, 'Document introuvable (ou en corbeille).');
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  if (docs.some((d) => d.dossier_id !== null && !lisibles.has(d.dossier_id))) {
    throw erreur(403, 'Un des documents appartient à un dossier hors de votre périmètre.', 'HORS_PERIMETRE');
  }
  const { rows: fichiers } = await db.query(
    `SELECT f.* FROM document_files f WHERE f.document_id = ANY($1::int[])
        ${versions === 'toutes' ? '' : 'AND f.version = (SELECT max(version) FROM document_files g WHERE g.document_id = f.document_id)'}
      ORDER BY f.document_id, f.version`,
    [liste]
  );
  const volume = fichiers.reduce((s, f) => s + Number(f.file_size || 0), 0);
  const maxMo = Number((await require('./settingsService').getAll(tenantId)).export_taille_max_mo) || 500;
  if (volume > maxMo * 1048576) throw erreur(413, `Paquet trop volumineux (${Math.ceil(volume / 1048576)} Mo, ${maxMo} Mo au plus) : réduisez la sélection.`, 'PAQUET_TROP_GROS');
  return { docs, fichiers, volume };
}

async function proprietes(documentIds) {
  const { rows } = await db.query(
    `SELECT v.document_id, f.label, f.type, v.value_json
       FROM metadata_values v JOIN metadata_fields f ON f.id = v.field_id
      WHERE v.document_id = ANY($1::int[]) ORDER BY f.display_order, f.id`,
    [documentIds]
  );
  return rows;
}

async function evenements(tenantId, documentIds) {
  const { rows } = await db.query(
    `SELECT a.object_id AS document_id, a.action, COALESCE(a.occurred_at, a."timestamp") AS date,
            COALESCE(a.actor_username, a.user_name) AS acteur, a.chaine_rang, a.chaine_hash::text AS chaine_hash
       FROM audit_logs a
      WHERE a.tenant_id = $1 AND a.object_type = 'document' AND a.object_id = ANY($2::int[])
      ORDER BY COALESCE(a.occurred_at, a."timestamp"), a.id`,
    [tenantId, documentIds]
  );
  return rows;
}

/**
 * Écrit le paquet dans `ecrire` (flux de la réponse HTTP).
 * @returns {Promise<{empreinte: string, octets: number, documents: number, fichiers: number, ecarts: number}>}
 */
async function exporter(tenantId, user, prepare, ecrire, { ip = null } = {}) {
  const { docs, fichiers } = prepare;
  const ids = docs.map((d) => d.id);
  const [props, evts, tete, organisation] = await Promise.all([
    proprietes(ids), evenements(tenantId, ids), integrite.teteChaine(tenantId),
    db.query('SELECT name FROM tenants WHERE id = $1', [tenantId]).then((r) => r.rows[0]?.name || ''),
  ]);
  const gels = await integrite.documentsGeles(tenantId, ids);
  const qui = await integrite.identite(user);

  const empreinteZip = crypto.createHash('sha256');
  let octets = 0;
  const zip = new EcrivainZip(async (b) => { empreinteZip.update(b); octets += b.length; await ecrire(b); });
  const lignesSha = [];
  let ecarts = 0;
  const manifeste = {
    format: 'DocuFlow — paquet d\'archive', version_format: 1,
    organisation, exporte_le: new Date().toISOString(), exporte_par: qui.nom,
    journal: { rang: tete.rang, empreinte: tete.hash },
    documents: [],
  };

  for (const d of docs) {
    const dossierZip = `fichiers/${segmentSur(d.reference_mfile || `document-${d.id}`)}`;
    const entree = {
      reference: d.reference_mfile, entreprise: d.nom_entreprise, numero_dossier: d.num_dossier, numero_acte: d.num_acte,
      annee: d.annee, type: d.type_document, classe: d.classe_nom, classement: d.dossier_nom, statut: d.statut,
      date_document: d.date_document, cree_le: d.created_at, description: d.description, etiquettes: d.tags || [],
      gel_juridique: gels.has(d.id),
      proprietes: props.filter((p) => p.document_id === d.id).map((p) => ({ libelle: p.label, type: p.type, valeur: p.value_json })),
      fichiers: [],
      evenements: evts.filter((e) => e.document_id === d.id).map((e) => ({
        action: e.action, date: e.date, acteur: e.acteur, rang: e.chaine_rang === null ? null : Number(e.chaine_rang), empreinte: e.chaine_hash,
      })),
    };
    for (const f of fichiers.filter((x) => x.document_id === d.id)) {
      const contenu = await lireOctets(f);
      const archivage = f.empreinte_sha256 ? f.empreinte_sha256.trim() : null;
      const fiche = { version: f.version, nom: f.original_name, type: f.mime_type, taille: f.file_size, empreinte_archivage: archivage, integrite: f.integrite_statut };
      if (!contenu) {
        entree.fichiers.push({ ...fiche, chemin: null, absent: true });
        ecarts += 1;
        continue;
      }
      const chemin = `${dossierZip}/v${f.version}-${segmentSur(f.original_name)}`;
      const empreinte = sha(contenu);
      if (archivage && archivage !== empreinte) ecarts += 1;
      await zip.ajouter(chemin, contenu, { typeMime: f.mime_type });
      lignesSha.push(`${empreinte}  ${chemin}`);
      entree.fichiers.push({ ...fiche, chemin, empreinte_exportee: empreinte, conforme: archivage ? archivage === empreinte : null });
    }
    manifeste.documents.push(entree);
  }

  const json = Buffer.from(JSON.stringify(manifeste, null, 2), 'utf8');
  await zip.ajouter('manifeste.json', json);
  lignesSha.push(`${sha(json)}  manifeste.json`);
  await zip.ajouter('empreintes.sha256', `${lignesSha.join('\n')}\n`);
  await zip.ajouter('index.html', pageIndex(manifeste));
  await zip.terminer(`Paquet d'archive DocuFlow — ${organisation} — ${manifeste.exporte_le}`);

  const empreinte = empreinteZip.digest('hex');
  for (const d of docs) {
    await documentAuditService.logAction({
      tenantId, documentId: d.id, userId: qui.id, username: qui.username, ipAddress: ip,
      action: 'PAQUET_EXPORTE', details: { empreinte_paquet: empreinte, documents: docs.length, octets },
    });
  }
  return { empreinte, octets, documents: docs.length, fichiers: lignesSha.length - 1, ecarts };
}

function pageIndex(m) {
  const lignes = m.documents.map((d) => `
    <section><h2>${echapper(d.reference)} — ${echapper(d.entreprise)}</h2>
      <p>${echapper(d.classe || d.type || 'Document')} · ${echapper(d.annee)} · statut ${echapper(d.statut)}${d.gel_juridique ? ' · <strong>gel juridique</strong>' : ''}</p>
      ${d.proprietes.length ? `<dl>${d.proprietes.map((p) => `<dt>${echapper(p.libelle)}</dt><dd>${echapper(typeof p.valeur === 'object' ? JSON.stringify(p.valeur) : p.valeur)}</dd>`).join('')}</dl>` : ''}
      <table><tr><th>Version</th><th>Fichier</th><th>SHA-256</th><th>Contrôle</th></tr>
      ${d.fichiers.map((f) => `<tr><td>v${f.version}</td><td>${f.chemin ? `<a href="${echapper(f.chemin)}">${echapper(f.nom)}</a>` : `${echapper(f.nom)} (absent du stockage)`}</td>
        <td><code>${echapper(f.empreinte_exportee || f.empreinte_archivage || '—')}</code></td>
        <td>${f.conforme === false ? 'ÉCART avec l\'empreinte d\'archivage' : f.conforme ? 'conforme' : '—'}</td></tr>`).join('')}</table>
      <p class="petit">${d.evenements.length} événement(s) au journal.</p></section>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paquet d'archive — ${echapper(m.organisation)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#0f172a}h1{font-size:22px}h2{font-size:16px;margin-top:2rem}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e2e8f0;padding:4px 6px;text-align:left;vertical-align:top}code{font-size:11px;word-break:break-all}
dl{display:grid;grid-template-columns:200px 1fr;gap:2px 12px}dt{color:#64748b}.petit{color:#64748b;font-size:12px}</style></head>
<body><h1>Paquet d'archive — ${echapper(m.organisation)}</h1>
<p>Exporté le ${echapper(new Date(m.exporte_le).toLocaleString('fr-FR'))} par ${echapper(m.exporte_par)} · ${m.documents.length} document(s).
Journal chaîné au maillon n° ${m.journal.rang}. Vérifiez les fichiers avec <code>sha256sum -c empreintes.sha256</code>.</p>${lignes}</body></html>`;
}

module.exports = { MAX_DOCUMENTS, preparer, exporter, lireOctets, pageIndex, http: axios };
