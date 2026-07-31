-- ============================================================================
-- Migration 001 : Multi-entreprise (Tenants)
-- Objectif : Permettre à DocuFlow de gérer plusieurs entreprises
-- ============================================================================

-- 1. Table des entreprises (tenants)
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    email_domain VARCHAR(255),
    contact_email VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Insérer le tenant par défaut pour les données existantes
INSERT INTO tenants (name, slug, status)
VALUES ('AFGC', 'afgc', 'active')
ON CONFLICT (slug) DO NOTHING;

-- 3. Ajouter tenant_id dans toutes les tables existantes
--    La valeur par défaut 1 correspond au tenant AFGC créé ci-dessus

-- Table users
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;

-- Table requests
ALTER TABLE requests ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE requests ALTER COLUMN tenant_id SET NOT NULL;

-- Table sections
ALTER TABLE sections ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE sections ALTER COLUMN tenant_id SET NOT NULL;

-- Table messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE messages ALTER COLUMN tenant_id SET NOT NULL;

-- Table notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE notifications ALTER COLUMN tenant_id SET NOT NULL;

-- Table audit_logs
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE audit_logs ALTER COLUMN tenant_id SET NOT NULL;

-- Table request_history
ALTER TABLE request_history ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE request_history ALTER COLUMN tenant_id SET NOT NULL;

-- Table request_details (si elle existe)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'request_details') THEN
        ALTER TABLE request_details ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
        ALTER TABLE request_details ALTER COLUMN tenant_id SET NOT NULL;
    END IF;
END $$;

-- 4. Migrer la table settings (key-value) en multi-tenant
--    Supprimer l'ancienne contrainte unique sur key, ajouter (tenant_id, key)

-- Vérifier la contrainte existante sur settings
DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'settings'
    AND con.contype = 'p';

    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE settings DROP CONSTRAINT ' || constraint_name;
    END IF;
END $$;

-- Ajouter tenant_id à settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE settings ALTER COLUMN tenant_id SET NOT NULL;

-- Ajouter UNIQUE contrainte sur (tenant_id, key)
ALTER TABLE settings ADD CONSTRAINT settings_tenant_key_unique UNIQUE (tenant_id, key);

-- 5. Index pour les performances
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_requests_tenant ON requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_requests_tenant_status ON requests(tenant_id, statut);
CREATE INDEX IF NOT EXISTS idx_sections_tenant ON sections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_participants ON messages(tenant_id, sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_settings_tenant ON settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- ============================================================================
-- Fin de la migration
-- ============================================================================
