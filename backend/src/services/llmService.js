// ============================================================================
// llmService — lecture des documents par un modèle de langage (OPTIONNEL).
//
// Deux fournisseurs, au choix de chaque organisation (réglage llm_provider) :
//   ollama  un serveur Ollama sur le réseau ou le poste : les documents ne
//           quittent pas la machine (adapté à l'application Windows hors ligne) ;
//   groq    l'API Groq : plus rapide, mais le TEXTE du document est envoyé à
//           un service externe — d'où un réglage explicite, « aucun » par
//           défaut, et une clé GROQ_API_KEY qui reste dans l'environnement du
//           serveur (jamais en base, jamais dans l'interface).
//
// Une seule requête classe ET extrait : moitié moins d'appels que deux
// requêtes séparées, et une réponse cohérente avec elle-même. Le texte envoyé
// est tronqué (4 000 caractères) : l'essentiel d'une facture ou d'un devis tient
// dans la première page, et c'est ce qui limite ce qui sort de chez vous.
//
// Aucune dépendance nouvelle : axios est déjà là. `http` est exposé pour que
// les tests substituent le réseau.
// ============================================================================
const axios = require('axios');
const settingsService = require('./settingsService');
const { extraireObjetJson, apercuReponse } = require('../helpers/jsonLlm');
const { NATURES } = require('../config/conformite');
const { parseMontant, chiffres } = require('./extractionRegles');
const { normaliser, trouverDates } = require('./indexSuggestionService');

const TEXTE_MAX = 4000;
const DELAI_MS = 60000;
const MODELES_DEFAUT = { groq: 'llama-3.3-70b-versatile', ollama: 'gpt-oss:20b' };
const URL_GROQ = 'https://api.groq.com/openai/v1/chat/completions';

const http = { post: (...args) => axios.post(...args) };

/**
 * Réglage effectif d'une organisation. `pret` est faux si le fournisseur
 * n'est pas utilisable (aucun, ou Groq sans clé) : l'analyse retombe alors sur
 * les règles, sans erreur.
 */
async function configuration(tenantId) {
  const r = await settingsService.getAll(tenantId);
  const provider = ['groq', 'ollama'].includes(r.llm_provider) ? r.llm_provider : 'aucun';
  const modele = String(r.llm_model || '').trim() || MODELES_DEFAUT[provider] || null;
  const baseUrl = String(r.llm_ollama_url || '').trim().replace(/\/+$/, '') || 'http://localhost:11434';
  const cleGroq = process.env.GROQ_API_KEY || '';
  let raison = null;
  if (provider === 'aucun') raison = 'Aucun modèle de langage configuré.';
  else if (provider === 'groq' && !cleGroq) raison = 'GROQ_API_KEY absente de l\'environnement du serveur.';
  return { provider, modele, baseUrl, cleGroq, pret: !raison, raison };
}

function consigne(referentiel) {
  const idPrincipal = referentiel?.principal;
  const idEtab = referentiel?.etablissement;
  const lignesId = [
    idPrincipal ? `  "identifiant": "<${idPrincipal.nom}, ${idPrincipal.longueur} chiffres uniquement, ou null>",` : '  "identifiant": null,',
    idEtab ? `  "etablissement": "<${idEtab.nom}, ${idEtab.longueur} chiffres uniquement, ou null>",` : '  "etablissement": null,',
  ].join('\n');
  return `Tu es un expert administratif et comptable francophone.
Analyse le texte suivant, extrait d'un document, puis classe-le et extrais ses informations clés.

Réponds UNIQUEMENT avec un objet JSON valide, exactement dans ce format (null quand l'information est absente) :
{
  "nature": "<facture|devis|attestation|autre>",
  "confiance": <nombre entre 0.0 et 1.0>,
${lignesId}
  "emetteur_nom": "<entité qui émet le document, ou null>",
  "emetteur_adresse": "<adresse de l'émetteur, ou null>",
  "destinataire_nom": "<destinataire ou client, ou null>",
  "destinataire_adresse": "<adresse du destinataire, ou null>",
  "montant_ht": "<montant hors taxes en chiffres, ex. 1500.00, ou null>",
  "montant_tva": "<montant de TVA en chiffres, ou null>",
  "montant_ttc": "<montant toutes taxes comprises en chiffres, ou null>",
  "devise": "<FCFA|EUR|USD ou null>",
  "date_emission": "<AAAA-MM-JJ ou null>",
  "date_echeance": "<AAAA-MM-JJ : échéance, validité ou expiration, ou null>",
  "numero_document": "<numéro de facture, devis ou attestation, ou null>"
}

Règles de classification :
- "facture" : demande de paiement, avec numéro de facture et montant dû ;
- "devis" : proposition commerciale préalable (y compris facture proforma) ;
- "attestation" : document officiel certifiant un fait (attestation fiscale ou sociale, certificat) ;
- "autre" : tout le reste.
Les montants sont des nombres décimaux sans espace. Les numéros d'entreprise ne contiennent que des chiffres.`;
}

async function appelerOllama(cfg, prompt) {
  const rep = await http.post(`${cfg.baseUrl}/api/chat`, {
    model: cfg.modele,
    messages: [{ role: 'user', content: prompt }],
    format: 'json',
    stream: false,
    options: { temperature: 0 },
  }, { timeout: DELAI_MS });
  return rep.data?.message?.content || '';
}

async function appelerGroq(cfg, prompt) {
  const rep = await http.post(URL_GROQ, {
    model: cfg.modele,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  }, { timeout: DELAI_MS, headers: { Authorization: `Bearer ${cfg.cleGroq}`, 'Content-Type': 'application/json' } });
  return rep.data?.choices?.[0]?.message?.content || '';
}

/** Date ISO réelle, ou null (le modèle invente parfois « 2026-02-30 »). */
function dateIso(v) {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  const [d] = trouverDates(String(v), normaliser(String(v)));
  return d ? d.iso : null;
}

const texteOuNull = (v, max = 200) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t && t.toLowerCase() !== 'null' ? t.slice(0, max) : null;
};

/**
 * Réponse brute du modèle → champs normalisés. Un champ mal formé devient null
 * plutôt que de faire échouer l'analyse : les règles prendront le relais.
 * @returns {{ nature, confiance, donnees }|null}  null si aucun objet JSON
 */
function interpreter(brut, referentiel) {
  const data = extraireObjetJson(brut);
  if (!data) return null;
  const nature = NATURES.includes(String(data.nature || '').toLowerCase()) ? String(data.nature).toLowerCase() : 'autre';
  let confiance = Number(data.confiance);
  confiance = Number.isFinite(confiance) ? Math.max(0, Math.min(1, confiance)) : 0.5;

  const lireId = (valeur, def) => {
    const c = chiffres(valeur);
    if (!c || !def) return { valide: null, declare: c || null };
    return { valide: c.length === def.longueur ? c : null, declare: c };
  };
  const principal = lireId(data.identifiant ?? data.siren, referentiel?.principal);
  const etab = lireId(data.etablissement ?? data.siret, referentiel?.etablissement);
  let identifiant = principal.valide;
  if (!identifiant && etab.valide && referentiel?.principal) identifiant = etab.valide.slice(0, referentiel.principal.longueur);

  const montant = (v) => { const n = parseMontant(v); return n === null ? null : Math.round(n * 100) / 100; };
  const devise = ['FCFA', 'EUR', 'USD'].includes(String(data.devise || '').toUpperCase()) ? String(data.devise).toUpperCase() : null;
  return {
    nature,
    confiance,
    donnees: {
      identifiant,
      identifiant_declare: principal.declare,
      etablissement: etab.valide,
      etablissement_declare: etab.declare,
      emetteur_nom: texteOuNull(data.emetteur_nom),
      emetteur_adresse: texteOuNull(data.emetteur_adresse, 300),
      destinataire_nom: texteOuNull(data.destinataire_nom),
      destinataire_adresse: texteOuNull(data.destinataire_adresse, 300),
      montant_ht: montant(data.montant_ht),
      montant_tva: montant(data.montant_tva),
      montant_ttc: montant(data.montant_ttc),
      devise,
      date_emission: dateIso(data.date_emission),
      date_echeance: dateIso(data.date_echeance),
      numero_document: texteOuNull(data.numero_document, 60),
    },
  };
}

/**
 * Analyse un texte avec le modèle de l'organisation.
 * @returns {Promise<{ nature, confiance, donnees, modele }>}
 * @throws si le fournisseur est inutilisable, injoignable ou répond sans JSON
 */
async function analyser(tenantId, texte, { referentiel, cfg = null } = {}) {
  const conf = cfg || await configuration(tenantId);
  if (!conf.pret) throw new Error(conf.raison);
  const prompt = `${consigne(referentiel)}\n\nTexte du document :\n---\n${String(texte || '').slice(0, TEXTE_MAX)}\n---`;
  const brut = conf.provider === 'groq' ? await appelerGroq(conf, prompt) : await appelerOllama(conf, prompt);
  const resultat = interpreter(brut, referentiel);
  if (!resultat) throw new Error(`Réponse du modèle illisible : ${apercuReponse(brut)}`);
  return { ...resultat, modele: `${conf.provider}/${conf.modele}` };
}

module.exports = { configuration, analyser, interpreter, consigne, http, MODELES_DEFAUT };
