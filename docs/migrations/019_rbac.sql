-- 019_rbac.sql — Contrôle d'accès fondé sur les rôles (RBAC).
--
-- Les rôles étaient quatre chaînes comparées en dur dans une dizaine de
-- listes dispersées (roleMiddleware, gedAccessMiddleware, contrôleurs,
-- frontend). Cette migration pose la fondation d'un vrai RBAC :
--
--   • `roles` — un rôle par organisation (les 7 rôles système provisionnés
--     pour chaque tenant existant, plus les rôles personnalisés à venir).
--     Les permissions vivent dans un TEXT[] : le catalogue est en code
--     (config/permissions.js, versionné avec les routes qui le consomment),
--     la base ne stocke que les clés accordées à chaque rôle.
--   • `users.role` devient la clé du rôle (élargie à 50 — les clés
--     personnalisées sont plus longues que « superadmin »).
--   • `users.token_version` — un changement de rôle ou de permissions
--     l'incrémente et invalide les jetons encore en circulation.
--
-- Idempotent : rejouable sur une base neuve ou déjà migrée.
-- Les valeurs existantes de users.role (superadmin, admin, archiviste,
-- demandeur) SONT des clés de rôles système : aucune écriture de données
-- utilisateur n'est nécessaire.

-- 1. Table des rôles.
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (tenant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);

-- 2. users.role élargi (les clés de rôles personnalisés dépassent 20 caractères).
--    VARCHAR(50) est aussi ce que la colonne acceptera pour les futurs rôles.
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(50);

-- 3. Invalidation des jetons au changement de rôle/permissions.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- 4. Rôles système pour CHAQUE tenant existant (et à venir via le
--    provisionnement applicatif). Les ensembles de permissions sont
--    volontairement calqués sur les pouvoirs réels du code d'avant la
--    migration — aucun utilisateur ne perd ni ne gagne un accès au passage.
--    Le catalogue lui-même vit dans backend/src/config/permissions.js.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id FROM tenants LOOP
        INSERT INTO roles (tenant_id, key, name, description, is_system, permissions)
        VALUES
            (t.id, 'superadmin', 'Super administrateur',
             'Accès complet à la plateforme, y compris l''administration.',
             TRUE, ARRAY['*']),
            (t.id, 'admin', 'Administrateur',
             'Gestion de l''organisation : utilisateurs, rôles, configuration, GED et demandes.',
             TRUE, ARRAY[
                'requests.view','requests.create','requests.edit','requests.delete','requests.assign',
                'requests.process','requests.validate','requests.reject','requests.close','requests.view_history',
                'documents.view','documents.upload','documents.edit','documents.rename','documents.move',
                'documents.download','documents.share','documents.delete','documents.restore','documents.archive',
                'documents.manage_versions','documents.view_history','documents.index','documents.validate',
                'folders.view','folders.create','folders.edit','folders.move','folders.delete','folders.manage_permissions',
                'search.documents','search.requests','search.advanced',
                'users.view','users.create','users.edit','users.disable',
                'roles.view','roles.create','roles.edit','roles.delete',
                'audit.view','settings.manage','groups.view','groups.manage'
             ]),
            (t.id, 'responsable', 'Responsable',
             'Supervision des demandes : affectation, traitement, validation, rejet.',
             TRUE, ARRAY[
                'requests.view','requests.create','requests.edit','requests.assign','requests.process',
                'requests.validate','requests.reject','requests.close','requests.view_history',
                'documents.view','documents.download',
                'search.documents','search.requests',
                'audit.view'
             ]),
            (t.id, 'archiviste', 'Archiviste',
             'Gestion documentaire : import, classement, métadonnées, versions, archivage.',
             TRUE, ARRAY[
                'requests.view','requests.process','requests.view_history',
                'documents.view','documents.upload','documents.edit','documents.rename','documents.move',
                'documents.download','documents.share','documents.archive','documents.manage_versions',
                'documents.view_history','documents.index','documents.validate',
                'folders.view','folders.create','folders.edit','folders.move','folders.delete','folders.manage_permissions',
                'search.documents','search.requests','search.advanced',
                'groups.view'
             ]),
            (t.id, 'agent', 'Agent',
             'Opérations quotidiennes : créer des demandes, traiter celles qui lui sont attribuées, verser et consulter les documents.',
             TRUE, ARRAY[
                'requests.view','requests.create','requests.process','requests.view_history',
                'documents.view','documents.upload','documents.download',
                'search.documents','search.requests'
             ]),
            (t.id, 'demandeur', 'Demandeur',
             'Déposer des demandes et suivre leur progression.',
             TRUE, ARRAY[
                'requests.view','requests.create','requests.view_history'
             ]),
            (t.id, 'lecteur', 'Lecteur',
             'Consultation seule des documents et demandes autorisés.',
             TRUE, ARRAY[
                'requests.view',
                'documents.view','documents.download',
                'search.documents','search.requests'
             ])
        ON CONFLICT (tenant_id, key) DO NOTHING;
    END LOOP;
END $$;
