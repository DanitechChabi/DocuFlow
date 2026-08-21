/**
 * Interprétation des questions posées à DocuBot.
 *
 * POURQUOI CE MODULE EXISTE SÉPARÉMENT DU COMPOSANT
 *
 * L'analyse d'une question est du calcul pur : une phrase et le vocabulaire réel
 * du référentiel entrent, un jeu de filtres sort. Laissée dans le composant, elle
 * n'était éprouvable qu'en montant React et en simulant une frappe — c'est-à-dire
 * en pratique pas éprouvée du tout, ce qui explique que le défaut décrit
 * ci-dessous ait vécu si longtemps. Ici, chaque cas s'écrit en une ligne.
 *
 * LE DÉFAUT QUE CE MODULE CORRIGE
 *
 * L'ancien analyseur portait sept types de documents écrits en dur — `contrat`,
 * `facture`, `rapport`, `pv`, `lettre`, `dossier`, `acte` — qu'il mettait en
 * capitale initiale avant de les envoyer à `GET /documents`. Or cette route
 * filtre par ÉGALITÉ STRICTE (`d.type_document = $n`), et les types réellement
 * stockés sont ceux que l'organisation a saisis : « Contrat », « Autre »,
 * « Statuts », « Acte Assemblé »…
 *
 * « Montre les factures » envoyait donc `type_document='Facture'`, qui ne
 * correspondait à RIEN, et le bot répondait « aucun document » sur un référentiel
 * qui en contenait — sans que rien ne signale que le filtre, et non les données,
 * était en cause. Seul « contrat » marchait, par coïncidence de casse.
 *
 * Le vocabulaire vient désormais des FACETTES que `listDocuments` renvoie avec
 * chaque réponse (`facets.type_document`, `.statut`, `.tags`, `.annees`). Le bot
 * ne peut plus proposer un filtre qui ne correspond à aucun document, puisqu'il
 * ne connaît que des valeurs présentes en base.
 */

// Synonymes admis pour les trois statuts livrés par défaut. Le tableau est indexé
// par la forme NORMALISÉE du statut et non par le statut lui-même : une
// organisation qui renomme ses statuts perd simplement ces synonymes, elle ne
// perd pas la reconnaissance du mot exact, qui vient des facettes.
export const SYNONYMES_STATUT = {
  disponible: ['actif', 'valide', 'en cours'],
  pret: ['prete', 'a livrer', 'livrable'],
  archive: ['ancien', 'archivage'],
};

// Verbes d'intention et mots de liaison retirés de la recherche libre : les
// laisser ferait chercher « trouve » dans les descriptions de documents.
const MOTS_OUTILS = new Set([
  'trouve', 'trouver', 'cherche', 'cherchez', 'chercher', 'recherche', 'affiche',
  'afficher', 'montre', 'montrer', 'liste', 'lister', 'donne', 'donner',
  'combien', 'nombre', 'total', 'stats', 'statistiques', 'document', 'documents',
  'tout', 'tous', 'toute', 'toutes', 'les', 'des', 'du', 'de', 'la', 'le', 'un',
  'une', 'en', 'pour', 'dans', 'sur', 'avec', 'quel', 'quels', 'quelle',
  'quelles', 'y', 'a', 'il', 'est', 'ce', 'ai', 'j', 'que', 'qui',
]);

const PONCTUATION = /[?!.,;:«»"'’]/g;

/**
 * Minuscules, sans accents : « Acte Assemblé » et « acte assemble » se valent.
 *
 * `\p{Mn}` — « Mark, nonspacing » — plutôt qu'une plage de diacritiques écrite
 * en clair : après NFD, chaque accent devient précisément une marque combinante
 * de cette catégorie. Écrits littéralement, ces signes sont invisibles dans un
 * éditeur (ils se collent au crochet qui les précède) et un réencodage du fichier
 * les perdrait sans qu'aucune erreur ne le signale — la normalisation cesserait
 * alors silencieusement d'ignorer les accents.
 */
export const normaliser = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/\p{Mn}/gu, '');

/** Mot nu : sans ponctuation, sans accent, sans « s » final. */
const motNu = (mot) => normaliser(mot).replace(PONCTUATION, '').replace(/s$/, '');

/** Découpe une phrase en mots nus, les vides écartés. */
const enMots = (texte) => String(texte ?? '').split(/\s+/).map(motNu).filter(Boolean);

/**
 * Cherche, parmi les valeurs réellement présentes en base, celle que la phrase
 * mentionne.
 *
 * LA COMPARAISON PORTE SUR DES SUITES DE MOTS, PAS SUR DES SOUS-CHAÎNES.
 *
 * Une comparaison par sous-chaîne échoue sur les valeurs de plusieurs mots dès
 * que la phrase les met au pluriel : « Acte Assemblé » normalisé donne
 * « acte assemble », qui n'est PAS contenu dans « les actes assembles » — le
 * « s » de « actes » tombe au milieu. C'est précisément la question qu'un
 * utilisateur pose, et elle ne trouvait rien.
 *
 * Chaque mot est donc réduit à sa forme nue (sans accent, sans ponctuation, sans
 * « s » final) de part et d'autre, et l'on cherche la suite de mots de la valeur
 * comme sous-suite CONTIGUË des mots de la phrase. Cela règle du même coup :
 *
 *   • les deux sens du pluriel — « les contrats » trouve « Contrat », et
 *     « le statuts » trouve « Statuts » ;
 *   • les valeurs courtes, sans seuil arbitraire : « PV » ne se déclenche plus
 *     dans « approuvé », puisqu'une correspondance exige désormais un mot entier.
 *
 * Les valeurs sont essayées de la plus longue à la plus courte — d'abord en
 * nombre de mots — pour que « Acte Assemblé » gagne sur « Acte » quand les deux
 * existent : sans cet ordre, « montre les actes assemblés » filtrerait sur
 * « Acte » et ramènerait aussi les actes simples.
 */
export function trouverFacette(texte, valeurs) {
  const mots = enMots(texte);
  const candidates = (valeurs || [])
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .map((valeur) => ({ valeur, mots: enMots(valeur) }))
    .filter((c) => c.mots.length > 0)
    .sort((a, b) => (b.mots.length - a.mots.length) || (String(b.valeur).length - String(a.valeur).length));

  for (const { valeur, mots: attendus } of candidates) {
    for (let i = 0; i + attendus.length <= mots.length; i += 1) {
      if (attendus.every((m, j) => mots[i + j] === m)) return valeur;
    }
  }
  return null;
}

/**
 * Statut mentionné : d'abord le mot exact, puis les synonymes des défauts.
 *
 * Les synonymes se comparent en sous-chaîne et non en mots, parce que certains
 * sont des locutions (« en cours », « a livrer ») dont on veut la reconnaissance
 * telle quelle.
 */
export function trouverStatut(texte, statuts) {
  const direct = trouverFacette(texte, statuts);
  if (direct) return direct;
  const t = normaliser(texte);
  for (const statut of statuts || []) {
    const syn = SYNONYMES_STATUT[normaliser(statut)];
    if (syn && syn.some((mot) => t.includes(mot))) return statut;
  }
  return null;
}

/**
 * Analyse une question et renvoie les filtres à passer à `GET /documents`.
 *
 * @param {string} texte     La question, telle que saisie.
 * @param {object} facettes  `facets` de la dernière réponse du backend.
 * @returns {{compter: boolean, query: string|null, type: string|null,
 *            annee: number|null, statut: string|null, tag: string|null}}
 */
export function analyserQuestion(texte, facettes = {}) {
  const f = facettes || {};
  const phrase = String(texte ?? '');
  const intention = { compter: false, query: null, type: null, annee: null, statut: null, tag: null };

  // Les années retenues sont d'abord celles qui EXISTENT : demander « 2019 »
  // quand rien n'y est classé renvoie une liste vide, alors que la même question
  // sans filtre d'année aurait trouvé le document par son numéro. À défaut de
  // facette (chargement en échec), toute année plausible est acceptée.
  const anneesConnues = (f.annees || []).map(Number);
  const anneesCitees = (phrase.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
  intention.annee = anneesCitees.find((a) => anneesConnues.includes(a))
    ?? (anneesConnues.length ? null : anneesCitees.find((a) => a >= 1900 && a <= 2100))
    ?? null;

  intention.type = trouverFacette(phrase, f.type_document);
  intention.statut = trouverStatut(phrase, f.statut);
  intention.tag = trouverFacette(phrase, f.tags);
  intention.compter = /\b(combien|nombre|total|stats|statistiques)\b/i.test(phrase);

  // Une étiquette qui répète le type ou le statut n'apporte pas de filtre
  // supplémentaire : elle en RETIRE. Un document de type « Contrat » n'est pas
  // nécessairement étiqueté « contrat », et cumuler les deux ne renverrait que
  // l'intersection — donc souvent rien.
  if (intention.tag && (normaliser(intention.tag) === normaliser(intention.type || '')
    || normaliser(intention.tag) === normaliser(intention.statut || ''))) {
    intention.tag = null;
  }

  // Les mots correspondant à une valeur reconnue sont retirés de la recherche
  // libre, MOT PAR MOT, en comparant chaque mot sous sa forme normalisée.
  //
  // Les garder ajouterait un `ILIKE` redondant, et surtout un `ILIKE` qui peut
  // CONTREDIRE le filtre : « contrats de Dupont » chercherait la chaîne
  // « contrat Dupont » dans une même colonne, sans jamais rien trouver.
  //
  // Le découpage porte sur les mots et non sur des positions calculées dans la
  // forme normalisée : NFD ne conserve la longueur que pour les accents latins
  // — « 한 » se décompose en trois caractères — et un découpage par index
  // tomberait alors au milieu d'un mot.
  const aRetirer = new Set();
  for (const valeur of [intention.type, intention.statut, intention.tag]) {
    for (const mot of enMots(valeur)) aRetirer.add(mot);
  }
  const anneeCitee = intention.annee ? String(intention.annee) : null;

  const query = phrase.split(/\s+/)
    .map((mot) => [mot.replace(PONCTUATION, ''), motNu(mot)])
    .filter(([, nu]) => nu && nu !== anneeCitee && !aRetirer.has(nu) && !MOTS_OUTILS.has(nu))
    .map(([brut]) => brut)
    .join(' ')
    .trim();

  // Deux caractères ou moins ne discriminent rien : « de X » réduit à « X »
  // ramènerait la moitié du référentiel. Mieux vaut alors laisser les seuls
  // filtres structurés opérer.
  if (query.length > 2) intention.query = query;

  return intention;
}

/** Description des filtres retenus, pour que la réponse du bot soit vérifiable. */
export function decrireFiltres(intention) {
  const parts = [];
  if (intention.query) parts.push(`pour « ${intention.query} »`);
  if (intention.type) parts.push(`de type « ${intention.type} »`);
  if (intention.statut) parts.push(`au statut « ${intention.statut} »`);
  if (intention.tag) parts.push(`étiquetés « ${intention.tag} »`);
  if (intention.annee) parts.push(`en ${intention.annee}`);
  return parts.length ? ' ' + parts.join(', ') : '';
}

/** Filtres → paramètres de `GET /documents`. */
export function versParametres(intention, pageSize = 5) {
  const params = { page: 1, page_size: pageSize };
  if (intention.query) params.q = intention.query;
  if (intention.type) params.type_document = intention.type;
  if (intention.annee) params.annee = intention.annee;
  if (intention.statut) params.statut = intention.statut;
  if (intention.tag) params.tag = intention.tag;
  return params;
}
