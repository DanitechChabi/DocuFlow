// ============================================================================
// Ollama : le modèle de langue de DocuBot, sur un serveur de l'AFGC.
//
// Deux usages, jamais pour inventer une donnée :
//   - comprendre une question que les règles ne reconnaissent pas
//     (« le dossier des Ets Kpadonou est-il revenu ? ») → intention,
//     entreprise, acte, au format JSON ; la réponse reste calculée sur la base ;
//   - rédiger une réponse d'aide à partir des passages fournis (procédures),
//     et seulement d'eux.
//
// Réglages : ollama_url (ex. http://localhost:11434) et ollama_modele
// (« docubot-afgc » une fois entraîné, sinon « qwen3:4b-instruct »).
// Sans adresse, ou si Ollama ne répond pas, DocuBot garde ses règles.
// ============================================================================

const settingsService = require('./settingsService');

const MODELE_DEFAUT = 'docubot-afgc';
const MODELE_REPLI = 'qwen3:4b-instruct';
const INTENTIONS = ['ou_est', 'qui_a', 'mes_demandes', 'retards', 'journee', 'chiffres', 'semaine', 'aide', 'salut', 'autre'];

// Consigne du routeur : la même que celle du jeu d'entraînement (scripts/ia-documentaire).
const CONSIGNE_ANALYSE = `Tu analyses une question posée à DocuBot, l'assistant des archives de l'AFGC.
Réponds uniquement en JSON : {"intention": "...", "entreprise": "..." ou null, "acte": "..." ou null, "date": "AAAA-MM-JJ" ou null}.
Intentions :
- ou_est : où se trouve un dossier, est-il aux archives, dans quelle semaine ou armoire ;
- qui_a : qui détient un dossier, est-il sorti, est-il revenu, chez qui ;
- mes_demandes : l'état de mes demandes ;
- retards : dossiers en retard, à rendre, à récupérer ;
- journee : ce que l'archiviste a à traiter aujourd'hui ;
- chiffres : combien de dossiers, de demandes, de sorties ;
- semaine : les dossiers entrés une semaine ou un jour donné ;
- aide : comment faire quelque chose dans l'application ou aux archives ;
- salut : bonjour, merci ;
- autre : rien de tout cela.
"entreprise" : le nom de l'entreprise tel qu'écrit, sans « société », « Ets »… ; "acte" : le n° d'acte (ex. 2025/2479).`;

const CONSIGNE_REDACTION = `Tu es DocuBot, l'assistant des archives de l'AFGC. Réponds en français, en deux à quatre phrases simples,
UNIQUEMENT à partir des informations ci-dessous. Si elles ne permettent pas de répondre, dis-le et propose de contacter l'archive.
N'invente ni nom, ni chiffre, ni procédure.`;

/** Réglages lus à chaque appel (l'administrateur peut les changer à chaud). */
async function config(tenantId) {
  const s = await settingsService.getAll(tenantId).catch(() => ({}));
  const url = String(s.ollama_url || process.env.OLLAMA_URL || '').trim().replace(/\/+$/, '');
  return { url: /^https?:\/\/[^\s]+$/i.test(url) ? url : '', modele: String(s.ollama_modele || process.env.OLLAMA_MODELE || MODELE_DEFAUT).trim() };
}

async function appel(url, chemin, corps, delai) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), delai);
  try {
    const r = await fetch(`${url}${chemin}`, {
      method: corps ? 'POST' : 'GET',
      headers: corps ? { 'content-type': 'application/json' } : undefined,
      body: corps ? JSON.stringify(corps) : undefined,
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`Ollama a répondu ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(minuteur);
  }
}

// Le modèle réellement servi : celui réglé s'il est installé, sinon le repli. Mémorisé 5 minutes.
const modeles = new Map();
async function modeleServi(c) {
  const memo = modeles.get(c.url);
  if (memo && Date.now() - memo.le < 5 * 60 * 1000) return memo.nom;
  const tags = await appel(c.url, '/api/tags', null, 4000);
  const presents = (tags.models || []).map((m) => m.name);
  const a = (nom) => presents.find((p) => p === nom || p === `${nom}:latest`);
  const nom = a(c.modele) || a(MODELE_REPLI) || presents[0] || null;
  modeles.set(c.url, { nom, le: Date.now() });
  return nom;
}

/** État pour l'administration : joignable, modèles installés, modèle servi. */
async function etat(tenantId) {
  const c = await config(tenantId);
  if (!c.url) return { configure: false };
  try {
    const debut = Date.now();
    const tags = await appel(c.url, '/api/tags', null, 4000);
    modeles.delete(c.url);
    return {
      configure: true, joignable: true, url: c.url, modele_regle: c.modele,
      modele_servi: await modeleServi(c), installes: (tags.models || []).map((m) => m.name), ms: Date.now() - debut,
    };
  } catch (err) {
    return { configure: true, joignable: false, url: c.url, modele_regle: c.modele, erreur: err.name === 'AbortError' ? 'pas de réponse' : err.message };
  }
}

async function discuter(tenantId, messages, { json = false, delai = 30000 } = {}) {
  const c = await config(tenantId);
  if (!c.url) return null;
  try {
    const modele = await modeleServi(c);
    if (!modele) return null;
    const r = await appel(c.url, '/api/chat', {
      model: modele, stream: false, messages, ...(json ? { format: 'json' } : {}),
      options: { temperature: json ? 0 : 0.2, num_predict: json ? 120 : 300 },
      keep_alive: '30m',
    }, delai);
    return { texte: String(r.message?.content || '').trim(), modele };
  } catch (err) {
    console.error(`[ollama] ${err.name === 'AbortError' ? 'pas de réponse à temps' : err.message}`);
    return null;
  }
}

/** Lit l'intention d'une question : { intention, entreprise, acte, date } ou null. */
async function analyser(tenantId, question) {
  const r = await discuter(tenantId, [{ role: 'system', content: CONSIGNE_ANALYSE }, { role: 'user', content: String(question).slice(0, 500) }], { json: true, delai: 25000 });
  if (!r) return null;
  try {
    const d = JSON.parse(r.texte);
    const propre = (v) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, 200) : null);
    return {
      intention: INTENTIONS.includes(d.intention) ? d.intention : 'autre',
      entreprise: propre(d.entreprise),
      acte: propre(d.acte),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || '')) ? d.date : null,
      modele: r.modele,
    };
  } catch {
    return null;
  }
}

/** Rédige une réponse d'aide à partir des seuls passages fournis. */
async function rediger(tenantId, question, passages) {
  if (!passages.length) return null;
  const contexte = passages.map((p, i) => `[${i + 1}] ${p}`).join('\n');
  const r = await discuter(tenantId, [
    { role: 'system', content: `${CONSIGNE_REDACTION}\n\nInformations :\n${contexte}` },
    { role: 'user', content: String(question).slice(0, 500) },
  ], { delai: 45000 });
  return r && r.texte ? r : null;
}

module.exports = { config, etat, analyser, rediger, CONSIGNE_ANALYSE, CONSIGNE_REDACTION, INTENTIONS, MODELE_DEFAUT, MODELE_REPLI };
