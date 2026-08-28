// ============================================================================
// permissions — catalogue des permissions DocuFlow (RBAC).
//
// LE CATALOGUE VIT EN CODE, PAS EN BASE. Les clés sont consommées par les
// routes (requirePermission) et par l'interface (matrice à cocher du panneau
// « Rôles & permissions ») : les versionner avec le code qui les applique
// garantit qu'une permission affichée existe vraiment, et qu'une permission
// appliquée est administrable. La base ne stocke que les clés accordées à
// chaque rôle (roles.permissions TEXT[]).
//
// CONVENTION : module.ressource_action (ex. documents.view). Le joker '*'
// signifie « toutes permissions » — réservé au super administrateur.
// ============================================================================

/**
 * Définition d'une permission pour l'interface d'administration.
 * `label` est la ligne de la matrice ; `description` son info-bulle.
 */
const CATALOGUE = [
  {
    module: 'requests',
    titre: 'Demandes',
    permissions: [
      { key: 'requests.view', label: 'Consulter les demandes', description: 'Liste et fiche détaillée des demandes (les siennes pour un demandeur, toutes pour le personnel).' },
      { key: 'requests.create', label: 'Créer une demande', description: 'Déposer une nouvelle demande.' },
      { key: 'requests.edit', label: 'Modifier une demande', description: 'Corriger les informations d\'une demande.' },
      { key: 'requests.delete', label: 'Supprimer une demande', description: 'Retirer définitivement une demande.' },
      { key: 'requests.assign', label: 'Affecter', description: 'Attribuer une demande à un agent ou un archiviste.' },
      { key: 'requests.process', label: 'Traiter', description: 'Faire avancer une demande affectée (transmettre, préparer).' },
      { key: 'requests.validate', label: 'Valider', description: 'Marquer une demande comme livrée.' },
      { key: 'requests.reject', label: 'Rejeter', description: 'Refuser une demande avec motif.' },
      { key: 'requests.close', label: 'Clôturer', description: 'Terminer le suivi d\'une demande.' },
      { key: 'requests.view_history', label: 'Voir l\'historique', description: 'Journal des transitions et actions d\'une demande.' },
    ],
  },
  {
    module: 'documents',
    titre: 'Documents',
    permissions: [
      { key: 'documents.view', label: 'Consulter', description: 'Liste, fiche et aperçu des documents.' },
      { key: 'documents.upload', label: 'Importer', description: 'Verser des fichiers, y compris en masse.' },
      { key: 'documents.edit', label: 'Modifier les métadonnées', description: 'Corriger les informations d\'un document.' },
      { key: 'documents.rename', label: 'Renommer', description: 'Changer le nom affiché d\'un document.' },
      { key: 'documents.move', label: 'Déplacer', description: 'Changer le classement d\'un document.' },
      { key: 'documents.download', label: 'Télécharger', description: 'Récupérer les fichiers d\'un document.' },
      { key: 'documents.share', label: 'Partager', description: 'Envoyer un accès par e-mail.' },
      { key: 'documents.delete', label: 'Supprimer', description: 'Mettre un document à la corbeille.' },
      { key: 'documents.restore', label: 'Restaurer', description: 'Sortir un document de la corbeille.' },
      { key: 'documents.purge', label: 'Purger définitivement', description: 'Détruire irrévocablement les documents de la corbeille.' },
      { key: 'documents.archive', label: 'Archiver', description: 'Basculer un document en archivage (et le sortir).' },
      { key: 'documents.manage_versions', label: 'Gérer les versions', description: 'Ajouter et retirer les fichiers d\'un document.' },
      { key: 'documents.view_history', label: 'Voir l\'historique', description: 'Journal documentaire complet.' },
      { key: 'documents.index', label: 'Indexer', description: 'Compléter l\'indexation des documents versés en masse (statut « à indexer »).' },
      { key: 'documents.validate', label: 'Valider un document', description: 'Approuver un document soumis à validation.' },
    ],
  },
  {
    module: 'folders',
    titre: 'Dossiers',
    permissions: [
      { key: 'folders.view', label: 'Consulter l\'arborescence', description: 'Voir les dossiers et sous-dossiers.' },
      { key: 'folders.create', label: 'Créer', description: 'Créer un dossier ou un sous-dossier.' },
      { key: 'folders.edit', label: 'Renommer', description: 'Renommer un dossier.' },
      { key: 'folders.move', label: 'Déplacer', description: 'Réorganiser l\'arborescence.' },
      { key: 'folders.delete', label: 'Supprimer', description: 'Retirer un dossier (les documents sont déclassés, jamais détruits).' },
    ],
  },
  {
    module: 'search',
    titre: 'Recherche',
    permissions: [
      { key: 'search.documents', label: 'Rechercher les documents', description: 'Recherche globale et filtres.' },
      { key: 'search.requests', label: 'Rechercher les demandes', description: 'Recherche dans les demandes.' },
      { key: 'search.advanced', label: 'Recherche avancée', description: 'Filtres combinables sur les métadonnées.' },
    ],
  },
  {
    module: 'admin',
    titre: 'Administration',
    permissions: [
      { key: 'users.view', label: 'Consulter les utilisateurs', description: 'Liste et fiche des comptes de l\'organisation.' },
      { key: 'users.create', label: 'Créer un utilisateur', description: 'Ouvrir un compte.' },
      { key: 'users.edit', label: 'Modifier un utilisateur', description: 'Changer nom, section, rôle.' },
      { key: 'users.disable', label: 'Désactiver', description: 'Suspendre un compte sans le détruire.' },
      { key: 'roles.view', label: 'Consulter les rôles', description: 'Voir les rôles et leurs permissions.' },
      { key: 'roles.create', label: 'Créer un rôle', description: 'Ajouter un rôle personnalisé.' },
      { key: 'roles.edit', label: 'Modifier un rôle', description: 'Changer nom, description et permissions.' },
      { key: 'roles.delete', label: 'Supprimer un rôle', description: 'Retirer un rôle inutilisé.' },
      { key: 'audit.view', label: 'Consulter les journaux', description: 'Journal d\'audit de l\'organisation.' },
      { key: 'settings.manage', label: 'Gérer la configuration', description: 'Réglages, marque, politique d\'upload.' },
      { key: 'groups.view', label: 'Consulter les groupes', description: 'Liste des groupes et membres.' },
      { key: 'groups.manage', label: 'Gérer les groupes', description: 'Créer, modifier, supprimer des groupes.' },
    ],
  },
];

// Index plat : clé → définition (validation rapide côté serveur).
const PAR_CLE = {};
for (const mod of CATALOGUE) {
  for (const p of mod.permissions) PAR_CLE[p.key] = { ...p, module: mod.module };
}

/** Toutes les clés valides. */
const TOUTES = Object.keys(PAR_CLE);

/** Une clé de permission est-elle connue du catalogue (ou le joker) ? */
function estValide(key) {
  return key === '*' || Boolean(PAR_CLE[key]);
}

/** Filtrer un tableau de clés : ne garder que les clés connues. */
function filtrerValides(cles) {
  if (!Array.isArray(cles)) return [];
  return [...new Set(cles)].filter(estValide);
}

// ---------------------------------------------------------------------------
// Rôles système — provisionnés pour chaque organisation (migration 019 et
// tenantProvisioningService). Ces définitions sont LA référence du code : la
// migration les reproduit en SQL, ce fichier les sert à l'interface et aux
// tests. Les ensembles calquent les pouvoirs réels du code d'avant le RBAC —
// la migration ne doit changer l'accès de personne.
// ---------------------------------------------------------------------------
const ROLES_SYSTEME = [
  {
    key: 'superadmin',
    name: 'Super administrateur',
    description: 'Accès complet à la plateforme, y compris l\'administration.',
    permissions: ['*'],
    embleme: '👑',
  },
  {
    key: 'admin',
    name: 'Administrateur',
    description: 'Gestion de l\'organisation : utilisateurs, rôles, configuration, GED et demandes.',
    permissions: [
      'requests.view', 'requests.create', 'requests.edit', 'requests.delete', 'requests.assign',
      'requests.process', 'requests.validate', 'requests.reject', 'requests.close', 'requests.view_history',
      'documents.view', 'documents.upload', 'documents.edit', 'documents.rename', 'documents.move',
      'documents.download', 'documents.share', 'documents.delete', 'documents.restore', 'documents.archive',
      'documents.manage_versions', 'documents.view_history', 'documents.index', 'documents.validate',
      'folders.view', 'folders.create', 'folders.edit', 'folders.move', 'folders.delete',
      'search.documents', 'search.requests', 'search.advanced',
      'users.view', 'users.create', 'users.edit', 'users.disable',
      'roles.view', 'roles.create', 'roles.edit', 'roles.delete',
      'audit.view', 'settings.manage', 'groups.view', 'groups.manage',
    ],
    embleme: '⚙️',
  },
  {
    key: 'responsable',
    name: 'Responsable',
    description: 'Supervision des demandes : affectation, traitement, validation, rejet.',
    permissions: [
      'requests.view', 'requests.create', 'requests.edit', 'requests.assign', 'requests.process',
      'requests.validate', 'requests.reject', 'requests.close', 'requests.view_history',
      'documents.view', 'documents.download',
      'search.documents', 'search.requests',
      'audit.view',
    ],
    embleme: '🧑‍💼',
  },
  {
    key: 'archiviste',
    name: 'Archiviste',
    description: 'Gestion documentaire : import, classement, métadonnées, versions, archivage.',
    permissions: [
      'requests.view', 'requests.process', 'requests.view_history',
      'documents.view', 'documents.upload', 'documents.edit', 'documents.rename', 'documents.move',
      'documents.download', 'documents.share', 'documents.archive', 'documents.manage_versions',
      'documents.view_history', 'documents.index', 'documents.validate',
      'folders.view', 'folders.create', 'folders.edit', 'folders.move', 'folders.delete',
      'search.documents', 'search.requests', 'search.advanced',
      'groups.view',
    ],
    embleme: '📚',
  },
  {
    key: 'agent',
    name: 'Agent',
    description: 'Opérations quotidiennes : créer des demandes, traiter celles qui lui sont attribuées, verser et consulter les documents.',
    permissions: [
      'requests.view', 'requests.create', 'requests.process', 'requests.view_history',
      'documents.view', 'documents.upload', 'documents.download',
      'search.documents', 'search.requests',
    ],
    embleme: '📝',
  },
  {
    key: 'demandeur',
    name: 'Demandeur',
    description: 'Déposer des demandes et suivre leur progression.',
    permissions: [
      'requests.view', 'requests.create', 'requests.view_history',
    ],
    embleme: '👤',
  },
  {
    key: 'lecteur',
    name: 'Lecteur',
    description: 'Consultation seule des documents et demandes autorisés.',
    permissions: [
      'requests.view',
      'documents.view', 'documents.download',
      'search.documents', 'search.requests',
    ],
    embleme: '👁️',
  },
];

/**
 * Un ensemble de permissions accorde-t-il une permission donnée ?
 * Le joker '*' couvre tout (super administrateur).
 */
function accorde(permissions, cherche) {
  if (!Array.isArray(permissions)) return false;
  return permissions.includes('*') || permissions.includes(cherche);
}

module.exports = {
  CATALOGUE,
  PAR_CLE,
  TOUTES,
  estValide,
  filtrerValides,
  ROLES_SYSTEME,
  accorde,
};
