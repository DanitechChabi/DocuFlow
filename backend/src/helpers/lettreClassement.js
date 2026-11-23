// ============================================================================
// Lettre de classement d'un dossier entré (édition AFGC).
//
//   « Sarl Kanvô BTP »            → S   (la forme juridique compte, « Ets » aussi)
//   « Groupe Nonvi Services »     → N   (« Groupe », « Groupement » sautés)
//   « Société Gbèdé Équipements » → G   (« Société » n'est qu'une étiquette)
//   « Société Générale »          → S   (ici « Société » fait partie du nom)
//   « 2SND »                      → S   (le chiffre ne compte pas)
//
// Un mot générique de tête (Entreprise, Société, Groupe, Groupement) est sauté, sauf
// s'il fait partie de la dénomination sociale : suivi d'un « de / des / du »
// (« Société de Gestion… ») ou d'un adjectif (« Générale », « Béninoise »…),
// ou s'il est seul. Les cas que la règle ne devine pas se corrigent à la main
// dans « Entrée des dossiers » ; la correction vaut ensuite pour toutes les
// entrées de l'entreprise (table lettres_classement, migration 063).
// ============================================================================

// Les formes juridiques (Sarl, SA…) et « Ets / Établissements » COMPTENT : « Sarl Kanvô » va en S.
const GENERIQUES = new Set('entreprise entreprises societe societes ste groupe groupes groupement groupements'.split(' '));

// « Société Générale », « Entreprise Nationale… » : le mot générique fait partie du nom.
const LIAISONS = new Set(['de', 'des', 'du', 'd', 'l', 'la', 'le', 'les', 'et', 'pour', 'a', 'au', 'aux']);
const ADJECTIFS = new Set(('generale general generales generaux nationale national nationales nationaux internationale international '
  + 'beninoise beninois africaine africain ouest togolaise togolais ivoirienne ivoirien nigeriane nigerian francaise francais '
  + 'commerciale commercial industrielle industriel nouvelle nouveau moderne civile civil immobiliere immobilier agricole '
  + 'financiere financier maritime miniere minier centrale central publique public mutuelle cooperative universelle universel '
  + 'technique techniques unie unis reunies reunis mixte anonyme regionale regional communale communal').split(' '));

const mots = (nom) => String(nom || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/** Les mots qui comptent pour le classement (« Société Gbèdé Équipements » → « gbede equipements »). */
function nomDeClassement(nom) {
  const m = mots(nom);
  let i = 0;
  while (i < m.length - 1 && GENERIQUES.has(m[i])) {
    const suivant = m[i + 1];
    if (LIAISONS.has(suivant) || ADJECTIFS.has(suivant)) break;
    i += 1;
  }
  return m.slice(i).join(' ');
}

/** La lettre de classement (A à Z), « # » s'il n'y a aucune lettre, null sans nom. */
function lettreDe(nom) {
  const tout = mots(nom).join('');
  if (!tout) return null;
  const c = nomDeClassement(nom).match(/[a-z]/) || tout.match(/[a-z]/);
  return c ? c[0].toUpperCase() : '#';
}

/** Le nom simplifié, comme l'expression NOM_SIMPLE en base (clé des corrections). */
const cleDe = (nom) => String(nom ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Une lettre saisie : A à Z ou « # », sinon null. */
function lettreValide(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return /^[A-Z#]$/.test(s) ? s : null;
}

module.exports = { lettreDe, nomDeClassement, cleDe, lettreValide, GENERIQUES };
