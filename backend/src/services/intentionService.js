// ============================================================================
// Intention d'une question posée à DocuBot, apprise sur le jeu d'exemples.
//
// Un classifieur bayésien naïf (mots, paires de mots, débuts de mots)
// entraîné au démarrage du serveur sur les ~4 000 exemples de
// jeuDocubotService : quelques millisecondes, aucune carte graphique, aucun
// service extérieur. Il complète les règles de DocuBot quand une question
// est tournée autrement que prévu ; Ollama (si présent) reste au-dessus.
// ============================================================================

const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Mots trop courants pour distinguer quoi que ce soit.
const VIDES = new Set(['le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'un', 'une', 'et', 'a', 'au', 'aux', 'en', 'ce', 'cet', 'cette', 'svp', 'stp', 'merci', 's', 'il', 'vous', 'plait']);

/** Les traits d'une question : mots, paires de mots, et les 5 premières lettres des mots longs. */
function traits(question) {
  const mots = sansAccents(question).replace(/[^a-z0-9/ ]+/g, ' ').split(/\s+/).filter(Boolean)
    .map((m) => (/^\d/.test(m) ? (m.includes('/') ? '#acte' : '#nombre') : m));
  const utiles = mots.filter((m) => !VIDES.has(m));
  const t = [];
  for (const m of utiles) {
    t.push(`m:${m}`);
    if (m.length > 5) t.push(`p:${m.slice(0, 5)}`);
  }
  for (let i = 0; i + 1 < mots.length; i += 1) t.push(`b:${mots[i]}_${mots[i + 1]}`);
  if (mots[0]) t.push(`d:${mots[0]}`);
  return t;
}

let modele = null;

/** Entraîne sur des exemples [{ question, intention }]. */
function entrainer(exemples) {
  const parClasse = {};
  const vocabulaire = new Set();
  for (const { question, intention } of exemples) {
    const c = (parClasse[intention] ||= { n: 0, total: 0, compte: new Map() });
    c.n += 1;
    for (const t of new Set(traits(question))) {
      c.compte.set(t, (c.compte.get(t) || 0) + 1);
      c.total += 1;
      vocabulaire.add(t);
    }
  }
  modele = { parClasse, v: vocabulaire.size, n: exemples.length };
  return modele;
}

/** Entraîne une fois, sur le jeu d'exemples de DocuBot (noms inventés). */
function pret() {
  if (!modele) {
    const { generer } = require('./jeuDocubotService');
    const { CONSIGNE_ANALYSE } = require('./ollamaService');
    const { entrainement } = generer();
    entrainer(entrainement.filter((x) => x.prompt[0].content === CONSIGNE_ANALYSE).map((x) => ({
      question: x.prompt[1].content, intention: JSON.parse(x.completion[0].content).intention,
    })));
  }
  return modele;
}

/** { intention, confiance (0-1), classement } pour une question. */
function predire(question) {
  const m = pret();
  const t = [...new Set(traits(question))].filter((x) => Object.values(m.parClasse).some((c) => c.compte.has(x)));
  const scores = Object.entries(m.parClasse).map(([classe, c]) => {
    let s = Math.log(c.n / m.n);
    for (const x of t) s += Math.log(((c.compte.get(x) || 0) + 0.5) / (c.total + 0.5 * m.v));
    return [classe, s];
  }).sort((a, b) => b[1] - a[1]);
  const max = scores[0][1];
  const somme = scores.reduce((acc, [, s]) => acc + Math.exp(s - max), 0);
  return {
    intention: t.length ? scores[0][0] : 'autre',
    confiance: t.length ? 1 / somme : 0,
    classement: scores.slice(0, 3).map(([c, s]) => [c, Math.round((Math.exp(s - max) / somme) * 100) / 100]),
  };
}

module.exports = { traits, entrainer, pret, predire };
