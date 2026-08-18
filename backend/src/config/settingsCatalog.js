/**
 * settingsCatalog.js — Catalogue de TOUS les paramètres configurables.
 *
 * Source de vérité au runtime. Ce fichier remplace la whitelist en dur de
 * settingsController (7 clés seulement), qui rendait la quasi-totalité de la
 * configuration inaccessible au superadministrateur.
 *
 * Le catalogue est synchronisé dans la table `setting_definitions` au démarrage
 * (voir tenantProvisioningService.syncSettingDefinitions) afin que la base reste
 * cohérente et que la migration 013 puisse provisionner un tenant sans le code.
 * Ajouter un paramètre = ajouter une entrée ici, sans redéploiement de schéma.
 *
 * Champs d'une entrée :
 *   key          identifiant stocké dans settings.key
 *   group        onglet de la console de configuration
 *   label        libellé affiché
 *   description  aide contextuelle
 *   type         string|text|number|boolean|color|json|select|image
 *   default      valeur par défaut (string, telle que stockée)
 *   options      [{value,label}] pour type 'select'
 *   min/max      bornes pour type 'number'
 *   editable     false = information système, non modifiable (défaut : true)
 */

const GROUPS = [
  { name: 'branding',      label: 'Identité',      description: "Nom, logo et informations légales de l'organisation." },
  { name: 'theme',         label: 'Apparence',     description: "Couleurs et mise en page de l'interface." },
  { name: 'documents',     label: 'Documents',     description: 'Bibliothèque documentaire, téléversement et cycle de vie.' },
  { name: 'security',      label: 'Sécurité',      description: 'Mots de passe, sessions, accès et journalisation.' },
  { name: 'notifications', label: 'Notifications', description: 'Alertes par courrier électronique.' },
  { name: 'localization',  label: 'Localisation',  description: 'Langue, formats et fuseau horaire.' },
  { name: 'storage',       label: 'Stockage',      description: 'Destination et déduplication des fichiers.' },
  { name: 'retention',     label: 'Conservation',  description: 'Durées légales de conservation des documents.' },
];

const CATALOG = [
  // ---------------------------------------------------------------- IDENTITÉ
  { key: 'site_name',        group: 'branding', label: 'Nom de la plateforme', description: "Nom affiché dans la barre de navigation, les e-mails et le titre du navigateur.", type: 'string', default: 'DocuFlow' },
  { key: 'site_description', group: 'branding', label: 'Description',          description: 'Sous-titre affiché sur la page de connexion.', type: 'string', default: 'Plateforme de gestion documentaire' },
  { key: 'site_logo',        group: 'branding', label: 'Logo',                 description: "Logo de l'organisation (PNG, JPG, SVG, WebP — 5 Mo max).", type: 'image', default: null },
  { key: 'site_favicon',     group: 'branding', label: 'Favicon',              description: "Icône affichée dans l'onglet du navigateur.", type: 'image', default: null },
  { key: 'legal_entity',     group: 'branding', label: 'Raison sociale',       description: 'Dénomination légale utilisée dans les documents générés.', type: 'string', default: null },
  { key: 'legal_address',    group: 'branding', label: 'Adresse du siège',     description: 'Adresse postale figurant sur les documents officiels.', type: 'text', default: null },
  { key: 'contact_email',    group: 'branding', label: 'E-mail de contact',    description: 'Adresse affichée aux utilisateurs pour le support.', type: 'string', default: null },
  { key: 'contact_phone',    group: 'branding', label: 'Téléphone de contact', description: 'Numéro affiché aux utilisateurs pour le support.', type: 'string', default: null },
  { key: 'footer_text',      group: 'branding', label: 'Mention de pied de page', description: "Texte libre affiché en bas de l'interface et des e-mails.", type: 'string', default: null },

  // --------------------------------------------------------------- APPARENCE
  { key: 'primary_color',   group: 'theme', label: 'Couleur principale', description: 'Couleur des boutons et éléments actifs.', type: 'color', default: '#0f172a' },
  { key: 'secondary_color', group: 'theme', label: 'Couleur secondaire', description: 'Couleur des éléments de second plan.', type: 'color', default: '#1e293b' },
  { key: 'accent_color',    group: 'theme', label: "Couleur d'accent",   description: 'Couleur de mise en valeur et des liens.', type: 'color', default: '#3b82f6' },
  { key: 'dark_color',      group: 'theme', label: 'Couleur sombre',     description: 'Fond des zones sombres.', type: 'color', default: '#0f172a' },
  { key: 'gold_color',      group: 'theme', label: 'Couleur premium',    description: 'Accent doré des éléments premium.', type: 'color', default: '#d4af37' },
  { key: 'sidebar_position', group: 'theme', label: 'Position du menu',  description: 'Emplacement du menu de navigation principal.', type: 'select', default: 'left',
    options: [{ value: 'left', label: 'À gauche' }, { value: 'top', label: 'En haut' }] },
  { key: 'default_theme_mode', group: 'theme', label: "Mode d'affichage", description: 'Thème appliqué par défaut aux nouveaux utilisateurs.', type: 'select', default: 'light',
    options: [{ value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }, { value: 'system', label: 'Système' }] },
  { key: 'border_radius',   group: 'theme', label: 'Arrondi des angles', description: "Rayon des coins de l'interface, en pixels.", type: 'number', default: '12', min: 0, max: 32 },
  { key: 'login_background_url', group: 'theme', label: 'Fond de la page de connexion', description: "Image de fond de l'écran de connexion.", type: 'image', default: null },

  // --------------------------------------------------------------- DOCUMENTS
  { key: 'default_document_view', group: 'documents', label: 'Vue par défaut', description: 'Présentation initiale de la bibliothèque de documents.', type: 'select', default: 'grid',
    options: [{ value: 'grid', label: 'Grille' }, { value: 'list', label: 'Liste' }, { value: 'dynamic', label: 'Vues dynamiques' }] },
  { key: 'default_group_by', group: 'documents', label: 'Regroupement par défaut', description: 'Critère de regroupement des vues dynamiques.', type: 'select', default: 'type_document',
    options: [
      { value: 'type_document', label: 'Type de document' },
      { value: 'annee', label: 'Année' },
      { value: 'statut', label: 'Statut' },
      { value: 'nom_entreprise', label: 'Entreprise' },
      { value: 'auteur', label: 'Auteur' },
    ] },
  { key: 'page_size',           group: 'documents', label: 'Documents par page',          description: 'Nombre de documents affichés par page.', type: 'number', default: '20', min: 1, max: 100 },
  { key: 'reference_prefix',    group: 'documents', label: 'Préfixe des références',      description: 'Préfixe de la référence canonique immuable des documents.', type: 'string', default: 'DOC' },
  { key: 'max_upload_size_mb',  group: 'documents', label: 'Taille maximale par fichier', description: 'Limite de téléversement en mégaoctets.', type: 'number', default: '50', min: 1, max: 500 },
  { key: 'allowed_file_types',  group: 'documents', label: 'Types de fichiers autorisés', description: 'Extensions acceptées, séparées par des virgules.', type: 'string', default: 'pdf,doc,docx,xls,xlsx,png,jpg,jpeg,txt' },
  { key: 'enable_ocr',              group: 'documents', label: 'Extraction de texte (OCR)', description: 'Extraire le texte des fichiers au téléversement pour la recherche.', type: 'boolean', default: 'true' },
  { key: 'enable_auto_tagging',     group: 'documents', label: 'Étiquetage automatique',    description: 'Proposer des mots-clés métier à partir du contenu extrait.', type: 'boolean', default: 'true' },
  { key: 'enable_checkin_checkout', group: 'documents', label: 'Verrouillage des documents', description: 'Activer le check-in / check-out anticollision.', type: 'boolean', default: 'true' },
  { key: 'enable_versioning',       group: 'documents', label: 'Versionnage',               description: "Conserver l'historique complet des versions.", type: 'boolean', default: 'true' },
  { key: 'require_metadata',        group: 'documents', label: 'Métadonnées obligatoires',  description: "Refuser l'enregistrement si un champ obligatoire est vide.", type: 'boolean', default: 'true' },
  { key: 'document_statuses',       group: 'documents', label: 'Statuts de document',       description: 'Liste ordonnée des statuts du cycle de vie.', type: 'json', default: '["disponible","prêt","archivé"]' },

  // ---------------------------------------------------------------- SÉCURITÉ
  { key: 'password_min_length',      group: 'security', label: 'Longueur minimale du mot de passe', description: 'Nombre minimal de caractères exigé.', type: 'number', default: '8', min: 6, max: 128 },
  { key: 'password_require_symbols', group: 'security', label: 'Exiger un caractère spécial',       description: 'Imposer au moins un symbole dans les mots de passe.', type: 'boolean', default: 'false' },
  { key: 'session_duration_days',    group: 'security', label: 'Durée de session',                  description: "Validité du jeton d'authentification, en jours.", type: 'number', default: '30', min: 1, max: 365 },
  { key: 'enable_google_auth',       group: 'security', label: 'Connexion Google',                  description: "Autoriser l'authentification via Google OAuth (nécessite la configuration serveur).", type: 'boolean', default: 'true' },
  { key: 'enable_audit_log',         group: 'security', label: "Journal d'audit",                   description: 'Tracer toutes les actions (append-only, inaltérable).', type: 'boolean', default: 'true' },
  { key: 'ged_access_role',          group: 'security', label: "Rôle d'accès à la GED",             description: 'Rôle autorisé à consulter la gestion documentaire.', type: 'select', default: 'archiviste',
    options: [
      { value: 'archiviste', label: 'Archiviste uniquement' },
      { value: 'admin', label: 'Administrateurs et archivistes' },
      { value: 'all', label: 'Tous les utilisateurs' },
    ] },

  // ----------------------------------------------------------- NOTIFICATIONS
  { key: 'enable_email_notifications', group: 'notifications', label: 'Notifications par e-mail', description: 'Envoyer les alertes par courrier électronique.', type: 'boolean', default: 'true' },
  { key: 'notify_on_assignment',       group: 'notifications', label: "Alerte d'affectation",    description: "Prévenir l'utilisateur lorsqu'une tâche lui est assignée.", type: 'boolean', default: 'true' },
  { key: 'notify_on_status_change',    group: 'notifications', label: 'Alerte de changement de statut', description: "Prévenir lors d'une transition de workflow.", type: 'boolean', default: 'true' },
  { key: 'notify_on_share',            group: 'notifications', label: 'Alerte de partage',        description: "Prévenir le destinataire d'un document partagé.", type: 'boolean', default: 'true' },
  { key: 'email_sender_name',          group: 'notifications', label: "Nom de l'expéditeur",      description: 'Nom affiché comme expéditeur des e-mails.', type: 'string', default: 'DocuFlow' },
  { key: 'email_signature',            group: 'notifications', label: 'Signature des e-mails',    description: 'Texte ajouté au bas de chaque message.', type: 'text', default: null },

  // ------------------------------------------------------------ LOCALISATION
  { key: 'default_language', group: 'localization', label: 'Langue par défaut', description: "Langue de l'interface pour les nouveaux utilisateurs.", type: 'select', default: 'fr',
    options: [{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }] },
  { key: 'date_format', group: 'localization', label: 'Format de date', description: "Présentation des dates dans l'interface.", type: 'select', default: 'DD/MM/YYYY',
    options: [
      { value: 'DD/MM/YYYY', label: '31/12/2026' },
      { value: 'MM/DD/YYYY', label: '12/31/2026' },
      { value: 'YYYY-MM-DD', label: '2026-12-31' },
    ] },
  { key: 'timezone', group: 'localization', label: 'Fuseau horaire', description: "Fuseau de référence pour l'horodatage affiché.", type: 'string', default: 'Africa/Porto-Novo' },
  { key: 'currency', group: 'localization', label: 'Devise',         description: 'Devise utilisée dans les documents générés.', type: 'string', default: 'XOF' },

  // ---------------------------------------------------------------- STOCKAGE
  // Lecture seule : le backend effectif dépend des variables d'environnement
  // Cloudinary (storageService.js). Les identifiants ne transitent jamais par
  // la base ; exposer ce réglage en écriture donnerait un interrupteur sans effet.
  { key: 'storage_backend', group: 'storage', label: 'Zone de stockage', description: 'Destination effective des fichiers, déterminée par la configuration serveur.', type: 'select', default: 'local', editable: false,
    options: [{ value: 'local', label: 'Serveur local' }, { value: 'cloudinary', label: 'Cloudinary' }] },
  { key: 'enable_deduplication', group: 'storage', label: 'Déduplication', description: "Éviter de stocker deux fois un fichier identique (empreinte SHA-256).", type: 'boolean', default: 'true' },

  // ------------------------------------------------------------- CONSERVATION
  { key: 'enable_retention',        group: 'retention', label: 'Politiques de rétention', description: 'Appliquer les durées de conservation réglementaires.', type: 'boolean', default: 'true' },
  { key: 'default_retention_years', group: 'retention', label: 'Durée de conservation',   description: 'Durée par défaut, en années.', type: 'number', default: '5', min: 0, max: 100 },
  { key: 'retention_action',        group: 'retention', label: "Action à l'expiration",   description: 'Traitement appliqué aux documents expirés.', type: 'select', default: 'archive',
    options: [
      { value: 'archive', label: 'Archiver' },
      { value: 'delete', label: 'Supprimer' },
      { value: 'alert', label: 'Alerter seulement' },
    ] },
];

const BY_KEY = new Map(CATALOG.map((d) => [d.key, d]));

/** Clés modifiables par le superadministrateur. */
const EDITABLE_KEYS = CATALOG.filter((d) => d.editable !== false).map((d) => d.key);

/** Valeurs par défaut, sous la forme { clé: valeur } (les null sont omis). */
function defaults() {
  const out = {};
  for (const d of CATALOG) {
    if (d.default !== null && d.default !== undefined) out[d.key] = d.default;
  }
  return out;
}

/**
 * Valide et normalise une valeur selon le type déclaré.
 * Retourne la chaîne à stocker. Lève une Error explicite si la valeur est
 * invalide — c'est ce qui garantit qu'aucune configuration corrompue n'entre
 * en base (l'ancien contrôleur écrivait n'importe quelle chaîne).
 */
function coerce(definition, rawValue) {
  const label = definition.label || definition.key;

  // Une valeur vide efface le réglage (retour à la valeur par défaut).
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;

  switch (definition.type) {
    case 'number': {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) throw new Error(`${label} : valeur numérique attendue.`);
      if (definition.min !== undefined && n < definition.min) throw new Error(`${label} : minimum ${definition.min}.`);
      if (definition.max !== undefined && n > definition.max) throw new Error(`${label} : maximum ${definition.max}.`);
      return String(n);
    }
    case 'boolean': {
      if (typeof rawValue === 'boolean') return rawValue ? 'true' : 'false';
      const s = String(rawValue).toLowerCase();
      if (['true', '1', 'oui', 'yes'].includes(s)) return 'true';
      if (['false', '0', 'non', 'no'].includes(s)) return 'false';
      throw new Error(`${label} : valeur booléenne attendue.`);
    }
    case 'color': {
      const s = String(rawValue).trim();
      if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s)) {
        throw new Error(`${label} : couleur hexadécimale attendue (ex. #1e293b).`);
      }
      return s.toLowerCase();
    }
    case 'select': {
      const s = String(rawValue);
      const allowed = (definition.options || []).map((o) => o.value);
      if (allowed.length && !allowed.includes(s)) {
        throw new Error(`${label} : valeur non autorisée (attendu : ${allowed.join(', ')}).`);
      }
      return s;
    }
    case 'json': {
      if (typeof rawValue === 'object') return JSON.stringify(rawValue);
      try {
        JSON.parse(String(rawValue));
      } catch {
        throw new Error(`${label} : JSON invalide.`);
      }
      return String(rawValue);
    }
    case 'image':
    case 'text':
    case 'string':
    default: {
      const s = String(rawValue);
      if (s.length > 10000) throw new Error(`${label} : valeur trop longue.`);
      return s;
    }
  }
}

/** Convertit les valeurs stockées (TEXT) vers leurs types JS réels. */
function parseValue(definition, storedValue) {
  if (storedValue === null || storedValue === undefined) return null;
  if (!definition) return storedValue;
  switch (definition.type) {
    case 'number': {
      const n = Number(storedValue);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return storedValue === 'true' || storedValue === '1';
    case 'json':
      try {
        return JSON.parse(storedValue);
      } catch {
        return null;
      }
    default:
      return storedValue;
  }
}

module.exports = { GROUPS, CATALOG, BY_KEY, EDITABLE_KEYS, defaults, coerce, parseValue };
