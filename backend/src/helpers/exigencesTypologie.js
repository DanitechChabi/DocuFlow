// ============================================================================
// exigencesTypologie — ce qu'une demande doit comporter selon la typologie du
// dossier, quand l'organisation l'a fixé (édition AFGC : config/editions.js).
//
//   cautions (CBE, CAD, CP, CD) : le nom et le n° d'acte ;
//   prêts                       : le nom et l'année (le montant reste facultatif) ;
//   garanties bancaires         : l'entreprise, la banque et l'année.
//
// L'archive retrouve ainsi le dossier sans rappeler le demandeur.
// ============================================================================
const db = require('../config/db');
const { EDITIONS } = require('../config/editions');

const LIBELLES = {
  nom_entreprise: 'le nom de l\'entreprise',
  num_acte: 'le n° d\'acte',
  num_dossier: 'le n° de dossier',
  annee: 'l\'année',
  banque: 'le nom de la banque',
};

const plat = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Exigences par organisation (code de l'espace), mises en cache.
const parOrganisation = new Map();

/** Les exigences de l'organisation ({ typologie: [champs] }), ou null. */
async function exigencesDe(tenantId) {
  if (!tenantId) return null;
  if (!parOrganisation.has(tenantId)) {
    let slug = null;
    try {
      slug = (await db.query('SELECT slug FROM tenants WHERE id = $1', [tenantId])).rows[0]?.slug || null;
    } catch { /* base sans table tenants : pas d'exigences */ }
    parOrganisation.set(tenantId, (slug && EDITIONS[slug]?.exigences) || null);
  }
  return parOrganisation.get(tenantId);
}

/** Les champs exigés pour cette typologie (comparaison sans accents ni casse). */
function champsExiges(exigences, type) {
  if (!exigences || !type) return [];
  const cle = Object.keys(exigences).find((k) => plat(k) === plat(type));
  return cle ? exigences[cle] : [];
}

/**
 * Message d'erreur si la demande ne comporte pas ce que sa typologie exige,
 * sinon null. `values` : saisie déjà lue (lireSaisie).
 */
function manque(values, type, exigences) {
  const manquants = champsExiges(exigences, type).filter((c) => values[c] === null || values[c] === undefined || values[c] === '');
  if (!manquants.length) return null;
  const liste = manquants.map((c) => LIBELLES[c] || c);
  const texte = liste.length > 1 ? `${liste.slice(0, -1).join(', ')} et ${liste[liste.length - 1]}` : liste[0];
  return `Pour un dossier « ${type} », indiquez ${texte}.`;
}

module.exports = { exigencesDe, champsExiges, manque, LIBELLES };
