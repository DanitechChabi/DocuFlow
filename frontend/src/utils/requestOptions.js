/**
 * requestOptions — listes de choix du formulaire de demande, côté interface.
 *
 * Contrepartie de backend/src/helpers/requestOptions.js, dont il applique les
 * mêmes règles de normalisation. Les deux fichiers sont dupliqués à dessein :
 * le backend est en CommonJS, le frontend en modules ES, et aucun assemblage ne
 * traverse la frontière entre les deux projets. Toute modification des règles
 * doit être portée des deux côtés — sinon le formulaire proposerait des choix
 * que le serveur refuse, ou l'inverse.
 *
 * Trois formes d'écriture sont acceptées, parce qu'un administrateur qui saisit
 * du JSON à la main écrit rarement la forme complète :
 *   ["Statuts", "Contrat"]                      → libellé = valeur
 *   [{ value: "Statuts", label: "Statuts" }]    → forme canonique
 *   [{ value: "haute", label: "Haute", tone: "attention" }]  → priorités
 */

// Exportés — et pas seulement internes — pour qu'une épreuve puisse comparer
// cette liste à celle du backend. C'est la duplication annoncée en tête de
// fichier : sans moyen de la vérifier, elle finirait par dériver.
export const TONES = ['neutre', 'info', 'attention', 'urgent'];
export const DEFAULT_TONE = 'info';

/**
 * Traduction des tons en classes Tailwind.
 *
 * Cette table est la raison pour laquelle les tons forment une liste fermée :
 * Tailwind compile les classes présentes dans le source à la construction.
 * Une couleur libre venue de la base ne produirait aucune classe — la pastille
 * s'afficherait sans style. Les classes sont donc écrites en clair ici pour que
 * l'analyseur de Tailwind les voie.
 */
export const TONE_CLASSES = {
  neutre: 'bg-slate-200 text-slate-600',
  info: 'bg-blue-100 text-blue-600',
  attention: 'bg-orange-100 text-orange-600',
  urgent: 'bg-red-100 text-red-600',
};

/** Classe d'une priorité, avec repli sur le ton par défaut. */
export const toneClass = (tone) => TONE_CLASSES[tone] || TONE_CLASSES[DEFAULT_TONE];

/**
 * Normalise une liste de choix vers la forme canonique [{ value, label }].
 *
 * @param {*} raw valeur du réglage — tableau déjà analysé, ou chaîne JSON
 * @param {Array|string} fallback liste utilisée si `raw` est absent, illisible
 *   ou vide ; accepte aussi une chaîne JSON
 * @param {{ withTone?: boolean }} options `withTone` ajoute un ton validé
 */
export function normalizeOptions(raw, fallback = [], { withTone = false } = {}) {
  let source = raw;

  // `GET /api/settings` renvoie les réglages tels qu'ils sont stockés, en TEXT,
  // sans passer par parseValue : une liste arrive donc ici sous forme de chaîne
  // JSON. L'analyser côté composant serait à refaire à chaque appelant.
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

      // `value` est ce qui part en base ; un objet qui ne porte qu'un `label`
      // est traité comme la forme abrégée.
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

  // Deux entrées de même `value` donneraient deux <option> indiscernables et une
  // clé React dupliquée. La première saisie gagne.
  const seen = new Set();
  const unique = cleaned.filter((o) => {
    if (seen.has(o.value)) return false;
    seen.add(o.value);
    return true;
  });

  // Une liste vidée par erreur rendrait le champ — et donc le formulaire —
  // inutilisable. On retombe sur la liste d'origine, passée sans repli à son
  // tour : un appel récursif qui se repasserait `fallback` boucherait
  // indéfiniment si celui-ci était vide. Le test porte sur la présence de
  // contenu et non sur `.length`, car `fallback` peut être une chaîne JSON dont
  // la longueur est celle du texte.
  const hasFallback = Array.isArray(fallback)
    ? fallback.length > 0
    : typeof fallback === 'string' && fallback.trim() !== '';
  if (!unique.length) {
    return hasFallback ? normalizeOptions(fallback, [], { withTone }) : [];
  }
  return unique;
}

/**
 * Listes par défaut du formulaire.
 *
 * Elles ne servent que de filet : si les réglages sont indisponibles (backend
 * arrêté, organisation non provisionnée), le formulaire reste utilisable au lieu
 * d'afficher des listes vides. Elles doivent rester identiques aux valeurs par
 * défaut du catalogue backend (settingsCatalog.js, groupe « requests »).
 */
export const DEFAULT_DOCUMENT_TYPES = [
  { value: 'Statuts', label: 'Statuts' },
  { value: "PV d'Assemblée", label: "PV d'Assemblée" },
  { value: 'Bilan Financier', label: 'Bilan Financier' },
  { value: 'Registre de Commerce', label: 'Registre de Commerce' },
  { value: 'Contrat', label: 'Contrat' },
  { value: 'Autre', label: 'Autre' },
];

export const DEFAULT_MOTIFS = [
  { value: 'Actualisation', label: 'Actualisation' },
  { value: 'Création', label: "Création d'entreprise" },
  { value: 'Modification', label: 'Modification' },
  { value: 'Radiation', label: 'Radiation' },
  { value: 'Consultation', label: 'Consultation' },
  { value: 'Contentieux', label: 'Contentieux' },
];

export const DEFAULT_PRIORITIES = [
  { value: 'basse', label: 'Basse', tone: 'neutre' },
  { value: 'normale', label: 'Normale', tone: 'info' },
  { value: 'haute', label: 'Haute', tone: 'attention' },
  { value: 'urgente', label: 'Urgente', tone: 'urgent' },
];

/**
 * Les trois listes du formulaire, normalisées, telles que les livre un objet de
 * réglages. Regroupées ici pour que le composant n'ait pas à répéter le nom des
 * clés ni le choix des replis.
 *
 * @param {Object} settings réglages issus de SettingsContext
 */
export function requestFormOptions(settings = {}) {
  const priorities = normalizeOptions(
    settings.request_priorities,
    DEFAULT_PRIORITIES,
    { withTone: true }
  );

  // La priorité par défaut doit exister dans la liste : un administrateur peut
  // supprimer « normale » sans penser à ce réglage. Sans cette vérification, le
  // formulaire s'ouvrirait sur une valeur qu'aucun bouton ne représente —
  // l'utilisateur ne verrait aucune priorité sélectionnée.
  const wanted = String(settings.request_default_priority || '').trim();
  const defaultPriority = priorities.some((p) => p.value === wanted)
    ? wanted
    : priorities[0]?.value || '';

  // Le plafond de 5 est celui de multer côté serveur (upload.array('files', 5)),
  // qui ne peut pas dépendre du tenant : annoncer plus produirait un refus au
  // téléversement. Ce réglage ne peut donc que restreindre.
  const maxFilesRaw = Number(settings.request_max_files);
  const maxFiles = Number.isFinite(maxFilesRaw)
    ? Math.min(Math.max(Math.floor(maxFilesRaw), 1), 5)
    : 5;

  return {
    documentTypes: normalizeOptions(settings.request_document_types, DEFAULT_DOCUMENT_TYPES),
    motifs: normalizeOptions(settings.request_motifs, DEFAULT_MOTIFS),
    priorities,
    defaultPriority,
    maxFiles,
  };
}
