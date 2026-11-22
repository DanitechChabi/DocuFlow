// ============================================================================
// Aide automatique, sur le serveur lui-même (Hugging Face, Transformers.js).
// Aucun texte ne quitte le serveur : les modèles sont téléchargés une fois
// (ou livrés avec le paquet Windows), puis tournent sur le processeur.
//
//   recherche  — multilingual-e5-small : des noms proches par le sens et
//                l'orthographe (« Crédo B.T.P » ↔ « CREDO BTP SARL ») ;
//   entites    — camembert-ner-with-dates : entreprise, personnes et dates
//                lues dans une phrase (« le dossier de la société X du 12 mars ») ;
//   typologie  — mDeBERTa XNLI : la typologie probable d'une demande écrite
//                en phrase, parmi celles réglées pour l'organisation.
//
// Chaque modèle est facultatif. IA_LOCALE : « non » (aucun), « oui » (tous),
// ou une liste (« recherche,entites ») ; sans réglage, les modèles qui
// tiennent dans la mémoire du serveur. Un modèle absent ou en panne ne bloque
// rien : l'application retombe sur ses règles habituelles.
// ============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

const MODELES = {
  recherche: { tache: 'feature-extraction', id: 'Xenova/multilingual-e5-small', memoire: 350 },
  entites: { tache: 'token-classification', id: 'Xenova/camembert-ner-with-dates', memoire: 300 },
  typologie: { tache: 'zero-shot-classification', id: 'Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7', memoire: 1000 },
};
const ORDRE = ['recherche', 'entites', 'typologie'];
// Mémoire laissée à l'application elle-même (Node, base, OCR).
const RESERVE_MO = 700;
const NOUVEL_ESSAI_MS = 10 * 60 * 1000;

const etats = {}; // nom → { statut: 'chargement'|'pret'|'erreur', pipeline, promesse, erreur, depuis }

/** Mémoire allouée au serveur, en Mo : limite du conteneur, sinon mémoire totale. */
function memoireMo() {
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const v = fs.readFileSync(f, 'utf8').trim();
      const n = Number(v);
      if (v !== 'max' && Number.isFinite(n) && n > 0 && n < 2 ** 50) return Math.round(n / 2 ** 20);
    } catch { /* pas de cgroup : machine ordinaire */ }
  }
  return Math.round(os.totalmem() / 2 ** 20);
}

/** Les modèles retenus pour ce serveur. */
function modelesActifs(env = process.env, memoire = memoireMo) {
  const reglage = String(env.IA_LOCALE ?? '').trim().toLowerCase();
  if (['non', '0', 'false', 'aucun'].includes(reglage)) return [];
  if (['oui', '1', 'true', 'tous'].includes(reglage)) return [...ORDRE];
  if (reglage) return ORDRE.filter((m) => reglage.split(/[\s,;]+/).includes(m));
  if (env.NODE_ENV === 'test') return [];
  let reste = memoire() - RESERVE_MO;
  const choisis = [];
  for (const m of ORDRE) {
    if (reste < MODELES[m].memoire) break;
    choisis.push(m);
    reste -= MODELES[m].memoire;
  }
  return choisis;
}

const dossierModeles = () => process.env.IA_MODELES_DIR || path.join(__dirname, '..', '..', '.modeles');

let bibliotheque = null;
async function transformers() {
  if (!bibliotheque) {
    bibliotheque = import('@huggingface/transformers').then((t) => {
      t.env.cacheDir = dossierModeles();
      t.env.localModelPath = dossierModeles();
      // Sur un serveur sans Internet, les modèles doivent être livrés avec le paquet.
      t.env.allowRemoteModels = process.env.IA_TELECHARGER !== 'non';
      return t;
    });
  }
  return bibliotheque;
}

// Pour les tests : un faux modèle à la place du vrai.
const substituts = {};
function _substituer(nom, fonction) {
  if (fonction) substituts[nom] = fonction; else delete substituts[nom];
}

function actif(nom) {
  return Boolean(substituts[nom]) || modelesActifs().includes(nom);
}

/** Charge un modèle (une seule fois). Rend la fonction, ou null s'il est inactif ou en panne. */
async function charger(nom) {
  if (substituts[nom]) return substituts[nom];
  if (!modelesActifs().includes(nom)) return null;
  const e = etats[nom];
  if (e?.statut === 'pret') return e.pipeline;
  if (e?.statut === 'chargement') return e.promesse;
  if (e?.statut === 'erreur' && Date.now() - e.depuis < NOUVEL_ESSAI_MS) return null;
  const m = MODELES[nom];
  const promesse = (async () => {
    try {
      const t = await transformers();
      const debut = Date.now();
      const p = await t.pipeline(m.tache, m.id, { dtype: 'q8' });
      etats[nom] = { statut: 'pret', pipeline: p, depuis: Date.now() };
      console.log(`[ia] modèle « ${nom} » prêt (${Math.round((Date.now() - debut) / 100) / 10} s)`);
      return p;
    } catch (err) {
      etats[nom] = { statut: 'erreur', erreur: err.message, depuis: Date.now() };
      console.error(`[ia] modèle « ${nom} » indisponible : ${err.message}`);
      return null;
    }
  })();
  etats[nom] = { statut: 'chargement', promesse, depuis: Date.now() };
  return promesse;
}

/** Oublie l'échec d'un modèle : le prochain appel le recharge. */
function oublierEchec(nom) {
  if (etats[nom]?.statut === 'erreur') delete etats[nom];
}

/** Le modèle s'il est déjà prêt ; sinon lance son chargement et rend null (pour ne pas faire attendre). */
function siPret(nom) {
  if (substituts[nom]) return substituts[nom];
  if (etats[nom]?.statut === 'pret') return etats[nom].pipeline;
  charger(nom).catch(() => {});
  return null;
}

/** État des modèles, pour l'administration. */
function etat() {
  const actifs = modelesActifs();
  return {
    memoire_mo: memoireMo(),
    modeles: ORDRE.map((nom) => ({
      nom,
      modele: MODELES[nom].id,
      statut: !actifs.includes(nom) ? 'inactif' : etats[nom]?.statut || 'en attente',
      erreur: etats[nom]?.erreur || null,
    })),
  };
}

/** Charge à l'avance les modèles actifs (au démarrage du serveur). */
function prechauffer() {
  return Promise.all(modelesActifs().map((m) => charger(m)));
}

// ---------------------------------------------------------------------------
// Vecteurs de noms (recherche).
// ---------------------------------------------------------------------------

/** Vecteurs normalisés d'une liste de textes ; null si le modèle n'est pas prêt. */
async function vecteurs(textes, { attendre = false, prefixe = 'query' } = {}) {
  const p = attendre ? await charger('recherche') : siPret('recherche');
  if (!p || !textes.length) return null;
  const sortie = await p(textes.map((t) => `${prefixe}: ${t}`), { pooling: 'mean', normalize: true });
  const dim = sortie.dims[sortie.dims.length - 1];
  return Array.from({ length: textes.length }, (_, i) => Float32Array.from(sortie.data.subarray(i * dim, (i + 1) * dim)));
}

// ---------------------------------------------------------------------------
// Lecture d'une demande écrite en phrase : entités, n° d'acte, typologie.
// ---------------------------------------------------------------------------

const echapper = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regroupe les jetons du modèle en entités, et retrouve chacune telle
 * qu'écrite dans la phrase (les jetons perdent les espaces).
 */
function regrouper(texte, jetons) {
  const groupes = [];
  for (const j of jetons) {
    const type = String(j.entity || '').replace(/^[BI]-/, '');
    const dernier = groupes[groupes.length - 1];
    const suite = dernier && dernier.type === type && j.index === dernier.fin + 1 && !String(j.entity).startsWith('B-');
    if (suite) {
      dernier.mots += j.word;
      dernier.fin = j.index;
      dernier.scores.push(j.score);
    } else {
      groupes.push({ type, mots: j.word, fin: j.index, scores: [j.score] });
    }
  }
  let depuis = 0;
  return groupes.map((g) => {
    const lettres = [...g.mots.replace(/[▁\s]/g, '')];
    let valeur = lettres.join('');
    if (lettres.length) {
      const re = new RegExp(lettres.map(echapper).join('\\s*'), 'iu');
      const m = re.exec(texte.slice(depuis));
      if (m) { valeur = m[0]; depuis += m.index + m[0].length; }
    }
    return { type: g.type, valeur: valeur.trim(), score: g.scores.reduce((a, b) => a + b, 0) / g.scores.length };
  }).filter((g) => g.valeur.length >= 2);
}

/** « acte 2024/1234 », « acte n° 1234 » → le n° d'acte tel qu'écrit. */
function acteDans(texte) {
  const s = String(texte || '');
  const m = /\b((?:19|20)\d{2})\s*\/\s*(\d{1,6})\b/.exec(s);
  if (m) return `${m[1]}/${m[2]}`;
  const n = /\bactes?\s*(?:n\s*[°o.]?\s*)?(\d{1,6}(?:\s*(?:-|à|a)\s*\d{1,6})?)\b/i.exec(s);
  return n ? n[1].replace(/\s+/g, ' ') : null;
}

const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** « Bonne exécution (CBE) » → { nom: 'Bonne exécution', sigle: 'CBE' }. */
function decouperType(label) {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(String(label || ''));
  return m ? { nom: m[1].trim(), sigle: m[2].trim() } : { nom: String(label || '').trim(), sigle: null };
}

/** La typologie nommée telle quelle dans la phrase (nom ou sigle) : sûre, sans modèle. */
function typeNomme(texte, types) {
  const plat = ` ${sansAccents(texte).replace(/[^a-z0-9]+/g, ' ')} `;
  for (const t of types) {
    const { nom, sigle } = decouperType(t.label);
    const essais = [nom.length >= 4 && sansAccents(nom).replace(/[^a-z0-9]+/g, ' ').trim(), sigle && sansAccents(sigle)].filter(Boolean);
    if (essais.some((e) => plat.includes(` ${e} `))) return { value: t.value, label: t.label, score: 1, source: 'texte' };
  }
  return null;
}

// Une proposition du modèle n'est faite que si elle se détache nettement.
const SCORE_MIN = 0.25;
const AVANCE_MIN = 1.6;

/** La typologie probable d'une phrase, parmi `types` ({ value, label }). */
async function typologieDe(texte, types, { attendre = true } = {}) {
  if (!Array.isArray(types) || !types.length) return null;
  const nomme = typeNomme(texte, types);
  if (nomme) return nomme;
  const p = attendre ? await charger('typologie') : siPret('typologie');
  if (!p || types.length < 2) return null;
  const libelles = types.map((t) => decouperType(t.label).nom);
  const r = await p(texte, libelles, { hypothesis_template: 'Ce dossier concerne {}.' });
  const [premier, second = 0] = r.scores;
  if (premier < SCORE_MIN || premier < second * AVANCE_MIN) return null;
  const t = types[libelles.indexOf(r.labels[0])];
  return t ? { value: t.value, label: t.label, score: Math.round(premier * 100) / 100, source: 'modele' } : null;
}

/** À défaut du modèle : le nom qui suit « société », « entreprise », « Ets »… */
function entrepriseNommee(texte) {
  const m = /(?:^|\s)(?:la\s+|l')?(?:soci[ée]t[ée]|entreprise|[ée]ts\.?|[ée]tablissements?|cabinet|groupe|agence)\s+(.+?)(?=\s*(?:[,;:!?]|\.(?:\s|$)|$|\s(?:(?:du|des|le)\s+\d|pour|acte|actes|n°|en\s+date|afin|svp|merci|s'il|qui|que|est|a\s)))/i.exec(String(texte || ''));
  const nom = m ? m[1].trim() : '';
  return nom.length >= 2 && nom.split(/\s+/).length <= 8 ? nom : null;
}

/** Une phrase « tient » si elle a au moins quatre mots : un simple nom ne se lit pas. */
const estPhrase = (texte) => String(texte || '').trim().split(/\s+/).filter(Boolean).length >= 4;

/**
 * Lit une demande écrite en phrase : entreprise, personnes, dates, n° d'acte,
 * année, typologie proposée. Ce qui n'est pas sûr reste vide.
 */
async function lireDemande(texte, types = []) {
  const t = String(texte || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  const res = { entreprise: null, personnes: [], dates: [], acte: acteDans(t), annee: null, typologie: null };
  if (!t) return res;
  if (estPhrase(t)) {
    const ner = await charger('entites');
    if (ner) {
      const entites = regrouper(t, await ner(t));
      const orgs = entites.filter((e) => e.type === 'ORG' && e.score >= 0.6);
      // L'entreprise : la plus longue des organisations nommées.
      res.entreprise = orgs.sort((a, b) => b.valeur.length - a.valeur.length)[0]?.valeur || null;
      res.personnes = entites.filter((e) => e.type === 'PER' && e.score >= 0.6).map((e) => e.valeur);
      res.dates = entites.filter((e) => e.type === 'DATE' && e.score >= 0.6).map((e) => e.valeur);
    }
    if (!res.entreprise) res.entreprise = entrepriseNommee(t);
    res.typologie = await typologieDe(t, types);
  } else {
    res.typologie = typeNomme(t, types);
  }
  const annee = /\b((?:19|20)\d{2})\b/.exec([res.acte, ...res.dates].filter(Boolean).join(' '));
  if (annee) res.annee = Number(annee[1]);
  return res;
}

module.exports = {
  MODELES, modelesActifs, memoireMo, actif, charger, oublierEchec, siPret, etat, prechauffer, vecteurs,
  regrouper, acteDans, typeNomme, entrepriseNommee, typologieDe, lireDemande, estPhrase, dossierModeles, _substituer,
};
