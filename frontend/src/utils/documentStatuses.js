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
 * Le domaine doit rester aligné sur la liste `ALLOWED` de `setStatus`
 * (backend/src/controllers/documentController.js) et sur la contrainte
 * `documents_statut_check` en base (docs/migrations/018_bulk_upload_status.sql).
 * Un statut présent ici et absent là-bas fait échouer l'enregistrement en 400.
 */

// Ordre du cycle de vie : une fiche versée en masse est « à indexer », devient
// « disponible » une fois ses métadonnées saisies, puis suit son cours. C'est
// l'ordre dans lequel les sélecteurs les présentent.
export const STATUS_LABELS = {
  'à indexer': 'À indexer',
  'disponible': 'Disponible',
  'prêt': 'Prêt',
  'archivé': 'Archivé',
};

export const STATUS_CLASSES = {
  // Ambre : une fiche à indexer réclame une action, comme une demande en attente.
  'à indexer': 'status-badge-pending',
  'disponible': 'status-badge-delivered',
  'prêt': 'status-badge-progress',
  'archivé': 'status-badge-annulled',
};

// Valeurs acceptées à l'écriture. Dérivée des libellés : deux listes maintenues
// à la main finiraient par diverger, ce qui est exactement le défaut corrigé ici.
export const STATUS_VALUES = Object.keys(STATUS_LABELS);
