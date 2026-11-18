// ============================================================================
// Plan de classement et calendrier de conservation de l'AFGC
// (config/planClassementAfgc.js) : la liste, et la rubrique d'un document
// cherchée en français (« combien de temps garder les contrats de travail ? »).
// ============================================================================
const { DEPARTEMENTS, PLAN, FONDS_COTES, VALIDE_LE } = require('../config/planClassementAfgc');

const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const VIDES = new Set(['les', 'des', 'du', 'de', 'la', 'le', 'un', 'une', 'et', 'ou', 'en', 'au', 'aux', 'pour', 'sur', 'par', 'dans', 'avec',
  'combien', 'temps', 'conserver', 'conserve', 'garder', 'garde', 'faut', 'doit', 'doivent', 'quelle', 'quel', 'quels', 'quelles', 'est', 'sont',
  'duree', 'durees', 'conservation', 'sort', 'final', 'cote', 'classer', 'classe', 'classement', 'ranger', 'range', 'plan', 'calendrier',
  'archive', 'archives', 'archiver', 'eliminer', 'elimine', 'elimination', 'detruire', 'destruction', 'dossier', 'dossiers', 'document', 'documents',
  'nos', 'notre', 'mes', 'ses', 'leurs', 'comment', 'quoi', 'ans', 'annee', 'annees', 'peut', 'peuvent', 'jeter', 'garde-t-on', 'on']);
const mots = (s) => sansAccents(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((m) => m.length >= 3 && !VIDES.has(m));
const racine = (m) => m.slice(0, 6);

const departement = (code) => DEPARTEMENTS.find(([c]) => c === code)?.[1] || code;

/** La règle d'une rubrique, en une phrase. */
function regle(r) {
  if (!r.sort) return null;
  const sort = r.sort === 'C' ? 'conservation définitive' : 'élimination';
  const bureau = r.bureau && r.bureau !== '-' ? `${r.bureau} au bureau, ` : '';
  return `${bureau}${r.archivage} en archivage, puis ${sort}`;
}

/** Les rubriques qui répondent le mieux à la question (3 au plus), avec leur règle. */
const SYNONYMES = [[/\bpv\b/g, 'proces verbaux'], [/\bcr\b/g, 'compte rendu'], [/\bca\b/g, 'conseil administration'], [/\brh\b/g, 'ressources humaines']];
function chercher(question, n = 3) {
  let texte = sansAccents(question);
  for (const [re, mot] of SYNONYMES) texte = texte.replace(re, mot);
  const q = mots(texte).map(racine);
  if (!q.length) return [];
  const cote = /\b(\d{1,2}(?:a|b|c|cg|d|e|f|g|h|mg|se|x)\d{0,2})\b/i.exec(question)?.[1]?.toUpperCase();
  return PLAN
    .map((r) => {
      if (cote && r.cote === cote) return { r, score: 100 };
      const titre = mots(r.intitule).map(racine);
      const reste = mots(`${r.consigne || ''} ${departement(r.departement)}`).map(racine);
      // Tous les mots de l'intitulé dans la question : c'est sans doute lui.
      const complet = titre.length && titre.every((m) => q.includes(m)) ? 5 : 0;
      const score = q.reduce((s, m) => s + (titre.includes(m) ? 3 : 0) + (reste.includes(m) ? 1 : 0), 0) + complet + (r.sort ? 0.5 : 0);
      return { r, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(({ r }) => ({ ...r, nom_departement: departement(r.departement), regle: regle(r) }));
}

function lister() {
  return {
    valide_le: VALIDE_LE,
    departements: DEPARTEMENTS.map(([code, nom]) => ({ code, nom })),
    rubriques: PLAN.map((r) => ({ ...r, regle: regle(r) })),
    fonds: FONDS_COTES,
  };
}

/** La rubrique d'un fonds de DocuFlow (points, non retirés, ouvertures de compte). */
const rubriqueDuFonds = (fonds) => {
  const r = PLAN.find((x) => x.cote === FONDS_COTES[fonds]);
  return r ? { ...r, regle: regle(r) } : null;
};

module.exports = { lister, chercher, regle, rubriqueDuFonds, departement };
