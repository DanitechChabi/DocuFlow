-- ============================================================================
-- 010_metadata_typed.sql — Métadonnées typées configurables par organisation
-- Phase P1 — Fondation GED (remplace tags libre TEXT[] par schémas typés)
-- Idempotent : peut être exécuté sur base neuve ou existante.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Définitions de schémas de métadonnées (par tenant)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metadata_schemas (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    version INTEGER DEFAULT 1,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_metadata_schemas_tenant ON metadata_schemas(tenant_id);

-- ----------------------------------------------------------------------------
-- 2. Champs de métadonnées typés (par schéma)
--    type: text | number | date | boolean | select | multiselect | user | document
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metadata_fields (
    id SERIAL PRIMARY KEY,
    schema_id INTEGER NOT NULL REFERENCES metadata_schemas(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    label VARCHAR(150) NOT NULL,
    type VARCHAR(30) NOT NULL DEFAULT 'text',
    required BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 0,
    options_json JSONB DEFAULT '[]'::jsonb,  -- pour select/multiselect : [{value,label}]
    default_value_json JSONB,
    searchable BOOLEAN DEFAULT TRUE,          -- indexé pour recherche
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (schema_id, name)
);
CREATE INDEX IF NOT EXISTS idx_metadata_fields_schema ON metadata_fields(schema_id);

-- ----------------------------------------------------------------------------
-- 3. Valeurs de métadonnées (instance par document)
--    value_json stocke la valeur typée (string | number | bool | array | object)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metadata_values (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES metadata_fields(id) ON DELETE CASCADE,
    value_json JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (document_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_metadata_values_document ON metadata_values(document_id);
CREATE INDEX IF NOT EXISTS idx_metadata_values_field ON metadata_values(field_id);

-- ----------------------------------------------------------------------------
-- 4. Journal d'audit APPEND-ONLY (toutes actions GED + auth + permissions)
--    Contrainte : aucune modification/suppression après insertion (trigger)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_username VARCHAR(100),                 -- snapshot nom au moment action
    action VARCHAR(100) NOT NULL,                -- login | logout | create | read | download | update | version | delete | permission_change | workflow_transition | share | password_change | ...
    object_type VARCHAR(50),                     -- document | request | user | group | tenant | system
    object_id INTEGER,
    details_json JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Une base antérieure possède déjà `audit_logs` avec les colonnes historiques
-- (id_user, request_id, user_name, timestamp) : le CREATE ci-dessus est alors
-- ignoré et les colonnes GED manquent. Sans ce rattrapage, les index qui suivent
-- échouent avec « column "actor_id" does not exist » et toute la migration casse.
-- La convergence complète des deux jeux de colonnes est faite par la 012.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_username VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS object_type VARCHAR(50);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS object_id INTEGER;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details_json JSONB DEFAULT '{}'::jsonb;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred ON audit_logs(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_object ON audit_logs(object_type, object_id);

-- Trigger : empêcher UPDATE/DELETE sur audit_logs (append-only strict)
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs est append-only : modification/suppression interdite (action=%, id=%)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

-- Le trigger est posé par la 012, APRÈS les UPDATE de rattrapage qui recopient
-- les colonnes historiques (id_user, user_name, timestamp) vers les colonnes GED.
-- L'installer ici bloquerait ces UPDATE sur une base contenant déjà des lignes
-- d'audit, et la migration échouerait. Sur une base neuve, la table est vide :
-- rien à rattraper, et la 012 pose le trigger dans la même campagne.
DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_logs;

-- ----------------------------------------------------------------------------
-- 5. Groupes (pour permissions granulaires, mapping AD/LDAP)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    external_id VARCHAR(255),                    -- ID Active Directory / LDAP si sync
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_groups_tenant ON groups(tenant_id);

-- ----------------------------------------------------------------------------
-- 6. Appartenance utilisateur ↔ groupe
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_group_memberships (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_user_group_user ON user_group_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_user_group_group ON user_group_memberships(group_id);

-- ----------------------------------------------------------------------------
-- 7. Relations inter-documents (avenant, version de, pièce jointe de, référence)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_relations (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    target_document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    relation_type VARCHAR(50) NOT NULL DEFAULT 'related',  -- avenant | version_of | attachment_of | references | replaces
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_document_id, target_document_id, relation_type),
    CHECK (source_document_id <> target_document_id)
);
CREATE INDEX IF NOT EXISTS idx_document_relations_source ON document_relations(source_document_id);
CREATE INDEX IF NOT EXISTS idx_document_relations_target ON document_relations(target_document_id);
CREATE INDEX IF NOT EXISTS idx_document_relations_tenant ON document_relations(tenant_id);

-- ----------------------------------------------------------------------------
-- 8. Politiques de rétention (par classe de document / organisation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_policies (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    applies_to_schema_id INTEGER REFERENCES metadata_schemas(id) ON DELETE SET NULL,  -- null = toutes classes
    retention_years INTEGER NOT NULL DEFAULT 5,
    action_on_expiry VARCHAR(20) DEFAULT 'archive' CHECK (action_on_expiry IN ('archive','delete','alert')),
    notify_before_days INTEGER DEFAULT 30,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_retention_policies_tenant ON retention_policies(tenant_id);

-- ----------------------------------------------------------------------------
-- 9. Zones de stockage multiples (Local / S3 / Azure / M-Files future)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS storage_zones (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'local' CHECK (type IN ('local','s3','azure','mfiles')),
    config_json JSONB DEFAULT '{}'::jsonb,       -- credentials chiffrés ailleurs (env)
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_storage_zones_tenant ON storage_zones(tenant_id);

-- ----------------------------------------------------------------------------
-- 10. Index full-text PostgreSQL (tsvector) sur documents
--     search_vector = nom_entreprise + num_dossier + num_acte + description + tags
--     + métadonnées extractibles (à remplir par trigger application côté backend)
-- ----------------------------------------------------------------------------
ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING GIN(search_vector);

-- Trigger pour maintenir search_vector (nom/num/doc)
CREATE OR REPLACE FUNCTION update_document_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('french', COALESCE(NEW.nom_entreprise,'')), 'A') ||
        setweight(to_tsvector('french', COALESCE(NEW.num_dossier,'')), 'A') ||
        setweight(to_tsvector('french', COALESCE(NEW.num_acte,'')), 'A') ||
        setweight(to_tsvector('french', COALESCE(NEW.description,'')), 'B') ||
        setweight(to_tsvector('french', COALESCE(array_to_string(NEW.tags, ' '),'')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_search_vector ON documents;
CREATE TRIGGER trg_document_search_vector
    BEFORE INSERT OR UPDATE OF nom_entreprise, num_dossier, num_acte, description, tags
    ON documents
    FOR EACH ROW EXECUTE FUNCTION update_document_search_vector();

-- Extension trigram pour suggestions/autocomplete (si disponible)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- 11. Schéma de métadonnées par défaut (seed) pour tenant 1 si aucun existant
-- ----------------------------------------------------------------------------
INSERT INTO metadata_schemas (tenant_id, name, description, is_default)
SELECT 1, 'Document standard', 'Schéma par défaut pour tous les documents', TRUE
WHERE NOT EXISTS (SELECT 1 FROM metadata_schemas WHERE tenant_id = 1);

-- Champs par défaut pour le schéma ci-dessus
INSERT INTO metadata_fields (schema_id, name, label, type, required, display_order, options_json)
SELECT s.id, 'document_type', 'Type de document', 'select', TRUE, 1,
       '[{"value":"contrat","label":"Contrat"},{"value":"facture","label":"Facture"},{"value":"acte","label":"Acte"},{"value":"rapport","label":"Rapport"},{"value":"autre","label":"Autre"}]'::jsonb
FROM metadata_schemas s WHERE s.tenant_id = 1 AND s.is_default = TRUE
ON CONFLICT (schema_id, name) DO NOTHING;

INSERT INTO metadata_fields (schema_id, name, label, type, required, display_order, options_json)
SELECT s.id, 'confidentiality', 'Niveau de confidentialité', 'select', TRUE, 2,
       '[{"value":"public","label":"Public"},{"value":"interne","label":"Interne"},{"value":"confidentiel","label":"Confidentiel"},{"value":"secret","label":"Secret"}]'::jsonb
FROM metadata_schemas s WHERE s.tenant_id = 1 AND s.is_default = TRUE
ON CONFLICT (schema_id, name) DO NOTHING;

INSERT INTO metadata_fields (schema_id, name, label, type, required, display_order)
SELECT s.id, 'effective_date', 'Date d''effet', 'date', FALSE, 3
FROM metadata_schemas s WHERE s.tenant_id = 1 AND s.is_default = TRUE
ON CONFLICT (schema_id, name) DO NOTHING;

INSERT INTO metadata_fields (schema_id, name, label, type, required, display_order)
SELECT s.id, 'expiration_date', 'Date d''expiration', 'date', FALSE, 4
FROM metadata_schemas s WHERE s.tenant_id = 1 AND s.is_default = TRUE
ON CONFLICT (schema_id, name) DO NOTHING;

INSERT INTO metadata_fields (schema_id, name, label, type, required, display_order)
SELECT s.id, 'owner_service', 'Service propriétaire', 'text', FALSE, 5
FROM metadata_schemas s WHERE s.tenant_id = 1 AND s.is_default = TRUE
ON CONFLICT (schema_id, name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 12. Politique de rétention par défaut (tenant 1)
-- ----------------------------------------------------------------------------
INSERT INTO retention_policies (tenant_id, name, retention_years, action_on_expiry, notify_before_days)
SELECT 1, 'Rétention standard', 5, 'archive', 30
WHERE NOT EXISTS (SELECT 1 FROM retention_policies WHERE tenant_id = 1);

-- ----------------------------------------------------------------------------
-- 13. Zone de stockage locale par défaut (tenant 1)
-- ----------------------------------------------------------------------------
INSERT INTO storage_zones (tenant_id, name, type, is_default)
SELECT 1, 'Stockage local', 'local', TRUE
WHERE NOT EXISTS (SELECT 1 FROM storage_zones WHERE tenant_id = 1);

-- ============================================================================
-- ROLLBACK (down) — décommenter pour annuler la migration
-- DROP TRIGGER IF EXISTS trg_document_search_vector ON documents;
-- DROP FUNCTION IF EXISTS update_document_search_vector();
-- ALTER TABLE documents DROP COLUMN IF EXISTS search_vector;
-- DROP TABLE IF EXISTS storage_zones;
-- DROP TABLE IF EXISTS retention_policies;
-- DROP TABLE IF EXISTS document_relations;
-- DROP TABLE IF EXISTS user_group_memberships;
-- DROP TABLE IF EXISTS groups;
-- DROP TABLE IF EXISTS audit_logs;
-- DROP TABLE IF EXISTS metadata_values;
-- DROP TABLE IF EXISTS metadata_fields;
-- DROP TABLE IF EXISTS metadata_schemas;
-- ============================================================================
