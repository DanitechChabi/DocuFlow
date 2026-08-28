-- 020_document_lifecycle.sql — cycle de vie documentaire : corbeille et états.
--
-- DEUX chantiers :
--
--   • CORBEILLE. La suppression d'un document était un hard delete intégral
--     (fichiers, historique, métadonnées, relations) sans filet — irréversible
--     pour une GED, et contradictoire avec la promesse de traçabilité. La
--     suppression devient douce : deleted_at/deleted_by marquent la corbeille,
--     la purge physique reste possible mais distincte (permission dédiée
--     documents.purge).
--
--   • ÉTATS. Le statut n'avait pas de machine : toutes les transitions entre
--     les 4 valeurs étaient permises (archivé restait modifiable comme un
--     document actif). Ajout de « en validation » et de la table des
--     transitions autorisées, appliquées côté service (documentStateMachine,
--     comme requestStateMachine) — la contrainte SQL reste un garde-fou de
--     domaine, pas un workflow.
--
-- Idempotent : rejouable sur une base neuve ou déjà migrée.

-- 1. Corbeille.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Les listes excluent la corbeille à chaque lecture : un index partiel
-- l'accélère (c'est le cas nominal, tout ce qui n'est PAS supprimé).
CREATE INDEX IF NOT EXISTS idx_documents_tenant_vivants
    ON documents(tenant_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- La corbeille elle-même, parcourue par la page dédiée.
CREATE INDEX IF NOT EXISTS idx_documents_corbeille
    ON documents(tenant_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;

-- 2. Domaine des statuts : « en validation » entre « disponible » et « prêt ».
--    (contrainte reprise de la 018, enrichie)
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_statut_check;
ALTER TABLE documents ADD CONSTRAINT documents_statut_check
    CHECK (statut IN ('disponible', 'en validation', 'prêt', 'archivé', 'à indexer'));

-- 3. Machine à états déclarative : les transitions autorisées, en données.
--    Pourquoi une table et pas du code : les transitions sont une donnée de
--    GOUVERNANCE (qui peut faire quoi), visualisables et explicables — mais
--    le code (documentStateMachine.js) en porte la copie de référence pour
--    que les tests et l'interface n'aient pas à lire la base. Les deux sont
--    vérifiés l'un contre l'autre par les tests.
CREATE TABLE IF NOT EXISTS document_transitions (
    id SERIAL PRIMARY KEY,
    from_statut VARCHAR(30) NOT NULL,
    to_statut VARCHAR(30) NOT NULL,
    label VARCHAR(100),
    UNIQUE (from_statut, to_statut)
);

INSERT INTO document_transitions (from_statut, to_statut, label) VALUES
    ('à indexer',    'disponible',    'Indexé'),
    ('à indexer',    'en validation', 'Indexé, soumis à validation'),
    ('disponible',   'en validation', 'Soumis à validation'),
    ('disponible',   'prêt',          'Validé directement'),
    ('disponible',   'archivé',       'Archivé'),
    ('en validation','prêt',          'Validé'),
    ('en validation','disponible',    'Validation refusée'),
    ('en validation','archivé',       'Archivé'),
    ('prêt',         'archivé',       'Archivé'),
    ('prêt',         'disponible',    'Remis en circulation'),
    ('archivé',      'prêt',          'Désarchivé')
ON CONFLICT (from_statut, to_statut) DO NOTHING;
