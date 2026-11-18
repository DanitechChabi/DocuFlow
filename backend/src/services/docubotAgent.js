// ============================================================================
// DocuBot raisonne (056) : pour une question qui demande plusieurs
// recherches (« quels dossiers de Credo BTP sont sortis, et chez qui ? »,
// « compare les sorties de ce mois et du mois dernier »), le modèle de langue
// d'Ollama choisit des outils — les mêmes recherches que DocuBot —, lit leurs
// résultats, en relance si besoin, puis rédige la réponse. Il ne voit que ce
// que les outils lui rendent, avec les droits de la personne : il ne peut ni
// inventer un dossier ni voir ce qu'elle n'a pas le droit de voir.
// ============================================================================

const ollama = require('./ollamaService');

const MAX_TOURS = 4;

const OUTILS = [
  ['chercher_dossier', 'Où se trouve un dossier aux archives (semaine, date du point, lettre, armoire), par nom d\'entreprise ou n° d\'acte.', { entreprise: 'nom de l\'entreprise', acte: 'n° d\'acte, ex. 2025/2479' }],
  ['qui_a_le_dossier', 'Si un dossier est sorti, chez qui, depuis quand et jusqu\'à quand.', { entreprise: 'nom de l\'entreprise ou n° d\'acte' }],
  ['mes_demandes', 'Les demandes de la personne qui pose la question et leur état.', { entreprise: 'facultatif : filtrer sur une entreprise' }],
  ['retards', 'Les dossiers en retard (pour l\'archive) ou à rendre (pour un agent).', {}],
  ['travail_du_jour', 'Pour l\'archive : demandes à transmettre, retards, compléments attendus.', {}],
  ['chiffres', 'Un nombre : dossiers entrés, sortis, retournés, demandes, sur une période écrite en français (ce mois, en octobre 2025, cette semaine…).', { question: 'la question de chiffre, ex. « combien de dossiers sortis en octobre 2025 »' }],
  ['entrees_semaine', 'Les dossiers entrés la semaine d\'une date donnée.', { date: 'AAAA-MM-JJ' }],
  ['aide', 'Comment faire quelque chose dans l\'application ou aux archives (procédures).', { question: 'la question d\'aide' }],
].map(([name, description, props]) => ({
  type: 'function',
  function: {
    name, description,
    parameters: { type: 'object', properties: Object.fromEntries(Object.entries(props).map(([k, d]) => [k, { type: 'string', description: d }])), required: [] },
  },
}));

const CONSIGNE = (droits, jour) => `Tu es DocuBot, l'assistant des archives de l'AFGC. Nous sommes le ${jour}.
La personne est ${droits.archive ? 'archiviste' : 'un agent (demandeur)'}.
Pour répondre, utilise les outils : ils interrogent la base des archives. Tu peux en appeler plusieurs, l'un après l'autre.
Règles :
- N'invente jamais un dossier, un nom, une date ou un chiffre : ne dis que ce que les outils ont rendu.
- Si les outils ne donnent pas la réponse, dis-le simplement.
- Réponds en français, en phrases courtes, sans titre ni tableau ; mets en **gras** l'essentiel.`;

/** Le résultat d'un outil, en texte compact pour le modèle ; garde aussi les fiches pour l'affichage. */
function resume(res) {
  const lignes = [String(res.texte || '').replace(/\*\*/g, '')];
  for (const e of (res.elements || []).slice(0, 6)) lignes.push(`- ${e.titre} : ${(e.lignes || []).join(' ; ').replace(/\*\*/g, '')}${e.note ? ` (${e.note})` : ''}`);
  return lignes.join('\n').slice(0, 2500);
}

/**
 * Raisonne sur une question. `outils` : les recherches de docubotService.
 * Rend { texte, elements, actions, etapes, source: 'agent' } ou null (Ollama absent ou muet).
 */
async function raisonner(tenantId, question, droits, outils, { jour = new Date().toISOString().slice(0, 10) } = {}) {
  if (!(await ollama.regle(tenantId))) return null;
  const messages = [{ role: 'system', content: CONSIGNE(droits, jour) }, { role: 'user', content: String(question).slice(0, 500) }];
  const etapes = [];
  const elements = [];
  const actions = [];
  for (let tour = 0; tour < MAX_TOURS; tour += 1) {
    const m = await ollama.tourAvecOutils(tenantId, messages, OUTILS, { delai: 90000 });
    if (!m) return null;
    const appels = m.tool_calls || [];
    if (!appels.length) {
      const texte = String(m.content || '').trim();
      if (!texte) return null;
      return { texte, elements: elements.slice(0, 6), actions: actions.slice(0, 3), etapes, source: 'agent', modele: m.modele };
    }
    messages.push({ role: 'assistant', content: m.content || '', tool_calls: appels });
    for (const appel of appels.slice(0, 3)) {
      const nom = appel.function?.name;
      let args = appel.function?.arguments || {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      const outil = outils[nom];
      let contenu;
      if (!outil) {
        contenu = `Outil inconnu : ${nom}.`;
      } else {
        try {
          const res = await outil(args);
          etapes.push(nom);
          for (const e of res.elements || []) if (!elements.some((x) => x.titre === e.titre && JSON.stringify(x.lignes) === JSON.stringify(e.lignes))) elements.push(e);
          for (const a of res.actions || []) if (!actions.some((x) => x.libelle === a.libelle)) actions.push(a);
          contenu = resume(res);
        } catch (err) {
          contenu = `Erreur de l'outil : ${err.message}`;
        }
      }
      messages.push({ role: 'tool', content: contenu, tool_name: nom });
    }
  }
  return null;
}

// Une question « complexe » : plusieurs demandes, une comparaison, un pourquoi,
// une synthèse. Les autres vont au chemin rapide (règles et modèle appris).
const COMPLEXE = /\b(compar\w*|par rapport|pourquoi|analys\w*|r[ée]sum\w*|synth[èe]se|tendance|[ée]volution|plus que|moins que|lesquels? .* et|et (aussi|qui|quand|o[uù]|combien|chez qui)|puis|ensuite|en m[êe]me temps)\b/i;
const complexe = (question) => COMPLEXE.test(String(question)) || String(question).length > 140 || (String(question).match(/\?/g) || []).length > 1;

module.exports = { raisonner, complexe, OUTILS, MAX_TOURS };
