// ============================================================================
// referentielService — ce que l'organisation sait déjà (migration 046).
//
// Les fiches d'une classe marquée « référentiel » — typiquement un classeur
// importé : registre d'entreprises, liste de dossiers, fichier du personnel —
// servent à deux choses :
//   1. RECONNAÎTRE un document à indexer. Si son texte (ou le nom de son
//      fichier, ou ce que l'archiviste vient de taper) cite un identifiant ou
//      un nom du référentiel, l'indexation assistée propose les informations
//      de la fiche correspondante, écrites comme dans le référentiel ;
//   2. PROPOSER, à la frappe, les valeurs déjà connues d'un champ.
// Rien n'est appliqué d'office : ce sont des propositions.
//
// Une fiche d'un dossier restreint ne nourrit que ceux qui peuvent la lire.
// ============================================================================
const db = require('../config/db');
const aclService = require('./aclService');
const { cle, lisible } = require('./classeService');

const A_INDEXER = 'À indexer';
const LIMITE_FICHES = 5000;
const DUREE_CACHE_MS = 60 * 1000;
const TIERS = /\b(attributaire|titulaire|soumissionnaire|fournisseur|prestataire|entreprise|societe|raison sociale|denomination|etablissement|structure|promoteur|cocontractant|beneficiaire|expediteur|destinataire|demandeur|client)\b/;
const cache = new Map(); // tenantId → { fiches, expire }

const plein = (v) => v !== null && v !== undefined && String(v).trim() !== '' && String(v).trim() !== A_INDEXER;

/** Un nom assez long pour ne pas se trouver par hasard dans un texte. */
const nomDistinctif = (k) => k.length >= 9 || (k.length >= 6 && k.includes(' '));
/** Un identifiant : au moins cinq caractères utiles, dont trois chiffres. */
const identifiantDistinctif = (k) => k.replace(/ /g, '').length >= 5 && (k.match(/\d/g) || []).length >= 3;

/**
 * Prépare une fiche du référentiel pour la reconnaissance. Fonction pure.
 * @param {{ id, reference, titre, classe, nom_entreprise, num_dossier, num_acte, dossier_id, proprietes: Array<[label, type, valeur, options]> }} f
 */
function preparer(f) {
  const proprietes = (f.proprietes || []).map(([label, type, valeur, options]) => ({
    libelle: label, cle: cle(label), type, valeur, lisible: lisible(valeur, { type, options_json: options }),
  })).filter((p) => plein(p.lisible));
  const noms = new Set();
  const identifiants = new Set();
  for (const brut of [f.titre, f.nom_entreprise]) { const k = cle(brut); if (plein(brut) && nomDistinctif(k)) noms.add(k); }
  for (const brut of [f.num_dossier, f.num_acte]) { const k = cle(brut); if (plein(brut) && identifiantDistinctif(k)) identifiants.add(k); }
  for (const p of proprietes) {
    const k = cle(p.lisible);
    if (p.type === 'text' && identifiantDistinctif(k) && k.length <= 40) identifiants.add(k);
  }
  return {
    id: f.id, reference: f.reference, titre: f.titre || f.nom_entreprise || f.reference, classe: f.classe, dossier_id: f.dossier_id || null,
    nom: plein(f.nom_entreprise) ? f.nom_entreprise : (plein(f.titre) ? f.titre : null),
    num_dossier: plein(f.num_dossier) ? f.num_dossier : null, num_acte: plein(f.num_acte) ? f.num_acte : null,
    proprietes, noms: [...noms], identifiants: [...identifiants],
  };
}

/**
 * La fiche du référentiel que cite un texte, ou null. Un identifiant cité
 * l'emporte sur un nom ; entre deux noms, le plus long. Fonction pure.
 * @param {string} texte texte brut (document, nom de fichier, saisie)
 * @param {Array} fiches fiches préparées
 * @returns {null|{ fiche, par: 'identifiant'|'nom', trouve: string }}
 */
function reconnaitre(texte, fiches) {
  const t = ` ${cle(texte)} `;
  if (t.length < 7) return null;
  let meilleur = null;
  const retenir = (fiche, par, trouve, poids) => { if (!meilleur || poids > meilleur.poids) meilleur = { fiche, par, trouve, poids }; };
  for (const f of fiches) {
    for (const k of f.identifiants) if (t.includes(` ${k} `)) retenir(f, 'identifiant', k, 1000 + k.length);
    for (const k of f.noms) if (t.includes(` ${k} `)) retenir(f, 'nom', k, k.length);
  }
  return meilleur && { fiche: meilleur.fiche, par: meilleur.par, trouve: meilleur.trouve };
}

/** Valeur d'une propriété du référentiel, mise au type du champ qui la reçoit — ou null. */
function convertir(p, champ) {
  if (champ.type === 'text') return p.lisible;
  if (champ.type === 'select') {
    const options = (Array.isArray(champ.options) ? champ.options : []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
    const o = options.find((x) => cle(x.label) === cle(p.lisible) || String(x.value) === String(p.valeur));
    return o ? { valeur: o.value, affichage: o.label } : null;
  }
  return null; // un montant ou une date appartiennent au document, pas au référentiel
}

/**
 * Propositions tirées d'une fiche reconnue, pour les champs de l'organisation.
 * `tiers` : le nom canonique (à proposer AVANT ce que le texte laisse deviner) ;
 * `complements` : numéros et propriétés de même libellé (à proposer APRÈS ce
 * que le document dit lui-même). Fonction pure.
 */
function propositionsDe({ fiche, par }, champs = []) {
  const extrait = `Reconnu dans « ${fiche.classe} » : ${fiche.titre}`;
  const base = { extrait, source: 'referentiel', referentiel: { document_id: fiche.id, reference: fiche.reference, classe: fiche.classe } };
  const sure = par === 'identifiant' ? 'haute' : 'moyenne';
  const tiers = [];
  const complements = [];
  if (fiche.nom) {
    tiers.push({ ...base, champ: 'nom_entreprise', libelle: 'Entreprise / sujet', valeur: fiche.nom, confiance: 'haute' });
    for (const c of champs) {
      if (c.type === 'text' && TIERS.test(cle(c.label))) tiers.push({ ...base, champ: `meta:${c.id}`, libelle: c.label, valeur: fiche.nom, confiance: 'haute' });
    }
  }
  if (fiche.num_dossier) complements.push({ ...base, champ: 'num_dossier', libelle: 'N° de dossier', valeur: fiche.num_dossier, confiance: sure });
  if (fiche.num_acte) complements.push({ ...base, champ: 'num_acte', libelle: "N° d'acte", valeur: fiche.num_acte, confiance: sure });
  for (const c of champs) {
    const p = fiche.proprietes.find((x) => x.cle === cle(c.label));
    if (!p) continue;
    const v = convertir(p, c);
    if (v === null) continue;
    complements.push({ ...base, champ: `meta:${c.id}`, libelle: c.label, confiance: sure, ...(typeof v === 'object' ? v : { valeur: v }) });
  }
  return { tiers, complements };
}

/** Fiches du référentiel que l'utilisateur peut lire, préparées. */
async function fiches(tenantId, userId) {
  const maintenant = Date.now();
  let entree = cache.get(tenantId);
  if (!entree || entree.expire < maintenant) {
    const { rows } = await db.query(
      `SELECT d.id, d.reference_mfile AS reference, d.description AS titre, d.nom_entreprise, d.num_dossier, d.num_acte, d.dossier_id, s.name AS classe,
              (SELECT json_agg(json_build_array(f.label, f.type, v.value_json, f.options_json) ORDER BY f.display_order, f.id)
                 FROM metadata_values v JOIN metadata_fields f ON f.id = v.field_id AND f.schema_id = s.id
                WHERE v.document_id = d.id) AS proprietes
         FROM documents d JOIN metadata_schemas s ON s.id = d.classe_id AND s.tenant_id = d.tenant_id AND s.referentiel
        WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.elimine_at IS NULL
        ORDER BY d.id DESC LIMIT $2`, [tenantId, LIMITE_FICHES]).catch((err) => { if (err.code === '42703') return { rows: [] }; throw err; });
    entree = { fiches: rows.map(preparer), expire: maintenant + DUREE_CACHE_MS };
    cache.set(tenantId, entree);
  }
  if (!entree.fiches.some((f) => f.dossier_id)) return entree.fiches;
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, userId);
  return entree.fiches.filter((f) => !f.dossier_id || lisibles.has(f.dossier_id));
}

/** À appeler quand le référentiel change (import, classe marquée ou démarquée). */
function invalider(tenantId) { cache.delete(tenantId); }

/**
 * Valeurs déjà connues, pour compléter une saisie : celles des propriétés de
 * même libellé, et pour un champ « tiers » (ou `fiche = nom_entreprise`) les
 * noms des fiches de l'organisation. Bornées au périmètre de lecture.
 * @param {{ champ_id?: number, fiche?: string, q?: string }} critere
 * @returns {Promise<string[]>}
 */
async function valeurs(tenantId, userId, { champ_id: champId, fiche, q } = {}) {
  const terme = String(q || '').trim().slice(0, 80);
  const motif = `%${terme.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, userId);
  const perimetre = [...lisibles];
  const requetes = [];
  let tiers = fiche === 'nom_entreprise';
  if (champId) {
    const tous = (await db.query(
      'SELECT f.id, f.label, f.type FROM metadata_fields f JOIN metadata_schemas s ON s.id = f.schema_id WHERE s.tenant_id = $1', [tenantId])).rows;
    const voulu = tous.find((f) => f.id === Number(champId));
    if (!voulu || voulu.type !== 'text') return [];
    tiers = tiers || TIERS.test(cle(voulu.label));
    const jumeaux = tous.filter((f) => f.type === 'text' && cle(f.label) === cle(voulu.label)).map((f) => f.id);
    requetes.push(db.query(
      `SELECT v.value_json #>> '{}' AS v, count(*)::int AS n FROM metadata_values v JOIN documents d ON d.id = v.document_id
        WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND v.field_id = ANY($2::int[]) AND (v.value_json #>> '{}') ILIKE $3
          AND (d.dossier_id IS NULL OR d.dossier_id = ANY($4::int[]))
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`, [tenantId, jumeaux, motif, perimetre]));
  } else if (['num_dossier', 'num_acte'].includes(fiche)) {
    requetes.push(db.query(
      `SELECT ${fiche} AS v, count(*)::int AS n FROM documents d
        WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND ${fiche} <> $2 AND ${fiche} ILIKE $3 AND (d.dossier_id IS NULL OR d.dossier_id = ANY($4::int[]))
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`, [tenantId, A_INDEXER, motif, perimetre]));
  }
  if (tiers) {
    requetes.push(db.query(
      `SELECT d.nom_entreprise AS v, count(*)::int AS n FROM documents d
        WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.nom_entreprise <> $2 AND d.nom_entreprise ILIKE $3 AND (d.dossier_id IS NULL OR d.dossier_id = ANY($4::int[]))
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`, [tenantId, A_INDEXER, motif, perimetre]));
  }
  const vus = new Map();
  for (const r of await Promise.all(requetes)) {
    for (const { v, n } of r.rows) if (plein(v)) vus.set(v, (vus.get(v) || 0) + n);
  }
  const debut = terme.toLowerCase();
  // Ce qui commence par la saisie d'abord, puis le plus fréquent.
  return [...vus].sort((a, b) => (b[0].toLowerCase().startsWith(debut) - a[0].toLowerCase().startsWith(debut)) || b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
    .slice(0, 10).map(([v]) => v);
}

/** Marque (ou démarque) une classe comme référentiel. */
async function definir(tenantId, classeId, actif, user) {
  const { rows } = await db.query(
    'UPDATE metadata_schemas SET referentiel = $3 WHERE id = $1 AND tenant_id = $2 AND is_default IS NOT TRUE RETURNING id, name, referentiel',
    [Number(classeId) || 0, tenantId, actif === true]);
  if (!rows[0]) throw Object.assign(new Error('Classe introuvable.'), { status: 404 });
  invalider(tenantId);
  await db.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json)
     VALUES ($1, $2, $3, $4, 'classe', $5, $6)`,
    [tenantId, user.id, user.username || null, rows[0].referentiel ? 'REFERENTIEL_ACTIVE' : 'REFERENTIEL_RETIRE', rows[0].id, JSON.stringify({ classe: rows[0].name })]
  ).catch((e) => console.error('[référentiel] journal :', e.message));
  return { id: rows[0].id, nom: rows[0].name, referentiel: rows[0].referentiel };
}

module.exports = { TIERS, preparer, reconnaitre, propositionsDe, fiches, invalider, valeurs, definir };
