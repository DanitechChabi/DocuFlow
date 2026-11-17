// ============================================================================
// Noms proches (055) : la recherche approchée des dossiers entrés.
//
// Chaque nom d'entreprise des dossiers entrés reçoit un vecteur (modèle
// « recherche » d'iaService), gardé en base et en mémoire. Quand une
// dénomination ne ressemble à aucune par les lettres, on cherche les noms
// proches par le vecteur : « Crédo B.T.P » retrouve « CREDO BTP SARL ». Ces
// correspondances restent signalées « à vérifier ».
// ============================================================================

const db = require('../config/db');
const ia = require('./iaService');
const { NOM_SIMPLE, FORMES } = require('../helpers/nomEntreprise');

// Ressemblance minimale (cosinus) pour qu'un nom soit candidat. Le vecteur
// seul rapproche trop (« kouassi et frères » / « valdès et frères ») : chaque
// mot distinctif cherché doit aussi se retrouver, à une faute près, dans le
// nom candidat (garde-fou plus bas).
const SEUIL = 0.86;
const PAR_PAQUET = 32;
const MAX_PAR_PASSE = 5000;

const caches = new Map(); // tenant → { noms, matrice, dim }
const enCours = new Map(); // tenant → promesse d'indexation

const modele = () => ia.MODELES.recherche.id;
// Le texte comparé : le nom sans sa forme juridique (« sarl », « ets »…).
const coeur = (nom) => {
  const c = String(nom).split(' ').filter((m) => m && !FORMES.has(m)).join(' ');
  return c.length >= 2 ? c : String(nom);
};

// Mots de métier ou de liaison : ils ne distinguent pas une entreprise.
const GENERIQUES = new Set(['et', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'en', 'au', 'aux', 'a', 'pour', 'sur',
  'btp', 'entreprise', 'entreprises', 'groupe', 'group', 'freres', 'fils', 'services', 'service', 'general', 'generale', 'generales',
  'international', 'internationale', 'benin', 'afrique', 'africa', 'plus', 'compagnie', 'company', 'cabinet', 'agence',
  'global', 'construction', 'constructions', 'commerce', 'travaux', 'batiment', 'batiments', 'distribution', 'consulting',
  'industrie', 'industries', 'trading', 'holding', 'nouvelle', 'nouveau', 'cooperative', 'association']);

/** « credo b t p » → ['credo', 'btp'] : les lettres isolées se rejoignent. */
function mots(nom) {
  const res = [];
  let lettre = false;
  for (const m of String(nom).split(' ').filter(Boolean)) {
    if (m.length === 1 && lettre) res[res.length - 1] += m;
    else res.push(m);
    lettre = m.length === 1 && (lettre || res[res.length - 1].length === 1);
  }
  return res;
}

function distance(a, b) {
  const l = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = l[0];
    l[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const t = l[j];
      l[j] = Math.min(l[j] + 1, l[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = t;
    }
  }
  return l[b.length];
}
const semblables = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && 1 - distance(a, b) / Math.max(a.length, b.length) >= 0.8);

/** Chaque mot distinctif cherché se retrouve-t-il dans le nom candidat ? */
function garde(cherche, candidat) {
  const distinctifs = mots(cherche).filter((m) => !GENERIQUES.has(m) && !FORMES.has(m) && m.length >= 3);
  if (!distinctifs.length) return false;
  const siens = mots(candidat);
  const colle = siens.join('');
  return distinctifs.every((m) => siens.some((x) => semblables(m, x)) || (m.length >= 5 && colle.includes(m)));
}

function oublier(tenantId) {
  caches.delete(Number(tenantId));
}

/** Une passe : jusqu'à 5 000 noms sans vecteur. */
async function passe(cle) {
  const r = await db.query(
    `SELECT DISTINCT ${NOM_SIMPLE} AS nom FROM dossiers_entres WHERE tenant_id = $1 AND length(${NOM_SIMPLE}) >= 2
     EXCEPT SELECT nom FROM ia_noms WHERE tenant_id = $1
     LIMIT ${MAX_PAR_PASSE}`,
    [cle]
  );
  const noms = r.rows.map((x) => x.nom);
  let ecrits = 0;
  for (let i = 0; i < noms.length; i += PAR_PAQUET) {
    const paquet = noms.slice(i, i + PAR_PAQUET);
    const v = await ia.vecteurs(paquet.map(coeur), { attendre: true });
    if (!v) break;
    await db.query(
      `INSERT INTO ia_noms (tenant_id, nom, modele, vecteur)
       SELECT $1, n, $2, string_to_array(v, ',')::real[] FROM unnest($3::text[], $4::text[]) AS t(n, v)
       ON CONFLICT (tenant_id, nom) DO UPDATE SET vecteur = EXCLUDED.vecteur, modele = EXCLUDED.modele, cree_le = now()`,
      [cle, modele(), paquet, v.map((x) => Array.from(x, (f) => f.toFixed(6)).join(','))]
    );
    ecrits += paquet.length;
  }
  return { trouves: noms.length, ecrits };
}

/** Calcule les vecteurs des noms qui n'en ont pas encore, et retire ceux des noms disparus. */
function indexer(tenantId) {
  const cle = Number(tenantId);
  if (!ia.actif('recherche')) return Promise.resolve(0);
  if (enCours.has(cle)) return enCours.get(cle);
  const travail = (async () => {
    await db.query(
      `DELETE FROM ia_noms n WHERE n.tenant_id = $1
          AND (n.modele <> $2 OR NOT EXISTS (SELECT 1 FROM dossiers_entres WHERE tenant_id = $1 AND ${NOM_SIMPLE} = n.nom))`,
      [cle, modele()]
    );
    let faits = 0;
    // Par passes de 5 000 noms, jusqu'au dernier (ou jusqu'à ce que le modèle manque).
    for (let n = 0; n < 100; n += 1) {
      const { trouves, ecrits } = await passe(cle);
      faits += ecrits;
      if (!trouves || ecrits < trouves) break;
    }
    if (faits) console.log(`[ia] ${faits} nom(s) d'entreprise indexé(s) pour l'espace ${cle}`);
    oublier(cle);
    return faits;
  })().catch((err) => {
    console.error(`[ia] indexation des noms (espace ${cle}) : ${err.message}`);
    return 0;
  }).finally(() => enCours.delete(cle));
  enCours.set(cle, travail);
  return travail;
}

async function chargerCache(tenantId) {
  const cle = Number(tenantId);
  if (caches.has(cle)) return caches.get(cle);
  const r = await db.query('SELECT nom, vecteur FROM ia_noms WHERE tenant_id = $1 AND modele = $2', [cle, modele()]);
  const dim = r.rows[0]?.vecteur?.length || 0;
  const matrice = new Float32Array(r.rows.length * dim);
  r.rows.forEach((x, i) => matrice.set(x.vecteur.map(Number), i * dim));
  const cache = { noms: r.rows.map((x) => x.nom), matrice, dim };
  caches.set(cle, cache);
  return cache;
}

/**
 * Les noms (simplifiés, comme en base) proches de `nom`, du plus proche au
 * moins proche : [{ nom, score }]. Vide si le modèle n'est pas encore prêt —
 * la recherche ne l'attend jamais.
 */
async function proches(tenantId, nom, { k = 5, seuil = SEUIL } = {}) {
  const texte = String(nom || '').trim();
  if (texte.length < 3 || !ia.actif('recherche')) return [];
  const [v] = (await ia.vecteurs([coeur(texte)])) || [];
  if (!v) return [];
  const cache = await chargerCache(tenantId);
  if (!cache.noms.length) { indexer(tenantId); return []; }
  if (cache.dim !== v.length) return [];
  const scores = [];
  for (let i = 0; i < cache.noms.length; i += 1) {
    let s = 0;
    const base = i * cache.dim;
    for (let j = 0; j < cache.dim; j += 1) s += v[j] * cache.matrice[base + j];
    if (s >= seuil) scores.push({ nom: cache.noms[i], score: Math.round(s * 1000) / 1000 });
  }
  const cle = coeur(texte);
  return scores.filter((x) => garde(cle, coeur(x.nom))).sort((a, b) => b.score - a.score).slice(0, k);
}

/** Au démarrage : indexe les espaces qui ont des dossiers entrés. */
async function demarrer() {
  if (!ia.actif('recherche')) return;
  try {
    const r = await db.query('SELECT DISTINCT tenant_id FROM dossiers_entres');
    for (const { tenant_id: t } of r.rows) await indexer(t);
  } catch (err) {
    console.error(`[ia] indexation au démarrage : ${err.message}`);
  }
}

module.exports = { SEUIL, indexer, proches, oublier, demarrer, garde, mots };
