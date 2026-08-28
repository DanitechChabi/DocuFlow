// ============================================================================
// documentStateMachine — cycle de vie d'un document, source de vérité unique.
//
// Modèle du cycle (chaque flèche = transition autorisée) :
//
//   à indexer ──→ disponible ──→ en validation ──→ prêt ──→ archivé
//      │             │               │                │        │
//      │             └──→ prêt ──────┘                │        │
//      └──→ en validation    └─→ disponible (refus)   │        │
//                                    disponible ←─────┘        │
//                                              prêt ←──────────┘ (désarchivage)
//
// RÈGLES PORTEUSES DE SENS MÉTIER :
//   • ARCHIVÉ = FIGÉ : lecture seule. Le sortir exige un désarchivage
//     explicite (permission documents.archive) — jamais une modification
//     directe « comme un document actif ».
//   • EN VALIDATION = intermédiaire : la validation mène à « prêt », le refus
//     ramène à « disponible » pour correction.
//   • À INDEXER = entrée du cycle : posé par le versement en masse, quitté
//     par l'indexation (directe ou soumise à validation).
//
// La copie en base (document_transitions, migration 020) est vérifiée contre
// ce fichier par les tests — les deux se contredire doit échouer.
// ============================================================================

const STATUTS = [
  { key: 'à indexer', label: 'À indexer', step: 1, ton: 'pending' },
  { key: 'disponible', label: 'Disponible', step: 2, ton: 'ok' },
  { key: 'en validation', label: 'En validation', step: 3, ton: 'info' },
  { key: 'prêt', label: 'Prêt', step: 4, ton: 'ok' },
  { key: 'archivé', label: 'Archivé', step: 5, ton: 'done' },
];

const TRANSITIONS = {
  'à indexer': ['disponible', 'en validation'],
  disponible: ['en validation', 'prêt', 'archivé'],
  'en validation': ['prêt', 'disponible', 'archivé'],
  prêt: ['archivé', 'disponible'],
  archivé: ['prêt'], // désarchivage uniquement
};

// Le premier de la liste = proposition par défaut de l'interface.
const TRANSITIONS_LABELS = {
  'à indexer>disponible': 'Indexé — disponible',
  'à indexer>en validation': 'Indexé — soumettre à validation',
  'disponible>en validation': 'Soumettre à validation',
  'disponible>prêt': 'Valider',
  'disponible>archivé': 'Archiver',
  'en validation>prêt': 'Valider',
  'en validation>disponible': 'Refuser la validation',
  'en validation>archivé': 'Archiver',
  'prêt>archivé': 'Archiver',
  'prêt>disponible': 'Remettre en circulation',
  'archivé>prêt': 'Désarchiver',
};

const STATUTS_VALIDES = new Set(STATUTS.map((s) => s.key));
const TERMINAL_LectureSeule = new Set(['archivé']);

const isValidStatus = (statut) => STATUTS_VALIDES.has(statut);
const estLectureSeule = (statut) => TERMINAL_LectureSeule.has(statut);
const label = (statut) => (STATUTS.find((s) => s.key === statut) || {}).label || statut;

/**
 * Une transition est-elle autorisée ?
 * @returns {{ ok: boolean, reason?: string }}
 */
function canTransition(from, to) {
  if (!isValidStatus(to)) {
    return { ok: false, reason: `Statut inconnu : « ${to} ».` };
  }
  if (from === to) {
    return { ok: false, reason: 'Le document est déjà dans ce statut.' };
  }
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `Transition non autorisée : « ${label(from)} » → « ${label(to)} ».`,
    };
  }
  return { ok: true };
}

/**
 * Transitions proposables depuis un statut (pour l'interface) :
 * [{ to, label }] — vides depuis « archivé » sans la permission d'archivage,
 * l'interface les filtrant selon les droits.
 */
function nextSteps(from) {
  if (!isValidStatus(from)) return [];
  return (TRANSITIONS[from] || []).map((to) => ({
    to,
    label: TRANSITIONS_LABELS[`${from}>${to}`] || label(to),
  }));
}

module.exports = {
  STATUTS,
  TRANSITIONS,
  TRANSITIONS_LABELS,
  isValidStatus,
  estLectureSeule,
  label,
  canTransition,
  nextSteps,
};
