-- ============================================================================
-- 013_tenant_configuration.sql — Configuration intégrale par organisation
-- ============================================================================
-- Objectif : permettre au superadministrateur de configurer TOUTE l'application
-- dès l'inscription (branding, thème, champs, sections, dossiers, vues,
-- rétention, stockage, sécurité, localisation), à la manière d'Alfresco ou
-- SharePoint.
--
-- Constat corrigé ici :
--   * `settings` est un simple magasin clé/valeur TEXT sans typage ni
--     description, et le contrôleur n'autorisait que 7 clés en écriture.
--     → on ajoute un CATALOGUE de définitions (`setting_definitions`) qui décrit
--       chaque paramètre (type, valeur par défaut, groupe, libellé, options).
--       La whitelist du code est ainsi remplacée par une whitelist en base,
--       extensible sans redéploiement.
--   * Aucun schéma de métadonnées n'était créé pour les nouvelles entreprises
--     (la 010 ne seed que le tenant 1) → l'éditeur de schéma était vide par
--     construction pour tout nouveau client. La fonction
--     `provision_tenant_defaults()` corrige cela.
--
-- Idempotent. Prérequis : 010, 011, 012.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Catalogue des paramètres configurables (référentiel global, pas par tenant)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS setting_definitions (
    key             VARCHAR(100) PRIMARY KEY,
    group_name      VARCHAR(50)  NOT NULL,           -- branding | theme | documents | security | notifications | localization | storage | retention
    label           VARCHAR(200) NOT NULL,
    description     TEXT,
    value_type      VARCHAR(20)  NOT NULL DEFAULT 'string'
                    CHECK (value_type IN ('string','text','number','boolean','color','json','select','image')),
    default_value   TEXT,
    options_json    JSONB DEFAULT '[]'::jsonb,       -- pour value_type = 'select'
    display_order   INTEGER DEFAULT 0,
    is_editable     BOOLEAN DEFAULT TRUE,            -- FALSE = lecture seule (info système)
    requires_role   VARCHAR(20) DEFAULT 'superadmin',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_setting_definitions_group ON setting_definitions(group_name, display_order);

-- ----------------------------------------------------------------------------
-- 2. Seed du catalogue — chaque clé devient configurable par le superadmin
-- ----------------------------------------------------------------------------
INSERT INTO setting_definitions (key, group_name, label, description, value_type, default_value, options_json, display_order) VALUES
  -- IDENTITÉ / BRANDING
  ('site_name',            'branding', 'Nom de la plateforme',        'Nom affiché dans la barre de navigation, les e-mails et le titre du navigateur.', 'string',  'DocuFlow', '[]', 1),
  ('site_description',     'branding', 'Description',                 'Sous-titre affiché sur la page de connexion.', 'string', 'Plateforme de gestion documentaire', '[]', 2),
  ('site_logo',            'branding', 'Logo',                        'Logo de l''organisation (PNG, JPG, SVG, WebP — 5 Mo max).', 'image', NULL, '[]', 3),
  ('site_favicon',         'branding', 'Favicon',                     'Icône affichée dans l''onglet du navigateur.', 'image', NULL, '[]', 4),
  ('legal_entity',         'branding', 'Raison sociale',              'Dénomination légale utilisée dans les documents générés.', 'string', NULL, '[]', 5),
  ('legal_address',        'branding', 'Adresse du siège',            'Adresse postale figurant sur les documents officiels.', 'text', NULL, '[]', 6),
  ('contact_email',        'branding', 'E-mail de contact',           'Adresse affichée aux utilisateurs pour le support.', 'string', NULL, '[]', 7),
  ('contact_phone',        'branding', 'Téléphone de contact',        'Numéro affiché aux utilisateurs pour le support.', 'string', NULL, '[]', 8),
  ('footer_text',          'branding', 'Mention de pied de page',     'Texte libre affiché en bas de l''interface et des e-mails.', 'string', NULL, '[]', 9),

  -- THÈME / APPARENCE
  ('primary_color',        'theme', 'Couleur principale',    'Couleur des boutons et éléments actifs.', 'color', '#0f172a', '[]', 1),
  ('secondary_color',      'theme', 'Couleur secondaire',    'Couleur des éléments de second plan.',    'color', '#1e293b', '[]', 2),
  ('accent_color',         'theme', 'Couleur d''accent',     'Couleur de mise en valeur et des liens.', 'color', '#3b82f6', '[]', 3),
  ('dark_color',           'theme', 'Couleur sombre',        'Fond des zones sombres.',                 'color', '#0f172a', '[]', 4),
  ('gold_color',           'theme', 'Couleur premium',       'Accent doré des éléments premium.',       'color', '#d4af37', '[]', 5),
  ('sidebar_position',     'theme', 'Position du menu',      'Emplacement du menu de navigation principal.', 'select', 'left',  '[{"value":"left","label":"À gauche"},{"value":"top","label":"En haut"}]', 6),
  ('default_theme_mode',   'theme', 'Mode d''affichage',     'Thème appliqué par défaut aux nouveaux utilisateurs.', 'select', 'light', '[{"value":"light","label":"Clair"},{"value":"dark","label":"Sombre"},{"value":"system","label":"Système"}]', 7),
  ('border_radius',        'theme', 'Arrondi des angles',    'Rayon des coins de l''interface, en pixels.', 'number', '12', '[]', 8),
  ('login_background_url', 'theme', 'Fond de la page de connexion', 'Image de fond de l''écran de connexion.', 'image', NULL, '[]', 9),

  -- DOCUMENTS / GED
  ('default_document_view',    'documents', 'Vue par défaut',              'Présentation initiale de la bibliothèque de documents.', 'select', 'grid', '[{"value":"grid","label":"Grille"},{"value":"list","label":"Liste"},{"value":"dynamic","label":"Vues dynamiques"}]', 1),
  ('default_group_by',         'documents', 'Regroupement par défaut',     'Critère de regroupement des vues dynamiques.', 'select', 'type_document', '[{"value":"type_document","label":"Type de document"},{"value":"annee","label":"Année"},{"value":"statut","label":"Statut"},{"value":"nom_entreprise","label":"Entreprise"},{"value":"auteur","label":"Auteur"}]', 2),
  ('page_size',                'documents', 'Documents par page',          'Nombre de documents affichés par page (1-100).', 'number', '20', '[]', 3),
  ('reference_prefix',         'documents', 'Préfixe des références',      'Préfixe de la référence canonique immuable des documents.', 'string', 'DOC', '[]', 4),
  ('max_upload_size_mb',       'documents', 'Taille maximale par fichier', 'Limite de téléversement en mégaoctets.', 'number', '50', '[]', 5),
  ('allowed_file_types',       'documents', 'Types de fichiers autorisés', 'Extensions acceptées, séparées par des virgules.', 'string', 'pdf,doc,docx,xls,xlsx,png,jpg,jpeg,txt', '[]', 6),
  ('enable_ocr',               'documents', 'Extraction de texte (OCR)',   'Extraire le texte des fichiers au téléversement pour la recherche.', 'boolean', 'true', '[]', 7),
  ('enable_auto_tagging',      'documents', 'Étiquetage automatique',      'Proposer des mots-clés métier à partir du contenu extrait.', 'boolean', 'true', '[]', 8),
  ('enable_checkin_checkout',  'documents', 'Verrouillage des documents',  'Activer le check-in / check-out anticollision.', 'boolean', 'true', '[]', 9),
  ('enable_versioning',        'documents', 'Versionnage',                 'Conserver l''historique complet des versions.', 'boolean', 'true', '[]', 10),
  ('require_metadata',         'documents', 'Métadonnées obligatoires',    'Refuser l''enregistrement si un champ obligatoire est vide.', 'boolean', 'true', '[]', 11),
  ('document_statuses',        'documents', 'Statuts de document',         'Liste ordonnée des statuts du cycle de vie.', 'json', '["disponible","prêt","archivé"]', '[]', 12),

  -- SÉCURITÉ
  ('password_min_length',      'security', 'Longueur minimale du mot de passe', 'Nombre minimal de caractères exigé.', 'number', '8', '[]', 1),
  ('password_require_symbols', 'security', 'Exiger un caractère spécial',       'Imposer au moins un symbole dans les mots de passe.', 'boolean', 'false', '[]', 2),
  ('session_duration_days',    'security', 'Durée de session',                  'Validité du jeton d''authentification, en jours.', 'number', '30', '[]', 3),
  ('enable_google_auth',       'security', 'Connexion Google',                  'Autoriser l''authentification via Google OAuth.', 'boolean', 'true', '[]', 4),
  ('enable_audit_log',         'security', 'Journal d''audit',                  'Tracer toutes les actions (append-only, inaltérable).', 'boolean', 'true', '[]', 5),
  ('ged_access_role',          'security', 'Rôle d''accès à la GED',            'Rôle autorisé à consulter la gestion documentaire.', 'select', 'archiviste', '[{"value":"archiviste","label":"Archiviste uniquement"},{"value":"admin","label":"Administrateurs et archivistes"},{"value":"all","label":"Tous les utilisateurs"}]', 6),

  -- NOTIFICATIONS
  ('enable_email_notifications', 'notifications', 'Notifications par e-mail', 'Envoyer les alertes par courrier électronique.', 'boolean', 'true', '[]', 1),
  ('notify_on_assignment',       'notifications', 'Alerte d''affectation',    'Prévenir l''utilisateur lorsqu''une tâche lui est assignée.', 'boolean', 'true', '[]', 2),
  ('notify_on_status_change',    'notifications', 'Alerte de changement de statut', 'Prévenir lors d''une transition de workflow.', 'boolean', 'true', '[]', 3),
  ('notify_on_share',           'notifications', 'Alerte de partage',         'Prévenir le destinataire d''un document partagé.', 'boolean', 'true', '[]', 4),
  ('email_sender_name',         'notifications', 'Nom de l''expéditeur',      'Nom affiché comme expéditeur des e-mails.', 'string', 'DocuFlow', '[]', 5),
  ('email_signature',           'notifications', 'Signature des e-mails',     'Texte ajouté au bas de chaque message.', 'text', NULL, '[]', 6),

  -- LOCALISATION
  ('default_language',   'localization', 'Langue par défaut',      'Langue de l''interface pour les nouveaux utilisateurs.', 'select', 'fr', '[{"value":"fr","label":"Français"},{"value":"en","label":"English"}]', 1),
  ('date_format',        'localization', 'Format de date',         'Présentation des dates dans l''interface.', 'select', 'DD/MM/YYYY', '[{"value":"DD/MM/YYYY","label":"31/12/2026"},{"value":"MM/DD/YYYY","label":"12/31/2026"},{"value":"YYYY-MM-DD","label":"2026-12-31"}]', 2),
  ('timezone',           'localization', 'Fuseau horaire',         'Fuseau de référence pour l''horodatage affiché.', 'string', 'Africa/Porto-Novo', '[]', 3),
  ('currency',           'localization', 'Devise',                 'Devise utilisée dans les documents générés.', 'string', 'XOF', '[]', 4),

  -- STOCKAGE
  -- NB : `storage_backend` est un indicateur de lecture (is_editable = FALSE plus bas) :
  -- le backend réel est déterminé par les variables d'environnement Cloudinary, car
  -- les identifiants ne doivent jamais transiter par la base. Voir storageService.js.
  ('storage_backend',    'storage', 'Zone de stockage',           'Destination effective des fichiers téléversés, déterminée par la configuration serveur.', 'select', 'local', '[{"value":"local","label":"Serveur local"},{"value":"cloudinary","label":"Cloudinary"}]', 1),
  ('enable_deduplication', 'storage', 'Déduplication',            'Éviter de stocker deux fois un fichier identique (empreinte SHA-256).', 'boolean', 'true', '[]', 2),

  -- RÉTENTION
  ('enable_retention',      'retention', 'Politiques de rétention',   'Appliquer les durées de conservation réglementaires.', 'boolean', 'true', '[]', 1),
  ('default_retention_years','retention', 'Durée de conservation',    'Durée par défaut, en années.', 'number', '5', '[]', 2),
  ('retention_action',      'retention', 'Action à l''expiration',    'Traitement appliqué aux documents expirés.', 'select', 'archive', '[{"value":"archive","label":"Archiver"},{"value":"delete","label":"Supprimer"},{"value":"alert","label":"Alerter seulement"}]', 3)
ON CONFLICT (key) DO UPDATE SET
  group_name    = EXCLUDED.group_name,
  label         = EXCLUDED.label,
  description   = EXCLUDED.description,
  value_type    = EXCLUDED.value_type,
  default_value = EXCLUDED.default_value,
  options_json  = EXCLUDED.options_json,
  display_order = EXCLUDED.display_order;

-- Réglages en lecture seule : leur valeur effective vient de l'environnement
-- serveur (identifiants de stockage, OAuth) et non de la base. Les exposer en
-- écriture donnerait un interrupteur sans effet.
UPDATE setting_definitions SET is_editable = FALSE WHERE key IN ('storage_backend');

-- ----------------------------------------------------------------------------
-- 2b. storage_zones — le CHECK d'origine (010) omet 'cloudinary', pourtant seul
--     backend distant réellement implémenté (storageService.js). Sans cela, une
--     zone Cloudinary est impossible à enregistrer.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    ALTER TABLE storage_zones DROP CONSTRAINT IF EXISTS storage_zones_type_check;
    ALTER TABLE storage_zones ADD CONSTRAINT storage_zones_type_check
        CHECK (type IN ('local','s3','azure','mfiles','cloudinary'));
EXCEPTION WHEN others THEN
    RAISE NOTICE 'CHECK storage_zones.type non modifié : %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Provisionnement complet d'un tenant
--    Appelée à l'inscription (authController.registerCompany) et en rattrapage
--    pour les organisations existantes. Strictement idempotente.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION provision_tenant_defaults(p_tenant_id INTEGER, p_company_name TEXT DEFAULT NULL)
RETURNS void AS $$
DECLARE
    v_schema_id  INTEGER;
    v_owner_id   INTEGER;
    v_name       TEXT;
BEGIN
    SELECT name INTO v_name FROM tenants WHERE id = p_tenant_id;
    v_name := COALESCE(p_company_name, v_name, 'DocuFlow');

    -- Premier superadmin du tenant : auteur des objets provisionnés
    SELECT id INTO v_owner_id
    FROM users
    WHERE tenant_id = p_tenant_id AND role = 'superadmin'
    ORDER BY id ASC LIMIT 1;

    -- 3.1 Réglages : toutes les valeurs par défaut du catalogue
    INSERT INTO settings (tenant_id, key, value)
    SELECT p_tenant_id, d.key, d.default_value
    FROM setting_definitions d
    WHERE d.default_value IS NOT NULL
    ON CONFLICT (tenant_id, key) DO NOTHING;

    -- Le nom du site prend celui de l'organisation
    INSERT INTO settings (tenant_id, key, value)
    VALUES (p_tenant_id, 'site_name', v_name)
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET value = EXCLUDED.value
      WHERE settings.value IS NULL OR settings.value = 'DocuFlow';

    -- 3.2 Schéma de métadonnées par défaut + champs typés
    INSERT INTO metadata_schemas (tenant_id, name, description, is_default)
    VALUES (p_tenant_id, 'Document standard', 'Schéma de classification par défaut de l''organisation', TRUE)
    ON CONFLICT (tenant_id, name) DO NOTHING;

    SELECT id INTO v_schema_id
    FROM metadata_schemas
    WHERE tenant_id = p_tenant_id AND is_default = TRUE
    ORDER BY id ASC LIMIT 1;

    IF v_schema_id IS NOT NULL THEN
        INSERT INTO metadata_fields (schema_id, name, label, type, required, display_order, options_json)
        VALUES
          (v_schema_id, 'document_type',   'Type de document',            'select',  TRUE,  1,
           '[{"value":"contrat","label":"Contrat"},{"value":"facture","label":"Facture"},{"value":"acte","label":"Acte"},{"value":"rapport","label":"Rapport"},{"value":"courrier","label":"Courrier"},{"value":"autre","label":"Autre"}]'::jsonb),
          (v_schema_id, 'confidentiality', 'Niveau de confidentialité',   'select',  TRUE,  2,
           '[{"value":"public","label":"Public"},{"value":"interne","label":"Interne"},{"value":"confidentiel","label":"Confidentiel"},{"value":"secret","label":"Secret"}]'::jsonb),
          (v_schema_id, 'effective_date',  'Date d''effet',               'date',    FALSE, 3, '[]'::jsonb),
          (v_schema_id, 'expiration_date', 'Date d''expiration',          'date',    FALSE, 4, '[]'::jsonb),
          (v_schema_id, 'owner_service',   'Service propriétaire',        'text',    FALSE, 5, '[]'::jsonb),
          (v_schema_id, 'responsible',     'Responsable du document',     'user',    FALSE, 6, '[]'::jsonb),
          (v_schema_id, 'is_signed',       'Document signé',              'boolean', FALSE, 7, '[]'::jsonb)
        ON CONFLICT (schema_id, name) DO NOTHING;
    END IF;

    -- 3.3 Dossiers de départ
    INSERT INTO document_folders (tenant_id, name, created_by)
    SELECT p_tenant_id, f.name, v_owner_id
    FROM (VALUES ('Contrats'), ('Factures'), ('Actes'), ('Rapports'), ('Courriers'), ('Archives')) AS f(name)
    WHERE NOT EXISTS (
        SELECT 1 FROM document_folders d
        WHERE d.tenant_id = p_tenant_id AND d.name = f.name
    );

    -- 3.4 Vues dynamiques prêtes à l'emploi
    INSERT INTO dynamic_views (tenant_id, name, description, group_by_field, created_by)
    SELECT p_tenant_id, v.name, v.description, v.field, v_owner_id
    FROM (VALUES
        ('Par type de document', 'Regroupe les documents selon leur type', 'type_document'),
        ('Par année',            'Regroupe les documents par millésime',   'annee'),
        ('Par statut',           'Suit l''avancement du cycle de vie',     'statut'),
        ('Par entreprise',       'Regroupe les documents par entreprise',  'nom_entreprise'),
        ('Par auteur',           'Regroupe les documents par auteur',      'auteur')
    ) AS v(name, description, field)
    WHERE NOT EXISTS (
        SELECT 1 FROM dynamic_views dv
        WHERE dv.tenant_id = p_tenant_id AND dv.name = v.name
    );

    -- 3.5 Politique de rétention par défaut
    INSERT INTO retention_policies (tenant_id, name, description, retention_years, action_on_expiry, notify_before_days)
    VALUES (p_tenant_id, 'Conservation standard', 'Durée de conservation légale par défaut (5 ans)', 5, 'archive', 30)
    ON CONFLICT (tenant_id, name) DO NOTHING;

    -- 3.6 Zone de stockage par défaut
    INSERT INTO storage_zones (tenant_id, name, type, is_default)
    VALUES (p_tenant_id, 'Stockage principal', 'local', TRUE)
    ON CONFLICT (tenant_id, name) DO NOTHING;

    -- 3.7 Groupes de permissions
    INSERT INTO groups (tenant_id, name, description)
    SELECT p_tenant_id, g.name, g.description
    FROM (VALUES
        ('Administrateurs', 'Accès complet à la configuration de l''organisation'),
        ('Archivistes',     'Gestion de la bibliothèque documentaire'),
        ('Demandeurs',      'Dépôt et suivi des demandes')
    ) AS g(name, description)
    ON CONFLICT (tenant_id, name) DO NOTHING;

    -- 3.8 Sections — uniquement si l'organisation n'en a aucune.
    --
    -- La liste reproduit DEFAULT_SECTIONS de tenantProvisioningService.js : les
    -- deux chemins de provisionnement (inscription côté JS, rattrapage côté SQL)
    -- doivent livrer la même taxonomie, sans quoi une organisation hérite de
    -- sections différentes selon la voie par laquelle elle a été créée.
    --
    -- Le garde-fou `NOT EXISTS` est nécessaire, et un simple ON CONFLICT ne
    -- suffirait pas : `users.section` stocke le NOM de la section en texte (pas
    -- une clé étrangère). Ajouter des sections à une organisation qui a déjà les
    -- siennes ferait donc coexister deux taxonomies dans le même sélecteur, dont
    -- une seule serait référencée par les comptes existants.
    IF NOT EXISTS (SELECT 1 FROM sections WHERE tenant_id = p_tenant_id) THEN
        INSERT INTO sections (tenant_id, name)
        SELECT p_tenant_id, s.name
        FROM (VALUES ('Comptabilité'), ('Commercial'), ('DAI'), ('DRI'), ('DGI'), ('DNCMP')) AS s(name)
        ON CONFLICT (tenant_id, name) DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 4. Rattrapage : provisionne les organisations déjà existantes
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id, name FROM tenants ORDER BY id LOOP
        PERFORM provision_tenant_defaults(t.id, t.name);
    END LOOP;
END $$;

-- ============================================================================
-- ROLLBACK (à exécuter manuellement en cas de retour arrière)
-- ============================================================================
-- DROP FUNCTION IF EXISTS provision_tenant_defaults(INTEGER, TEXT);
-- DROP TABLE IF EXISTS setting_definitions;
-- Les données provisionnées (settings, schémas, dossiers, vues, politiques,
-- zones, groupes, sections) ne sont PAS supprimées automatiquement : elles
-- peuvent contenir du contenu métier créé depuis. Purge manuelle si nécessaire.
-- ============================================================================
-- Fin de la migration
-- ============================================================================
