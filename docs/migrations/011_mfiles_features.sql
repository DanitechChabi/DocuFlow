-- ============================================================================
-- 011_mfiles_features.sql — Fonctionnalités M-Files (Check-in/Check-out, Vues Dynamiques)
-- ============================================================================

-- 1. Verrouillage des documents (Check-in / Check-out)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_checked_out BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS checked_out_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMP;

-- 2. Vues Dynamiques (Dynamic Views par métadonnées)
CREATE TABLE IF NOT EXISTS dynamic_views (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    group_by_field VARCHAR(50) NOT NULL DEFAULT 'type_document', -- type_document, annee, statut, nom_entreprise, auteur
    filter_json JSONB DEFAULT '{}'::jsonb,
    is_public BOOLEAN DEFAULT TRUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dynamic_views_tenant ON dynamic_views(tenant_id);
