/**
 * Domaine des statuts de document, en un seul endroit.
 *
 * Cette table existait en TROIS copies divergentes — `DocumentsPage`,
 * `DraggableDocumentCard` et `DocumentDetailsModal` — et c'est cette divergence
 * qui a produit le défaut : la migration 018 a ajouté « à indexer » (posé par le
 * téléversement en masse), mais aucune des trois copies ne le connaissait. Les
 * documents versés en masse s'affichaient donc avec un badge sans couleur et le
 * libellé brut, et le sélecteur de la fiche — construit par
 * `Object.entries(STATUS_LABELS)` — ne proposait pas le statut, tout en
 * l'affichant comme valeur courante.
 *
 * Le domaine est la réplique exacte de la machine à états du serveur
 * (backend/src/services/documentStateMachine.js) et de la contrainte
 * `documents_statut_check` en base (migration 020) : « en validation »
 * s'insère désormais entre « disponible » et « prêt ». Un statut présent
 * ici et absent là-bas fait échouer l'enregistrement en 400.
 */

// Ordre du cycle de vie : une fiche versée en masse est « à indexer », devient
// « disponible » une fois ses métadonnées saisies (directement ou via une
// validation), puis suit son cours jusqu'à l'archivage. C'est l'ordre dans
// lequel les sélecteurs les présentent.
export const STATUS_LABELS = {
  'à indexer': 'À indexer',
  'disponible': 'Disponible',
  'en validation': 'En validation',
  'prêt': 'Prêt',
  'archivé': 'Archivé',
};

export const STATUS_CLASSES = {
  // Ambre : une fiche à indexer réclame une action, comme une demande en attente.
  'à indexer': 'status-badge-pending',
  'disponible': 'status-badge-delivered',
  'en validation': 'status-badge-pending',
  'prêt': 'status-badge-progress',
  'archivé': 'status-badge-annulled',
};

// Valeurs acceptées à l'écriture. Dérivée des libellés : deux listes maintenues
// à la main finiraient par diverger, ce qui est exactement le défaut corrigé ici.
export const STATUS_VALUES = Object.keys(STATUS_LABELS);

/**
 * Transitions proposables depuis un statut (miroir de documentStateMachine
 * côté serveur) : le sélecteur de la fiche n'affiche QUE ces sorties — une
 * transition impossible ne doit jamais être soumise à un 400.
 */
export const STATUS_TRANSITIONS = {
  'à indexer': [
    { to: 'disponible', label: 'Indexé — disponible' },
    { to: 'en validation', label: 'Indexé — soumettre à validation' },
  ],
  disponible: [
    { to: 'en validation', label: 'Soumettre à validation' },
    { to: 'prêt', label: 'Valider' },
    { to: 'archivé', label: 'Archiver' },
  ],
  'en validation': [
    { to: 'prêt', label: 'Valider' },
    { to: 'disponible', label: 'Refuser la validation' },
    { to: 'archivé', label: 'Archiver' },
  ],
  prêt: [
    { to: 'archivé', label: 'Archiver' },
    { to: 'disponible', label: 'Remettre en circulation' },
  ],
  archivé: [
    { to: 'prêt', label: 'Désarchiver' },
  ],
};

/** Un document archivé est en lecture seule (hors désarchivage). */
export const estLectureSeule = (statut) => statut === 'archivé';
