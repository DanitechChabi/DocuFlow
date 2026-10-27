// ============================================================================
// versementService — bordereaux de versement (migration 036), décret
// n° 2007-532 du 2 novembre 2007, art. 42 à 47 :
//   - chaque année, les services versent au dépôt de PRÉ-ARCHIVAGE les
//     documents dont la valeur administrative n'est plus immédiate (art. 46) ;
//   - le pré-archivage verse aux ARCHIVES PUBLIQUES les documents qui ont
//     atteint dix ans (art. 46), selon des modalités fixées avec la DAN (art. 47).
//
//   BROUILLON        l'archiviste compose la liste descriptive (art. 45) ;
//   TRANSMIS         la liste est figée, imprimée, son empreinte calculée ;
//   PRIS EN CHARGE   le service d'archives a signé le récépissé : les
//                    documents sont marqués versés (verse_at), archivés, et
//                    restent consultables dans DocuFlow ;
//   ANNULÉ           avant la prise en charge seulement.
//
// Chaque ligne garde l'instantané du document (comme un bordereau
// d'élimination) ; un bordereau pris en charge est inaltérable (base).
// ============================================================================
const db = require('../config/db');
const integrite = require('./integriteService');
const stateMachine = require('./documentStateMachine');
const archivage = require('./archivageService');

const { organisationDe, lireEcheances, fichiersDe, instantane, perimetre, journaliser, historique, transaction, erreur, jourDe } = archivage.internes;

const DESTINATIONS = { pre_archivage: 'Dépôt de pré-archivage', archives_publiques: 'Archives publiques' };
const STATUTS = ['brouillon', 'transmis', 'pris_en_charge', 'annule'];
const OUVERTS = ['brouillon', 'transmis'];
// Art. 46 : le pré-archivage verse aux archives publiques à dix ans.
const AGE_ARCHIVES_PUBLIQUES = 10;
// Statuts depuis lesquels un document peut entrer en archives (ni brouillon
// d'indexation, ni circuit de validation en cours).
const STATUTS_VERSABLES = ['disponible', 'prêt', 'archivé'];

const MOTIFS = {
  introuvable: 'Document introuvable ou hors de votre périmètre.',
  elimine: 'Document éliminé.',
  corbeille: 'Document en corbeille.',
  verse: 'Document déjà versé.',
  statut: "Document pas encore prêt à être archivé (indexation ou validation en cours).",
  autre_versement: 'Déjà inscrit sur un autre bordereau de versement en cours.',
  bordereau_elimination: "Inscrit sur un bordereau d'élimination en cours.",
  sort_elimination: "Son sort final est l'élimination : il ne se verse pas aux archives publiques.",
  trop_recent: `Il n'a pas atteint ${AGE_ARCHIVES_PUBLIQUES} ans ni le terme de sa DUA (décret n° 2007-532, art. 46).`,
};

/** Âge en années révolues entre deux jours 'YYYY-MM-DD'. */
function ageEnAnnees(depuis, jusqua) {
  if (!depuis) return null;
  const [a1, m1, j1] = depuis.split('-').map(Number);
  const [a2, m2, j2] = jusqua.split('-').map(Number);
  return a2 - a1 - ((m2 < m1 || (m2 === m1 && j2 < j1)) ? 1 : 0);
}

/**
 * Pourquoi ce document ne peut pas entrer sur ce bordereau (null : il le peut).
 * `r` vient de lireEcheances, complété de verse_at et des bordereaux ouverts.
 */
function motifNonVersable(r, destination, { versementId = null, aujourdhui = jourDe(new Date()) } = {}) {
  if (!r) return 'introuvable';
  if (r.elimine_at) return 'elimine';
  if (r.deleted_at) return 'corbeille';
  if (r.verse_at) return 'verse';
  if (!STATUTS_VERSABLES.includes(r.statut)) return 'statut';
  if (r.versement_id && Number(r.versement_id) !== Number(versementId)) return 'autre_versement';
  if (r.bordereau_id) return 'bordereau_elimination';
  if (destination === 'archives_publiques') {
    const decision = r.decision?.decision || r.decision || null;
    if (r.sort_final === 'elimination' && decision !== 'conservation') return 'sort_elimination';
    const age = ageEnAnnees(r.date_document || jourDe(r.created_at), aujourdhui);
    const echu = r.echeance && Number(r.jours_restants) <= 0;
    if (!echu && !(age !== null && age >= AGE_ARCHIVES_PUBLIQUES)) return 'trop_recent';
  }
  return null;
}

/** Échéances + état de versement des documents désignés. */
async function etatsDe(run, tenantId, ids) {
  const etats = await lireEcheances(run, tenantId, ids);
  if (!ids.length) return etats;
  const { rows } = await run.query(
    `SELECT d.id, d.verse_at,
            (SELECT v.id FROM versement_documents l JOIN bordereaux_versement v ON v.id = l.versement_id
              WHERE l.document_id = d.id AND v.statut IN ('brouillon', 'transmis') ORDER BY v.id DESC LIMIT 1) AS versement_id
       FROM documents d WHERE d.id = ANY($1::int[]) AND d.tenant_id = $2`, [ids, tenantId]);
  for (const x of rows) {
    const r = etats.get(x.id);
    if (r) Object.assign(r, { verse_at: x.verse_at, versement_id: x.versement_id });
  }
  return etats;
}

const SQL_LIGNES = `
  SELECT l.id, l.versement_id, l.document_id, l.ordre, l.reference, l.intitule, l.classe, l.dossier, l.annee,
         to_char(l.date_document, 'YYYY-MM-DD') AS date_document, to_char(l.echeance, 'YYYY-MM-DD') AS echeance,
         l.sort_final, l.communicabilite, l.nb_fichiers, l.volume_octets, l.fichiers, l.ajoute_at,
         d.dossier_id AS dossier_actuel
    FROM versement_documents l LEFT JOIN documents d ON d.id = l.document_id
   WHERE l.versement_id = $1
   ORDER BY l.ordre, l.id`;

const lignesDe = async (run, id) => (await run.query(SQL_LIGNES, [id])).rows.map((l) => ({
  ...l, volume_octets: Number(l.volume_octets), fichiers: l.fichiers || [],
}));

async function charger(run, tenantId, id, { verrou = false } = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw erreur(400, 'Identifiant de bordereau invalide.');
  const { rows } = await run.query(
    `SELECT * FROM bordereaux_versement WHERE id = $1 AND tenant_id = $2${verrou ? ' FOR UPDATE' : ''}`, [n, tenantId]);
  if (!rows[0]) throw erreur(404, 'Bordereau de versement introuvable.');
  return rows[0];
}

const vers = (b) => ({ ...b, empreinte: b.empreinte ? String(b.empreinte).trim() : null, destination_libelle: DESTINATIONS[b.destination] });

async function ecrireInstantane(run, ligneId, r, fichiers) {
  const s = instantane(r, fichiers);
  await run.query(
    `UPDATE versement_documents SET reference = $2, intitule = $3, classe = $4, dossier = $5, annee = $6, date_document = $7,
            echeance = $8, sort_final = $9, communicabilite = $10, nb_fichiers = $11, volume_octets = $12, fichiers = $13
      WHERE id = $1`,
    [ligneId, s.reference, s.intitule, s.classe, s.dossier, s.annee, s.date_document, s.echeance, s.sort_final,
      r.communicabilite || null, s.nb_fichiers, s.volume_octets, JSON.stringify(s.fichiers)]);
}

/** Contenu canonique du bordereau transmis (ce que couvre son empreinte). */
function corps(b, lignes) {
  return {
    numero: b.numero, intitule: b.intitule, destination: b.destination, service_destinataire: b.service_destinataire,
    transmis_par: b.transmis_par_nom, transmis_at: b.transmis_at ? new Date(b.transmis_at).toISOString() : null,
    lignes: lignes.map((l) => ({
      ordre: l.ordre, reference: l.reference, intitule: l.intitule, classe: l.classe, date_document: l.date_document,
      fichiers: (l.fichiers || []).map((f) => ({ version: f.version, empreinte: f.empreinte_sha256 || null })),
    })),
  };
}
const empreinte = (b, lignes) => integrite.empreinteTampon(Buffer.from(JSON.stringify(corps(b, lignes)), 'utf8'));

async function prochainNumero(run, tenantId) {
  const annee = new Date().getFullYear();
  const { rows } = await run.query(
    `INSERT INTO versements_compteurs (tenant_id, annee, dernier) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, annee) DO UPDATE SET dernier = versements_compteurs.dernier + 1
     RETURNING dernier`, [tenantId, annee]);
  return `BV-${annee}-${String(rows[0].dernier).padStart(4, '0')}`;
}

async function inscrire(c, tenantId, v, ids, lisible) {
  const liste = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!liste.length) return { ajoutes: [], refuses: [] };
  if (liste.length > 1000) throw erreur(400, 'Un bordereau compte au plus 1 000 documents par ajout.');
  await c.query('SELECT id FROM documents WHERE id = ANY($1::int[]) AND tenant_id = $2 ORDER BY id FOR UPDATE', [liste, tenantId]);
  const etats = await etatsDe(c, tenantId, liste);
  let ordre = (await c.query('SELECT COALESCE(max(ordre), 0) AS o FROM versement_documents WHERE versement_id = $1', [v.id])).rows[0].o;
  const ajoutes = [];
  const refuses = [];
  for (const id of liste) {
    const r = etats.get(id);
    let motif = !r || !lisible(r.dossier_id) ? 'introuvable' : motifNonVersable(r, v.destination, { versementId: v.id });
    if (!motif && Number(r.versement_id) === v.id) motif = 'deja';
    if (motif) { refuses.push({ id, motif: motif === 'deja' ? 'Déjà inscrit sur ce bordereau.' : MOTIFS[motif] }); continue; }
    ordre += 1;
    const { rows } = await c.query(
      'INSERT INTO versement_documents (versement_id, tenant_id, document_id, ordre) VALUES ($1, $2, $3, $4) RETURNING id',
      [v.id, tenantId, id, ordre]);
    await ecrireInstantane(c, rows[0].id, r, await fichiersDe(c, id));
    ajoutes.push(id);
  }
  return { ajoutes, refuses };
}

async function lister(tenantId) {
  const { rows } = await db.query(
    `SELECT v.*, count(l.id)::int AS nb_documents, COALESCE(sum(l.volume_octets), 0)::bigint AS volume_octets
       FROM bordereaux_versement v LEFT JOIN versement_documents l ON l.versement_id = v.id
      WHERE v.tenant_id = $1 GROUP BY v.id
      ORDER BY (v.statut IN ('brouillon', 'transmis')) DESC, v.created_at DESC LIMIT 500`, [tenantId]);
  return rows.map((r) => ({ ...vers(r), volume_octets: Number(r.volume_octets) }));
}

async function detail(tenantId, id, user) {
  const v = await charger(db, tenantId, id);
  const lisible = await perimetre(tenantId, user.id);
  const lignes = (await lignesDe(db, v.id)).map((l) => {
    const { dossier_actuel: d, ...reste } = l;
    return lisible(d) ? { ...reste, masque: false } : { id: l.id, ordre: l.ordre, masque: true, nb_fichiers: l.nb_fichiers, volume_octets: l.volume_octets };
  });
  const calculee = v.statut === 'brouillon' ? null : empreinte(v, await lignesDe(db, v.id));
  return {
    ...vers(v),
    organisation: await organisationDe(tenantId),
    lignes,
    totaux: {
      documents: lignes.length,
      fichiers: lignes.reduce((s, l) => s + (l.nb_fichiers || 0), 0),
      volume_octets: lignes.reduce((s, l) => s + (l.volume_octets || 0), 0),
      masques: lignes.filter((l) => l.masque).length,
      dates_extremes: (() => {
        const dates = lignes.map((l) => l.date_document).filter(Boolean).sort();
        return dates.length ? { debut: dates[0], fin: dates[dates.length - 1] } : null;
      })(),
    },
    empreinte_conforme: calculee && v.empreinte ? calculee === String(v.empreinte).trim() : null,
  };
}

async function creer(tenantId, body = {}, user) {
  const destination = body.destination || 'pre_archivage';
  if (!DESTINATIONS[destination]) throw erreur(400, 'Destination attendue : dépôt de pré-archivage ou archives publiques.');
  const titre = String(body.intitule || '').trim();
  if (titre.length > 200) throw erreur(400, 'Intitulé trop long (200 caractères au plus).');
  const service = String(body.service_destinataire || '').trim().slice(0, 200) || null;
  const lisible = await perimetre(tenantId, user.id);
  const qui = await integrite.identite(user);
  return transaction(async (c) => {
    const numero = await prochainNumero(c, tenantId);
    const { rows } = await c.query(
      `INSERT INTO bordereaux_versement (tenant_id, numero, intitule, destination, service_destinataire, commentaire, created_by, created_by_nom)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tenantId, numero, titre || `Versement ${numero}`, destination, service, String(body.commentaire || '').trim() || null, qui.id, qui.nom]);
    const v = rows[0];
    const r = await inscrire(c, tenantId, v, body.document_ids, lisible);
    await journaliser(c, { tenantId, qui, action: 'VERSEMENT_CREE', objectType: 'bordereau_versement', objectId: v.id, details: { numero, destination, documents: r.ajoutes.length } });
    return { versement: vers(v), ...r };
  });
}

async function ajouter(tenantId, id, ids, user) {
  const lisible = await perimetre(tenantId, user.id);
  return transaction(async (c) => {
    const v = await charger(c, tenantId, id, { verrou: true });
    if (v.statut !== 'brouillon') throw erreur(409, 'Seul un bordereau en brouillon se complète.', 'STATUT_VERSEMENT');
    return inscrire(c, tenantId, v, ids, lisible);
  });
}

async function retirer(tenantId, id, documentId, user) {
  const lisible = await perimetre(tenantId, user.id);
  return transaction(async (c) => {
    const v = await charger(c, tenantId, id, { verrou: true });
    if (v.statut !== 'brouillon') throw erreur(409, 'Seul un bordereau en brouillon se modifie.', 'STATUT_VERSEMENT');
    const { rows } = await c.query(
      `SELECT l.id, d.dossier_id FROM versement_documents l LEFT JOIN documents d ON d.id = l.document_id
        WHERE l.versement_id = $1 AND l.document_id = $2`, [v.id, Number(documentId)]);
    if (!rows[0] || !lisible(rows[0].dossier_id)) throw erreur(404, 'Ce document ne figure pas sur le bordereau.');
    await c.query('DELETE FROM versement_documents WHERE id = $1', [rows[0].id]);
    return { retire: Number(documentId) };
  });
}

async function exigerPerimetre(c, tenantId, v, user) {
  const lisible = await perimetre(tenantId, user.id);
  const lignes = await lignesDe(c, v.id);
  const hors = lignes.filter((l) => !lisible(l.dossier_actuel)).length;
  if (hors) throw erreur(403, `Ce bordereau compte ${hors} document(s) hors de votre périmètre : un autre que vous doit le traiter.`, 'HORS_PERIMETRE');
  return lignes;
}

/** TRANSMISSION : éligibilité revérifiée, instantanés rafraîchis, empreinte figée. */
async function transmettre(tenantId, id, user) {
  const qui = await integrite.identite(user);
  return transaction(async (c) => {
    const v = await charger(c, tenantId, id, { verrou: true });
    if (v.statut !== 'brouillon') throw erreur(409, 'Seul un bordereau en brouillon se transmet.', 'STATUT_VERSEMENT');
    const lignes = await exigerPerimetre(c, tenantId, v, user);
    if (!lignes.length) throw erreur(400, 'Un bordereau vide ne se transmet pas : ajoutez des documents.');
    const ids = lignes.filter((l) => l.document_id).map((l) => l.document_id);
    const etats = await etatsDe(c, tenantId, ids);
    const bloquants = [];
    for (const l of lignes) {
      const r = l.document_id ? etats.get(l.document_id) : null;
      const motif = r ? motifNonVersable(r, v.destination, { versementId: v.id }) : 'introuvable';
      if (motif) bloquants.push({ document_id: l.document_id, reference: l.reference, motif: MOTIFS[motif] });
      else await ecrireInstantane(c, l.id, r, await fichiersDe(c, r.id));
    }
    if (bloquants.length) {
      throw erreur(409, `${bloquants.length} document(s) ne sont plus versables : retirez-les avant de transmettre.`, 'LIGNES_NON_VERSABLES', { lignes: bloquants });
    }
    let r = (await c.query(
      `UPDATE bordereaux_versement SET statut = 'transmis', transmis_par = $2, transmis_par_nom = $3, transmis_at = now(), updated_at = now()
        WHERE id = $1 AND statut = 'brouillon' RETURNING *`, [v.id, qui.id, qui.nom])).rows[0];
    const e = empreinte(r, await lignesDe(c, v.id));
    r = (await c.query('UPDATE bordereaux_versement SET empreinte = $2 WHERE id = $1 RETURNING *', [v.id, e])).rows[0];
    await journaliser(c, { tenantId, qui, action: 'VERSEMENT_TRANSMIS', objectType: 'bordereau_versement', objectId: v.id, details: { numero: v.numero, documents: lignes.length, empreinte: e } });
    return vers(r);
  });
}

/**
 * PRISE EN CHARGE : le service d'archives a signé le récépissé. Les documents
 * sont marqués versés et archivés ; un versement aux archives publiques vaut
 * décision de sort final (versement).
 */
async function priseEnCharge(tenantId, id, body = {}, user) {
  const qui = await integrite.identite(user);
  const numero = String(body.recepisse_numero || '').trim();
  if (!numero) throw erreur(400, 'Le numéro du récépissé est obligatoire.');
  if (numero.length > 100) throw erreur(400, 'Numéro de récépissé trop long (100 caractères au plus).');
  const date = String(body.recepisse_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw erreur(400, 'Date du récépissé attendue (AAAA-MM-JJ).');
  if (date > jourDe(new Date())) throw erreur(400, 'La date du récépissé ne peut pas être dans le futur.');
  const agent = String(body.pris_en_charge_par_nom || '').trim().slice(0, 150) || null;
  const piece = body.piece_document_id ? Number(body.piece_document_id) : null;
  const lisible = await perimetre(tenantId, user.id);
  return transaction(async (c) => {
    const v = await charger(c, tenantId, id, { verrou: true });
    if (v.statut !== 'transmis') throw erreur(409, 'Seul un bordereau transmis est pris en charge.', 'STATUT_VERSEMENT');
    const lignes = await exigerPerimetre(c, tenantId, v, user);
    if (piece) {
      const d = (await c.query('SELECT dossier_id FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [piece, tenantId])).rows[0];
      if (!d || !lisible(d.dossier_id)) throw erreur(400, "Pièce introuvable : versez d'abord le récépissé dans la GED.");
    }
    const ids = lignes.filter((l) => l.document_id).map((l) => l.document_id);
    if (ids.length) await c.query('SELECT id FROM documents WHERE id = ANY($1::int[]) AND tenant_id = $2 ORDER BY id FOR UPDATE', [ids, tenantId]);
    const etats = await etatsDe(c, tenantId, ids);
    for (const docId of ids) {
      const r = etats.get(docId);
      if (!r || r.elimine_at || r.deleted_at) continue;
      if (r.statut !== 'archivé' && stateMachine.canTransition(r.statut, 'archivé').ok) {
        await c.query("UPDATE documents SET statut = 'archivé', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [docId]);
      }
      await c.query('UPDATE documents SET verse_at = now(), verse_versement_id = $2 WHERE id = $1', [docId, v.id]);
      if (v.destination === 'archives_publiques' && !r.decision) {
        await c.query(
          `INSERT INTO decisions_sort_final (tenant_id, document_id, decision, note, decide_par, decide_par_nom)
           VALUES ($1, $2, 'versement', $3, $4, $5) ON CONFLICT (document_id) DO NOTHING`,
          [tenantId, docId, `Bordereau de versement ${v.numero}, récépissé ${numero}`, qui.id, qui.nom]);
      }
      await historique(c, docId, user.id, `Versé — ${DESTINATIONS[v.destination].toLowerCase()} (bordereau ${v.numero})`,
        `Récépissé ${numero} du ${date}${agent ? `, ${agent}` : ''}`, r.statut !== 'archivé' ? r.statut : null, r.statut !== 'archivé' ? 'archivé' : null);
      await journaliser(c, { tenantId, qui, action: 'DOCUMENT_VERSE', objectId: docId, details: { versement: v.numero, destination: v.destination, recepisse: numero } });
    }
    const r = (await c.query(
      `UPDATE bordereaux_versement SET statut = 'pris_en_charge', recepisse_numero = $2, recepisse_date = $3, recepisse_piece_document_id = $4,
              pris_en_charge_par_nom = $5, enregistre_par = $6, enregistre_par_nom = $7, enregistre_at = now(), updated_at = now()
        WHERE id = $1 AND statut = 'transmis' RETURNING *`, [v.id, numero, date, piece, agent, qui.id, qui.nom])).rows[0];
    await journaliser(c, { tenantId, qui, action: 'VERSEMENT_PRIS_EN_CHARGE', objectType: 'bordereau_versement', objectId: v.id, details: { numero: v.numero, recepisse: numero, documents: ids.length } });
    return vers(r);
  });
}

async function annuler(tenantId, id, { motif } = {}, user) {
  const qui = await integrite.identite(user);
  const texte = String(motif || '').trim().slice(0, 2000);
  return transaction(async (c) => {
    const v = await charger(c, tenantId, id, { verrou: true });
    if (!OUVERTS.includes(v.statut)) throw erreur(409, 'Ce bordereau ne s\'annule plus.', 'STATUT_VERSEMENT');
    const r = (await c.query(
      `UPDATE bordereaux_versement SET statut = 'annule', annule_par = $2, annule_par_nom = $3, annule_at = now(), motif_annulation = $4, updated_at = now()
        WHERE id = $1 RETURNING *`, [v.id, qui.id, qui.nom, texte || null])).rows[0];
    await journaliser(c, { tenantId, qui, action: 'VERSEMENT_ANNULE', objectType: 'bordereau_versement', objectId: v.id, details: { numero: v.numero, motif: texte || null } });
    return vers(r);
  });
}

/** Identifiants des documents d'un bordereau lisibles par l'utilisateur (export du paquet). */
async function documentsExportables(tenantId, id, user) {
  const v = await charger(db, tenantId, id);
  const lisible = await perimetre(tenantId, user.id);
  return { versement: v, ids: (await lignesDe(db, v.id)).filter((l) => l.document_id && lisible(l.dossier_actuel)).map((l) => l.document_id) };
}

module.exports = {
  DESTINATIONS, STATUTS, MOTIFS, AGE_ARCHIVES_PUBLIQUES,
  ageEnAnnees, motifNonVersable, corps,
  lister, detail, creer, ajouter, retirer, transmettre, priseEnCharge, annuler, documentsExportables,
};
