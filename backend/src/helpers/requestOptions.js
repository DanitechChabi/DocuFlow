/**
 * requestOptions — normalisation des listes de choix du formulaire de demande.
 *
 * Les types de document, motifs et priorités étaient codés en dur dans
 * RequestForm.jsx : les changer imposait un redéploiement du frontend, alors que
 * ce vocabulaire est propre au métier de chaque organisation. Ils viennent
 * désormais des réglages (`request_document_types`, `request_motifs`,
 * `request_priorities`).
 *
 * Ce module existe parce que ces valeurs sont lues à DEUX endroits qui ne
 * doivent pas diverger : le formulaire, qui propose les choix, et le
 * contrôleur, qui les vérifie avant l'insertion. Une liste normalisée d'un côté
 * seulement laisserait passer côté serveur ce que l'interface interdit, ou
 * l'inverse.
 *
 * Trois formes d'écriture sont acceptées, parce qu'un administrateur qui saisit
 * du JSON à la main écrit rarement la forme complète :
 *   ["Statuts", "Contrat"]                       → libellé = valeur
 *   [{ value: "Statuts", label: "Statuts" }]     → forme canonique
 *   [{ value: "haute", label: "Haute", tone: "attention" }]  → priorités
 *
 * La contrepartie du frontend est frontend/src/utils/requestOptions.js, qui
 * applique les mêmes règles. Les deux fichiers sont volontairement dupliqués :
 * le backend est en CommonJS, le frontend en modules ES, et aucun bundler ne
 * traverse la frontière entre les deux projets.
 */

/**
 * Tons de priorité autorisés.
 *
 * Liste FERMÉE, et c'est essentiel : les pastilles de priorité s'appuient sur
 * des classes Tailwind (`bg-orange-100 text-orange-600`) compilées à la
 * construction du frontend. Une couleur saisie librement ne produirait aucune
 * classe et la pastille s'afficherait sans style. On expose donc des tons
 * nommés, dont la traduction en classes vit côté frontend.
 */
const TONES = ['neutre', 'info', 'attention', 'urgent'];

const DEFAULT_TONE = 'info';

/**
 * Normalise une liste de choix vers la forme canonique [{ value, label }].
 *
 * @param {*} raw valeur du réglage — tableau déjà analysé, ou chaîne JSON
 * @param {Array|string} fallback liste utilisée si `raw` est absent, illisible
 *   ou vide. Accepte aussi une chaîne JSON, ce qui permet de lui passer
 *   directement la valeur par défaut du catalogue (stockée sous forme de texte).
 * @param {{ withTone?: boolean }} options `withTone` ajoute un ton validé
 * @returns {Array<{value: string, label: string, tone?: string}>}
 */
function normalizeOptions(raw, fallback = [], { withTone = false } = {}) {
  let source = raw;

  // Les réglages sont stockés en TEXT et `GET /api/settings` les renvoie tels
  // quels, sans passer par parseValue : la chaîne JSON doit être analysée ici.
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }

  if (!Array.isArray(source)) source = null;

  const cleaned = (source || [])
    .map((entry) => {
      // Forme abrégée : une chaîne sert à la fois de valeur et de libellé. Elle
      // rejoint la forme complète au lieu d'être renvoyée telle quelle, sans
      // quoi une liste à tons mêlant les deux écritures livrerait des entrées
      // dépourvues de `tone` — la sortie ne serait canonique qu'à moitié.
      const brut = typeof entry === 'string' ? { value: entry } : entry;
      if (!brut || typeof brut !== 'object') return null;

      // `value` est ce qui part en base : sans elle l'entrée n'a pas de sens.
      // On tolère un objet qui ne porte qu'un `label` — c'est alors lui qui
      // fait office de valeur, comme dans la forme abrégée.
      const value = String(brut.value ?? brut.label ?? '').trim();
      if (!value) return null;

      const label = String(brut.label ?? brut.value ?? '').trim() || value;
      const out = { value, label };

      if (withTone) {
        const tone = String(brut.tone || '').trim().toLowerCase();
        out.tone = TONES.includes(tone) ? tone : DEFAULT_TONE;
      }
      return out;
    })
    .filter(Boolean);

  // Deux entrées de même `value` produiraient deux <option> indiscernables et
  // une clé React dupliquée. La première gagne : c'est l'ordre de saisie de
  // l'administrateur qui fait foi.
  const seen = new Set();
  const unique = cleaned.filter((o) => {
    if (seen.has(o.value)) return false;
    seen.add(o.value);
    return true;
  });

  // Une liste vidée par erreur rendrait le champ inutilisable — donc impossible
  // d'enregistrer une demande. On retombe sur la liste d'origine plutôt que de
  // livrer un formulaire bloqué.
  //
  // Le repli est passé une seule fois, sans lui-même de repli : un appel
  // récursif qui se repasserait `fallback` boucherait indéfiniment si celui-ci
  // était vide. Le test porte sur la présence de contenu, pas sur `.length` :
  // `fallback` peut être une chaîne JSON, dont la longueur est celle du texte.
  const hasFallback = Array.isArray(fallback)
    ? fallback.length > 0
    : typeof fallback === 'string' && fallback.trim() !== '';
  if (!unique.length) {
    return hasFallback ? normalizeOptions(fallback, [], { withTone }) : [];
  }
  return unique;
}

/** Valeurs admissibles d'une liste normalisée, prêtes pour une vérification. */
function allowedValues(options) {
  return options.map((o) => o.value);
}

module.exports = { TONES, DEFAULT_TONE, normalizeOptions, allowedValues };
