// ============================================================================
// Tentatives de connexion (061) : contre la recherche de mot de passe par
// essais successifs. En mémoire du serveur (une instance) :
//   - 5 échecs pour un même identifiant depuis une même adresse → 15 min ;
//   - 30 échecs depuis une même adresse, tous identifiants confondus → 15 min ;
//   - 20 échecs sur un même identifiant, toutes adresses confondues → 15 min
//     (contre les essais répartis sur plusieurs machines ; seuil plus haut
//     pour qu'un tiers ne puisse pas bloquer un agent à volonté).
// Une connexion réussie efface les échecs de l'identifiant.
// ============================================================================
const FENETRE_MS = 15 * 60 * 1000;
const MAX_COMPTE = 5;
const MAX_ADRESSE = 30;
const MAX_IDENTIFIANT = 20;
const echecs = new Map(); // clé → { n, depuis, jusqua }

const adresse = (req) => String(req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '?').split(',')[0].trim();
const cles = (req, identifiant) => [`c|${adresse(req)}|${String(identifiant || '').trim().toLowerCase()}`, `a|${adresse(req)}`, `i|${String(identifiant || '').trim().toLowerCase()}`];

function lire(cle) {
  const e = echecs.get(cle);
  if (!e) return null;
  if (Date.now() - e.depuis > FENETRE_MS && !(e.jusqua > Date.now())) { echecs.delete(cle); return null; }
  return e;
}

/** Minutes de blocage restantes, ou 0. */
function bloque(req, identifiant) {
  const fin = Math.max(...cles(req, identifiant).map((k) => lire(k)?.jusqua || 0));
  return fin > Date.now() ? Math.ceil((fin - Date.now()) / 60000) : 0;
}

/** Note un échec ; rend le nombre d'essais restants pour cet identifiant. */
function echec(req, identifiant) {
  const [compte, adr, ident] = cles(req, identifiant);
  for (const [k, max] of [[compte, MAX_COMPTE], [adr, MAX_ADRESSE], [ident, MAX_IDENTIFIANT]]) {
    const e = lire(k) || { n: 0, depuis: Date.now(), jusqua: 0 };
    e.n += 1;
    if (e.n >= max) e.jusqua = Date.now() + FENETRE_MS;
    echecs.set(k, e);
  }
  if (echecs.size > 50000) echecs.clear(); // garde-fou mémoire
  return Math.max(MAX_COMPTE - (lire(compte)?.n || 0), 0);
}

function reussite(req, identifiant) { const k = cles(req, identifiant); echecs.delete(k[0]); echecs.delete(k[2]); }

/** Minutes de blocage d'un identifiant, toutes adresses confondues (pour l'administrateur). */
function blocageDe(identifiant) {
  const id = String(identifiant || '').trim().toLowerCase();
  let fin = 0;
  for (const [k] of echecs) if (k.endsWith(`|${id}`)) fin = Math.max(fin, lire(k)?.jusqua || 0);
  return fin > Date.now() ? Math.ceil((fin - Date.now()) / 60000) : 0;
}

/** L'administrateur lève le blocage d'un identifiant. */
function debloquer(identifiant) {
  const id = String(identifiant || '').trim().toLowerCase();
  for (const k of [...echecs.keys()]) if (k.endsWith(`|${id}`)) echecs.delete(k);
}

module.exports = { bloque, echec, reussite, blocageDe, debloquer, _echecs: echecs, MAX_COMPTE };
