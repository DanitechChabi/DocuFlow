-- ============================================================================
-- Migration 007 : Alignement du schéma des fichiers joints
-- ============================================================================
-- Certaines bases (locale et éventuellement prod) n'ont pas reçu les colonnes
-- de multi-tenant / Cloudinary sur request_files et message_attachments, alors
-- que les migrations 002/003/005 étaient marquées appliquées (tables créées
-- avant les ALTER). Cette migration est idempotente : elle garantit que les
-- colonnes existent, sans effet si elles sont déjà présentes.

-- request_files : stockage Cloudinary + multi-tenant
ALTER TABLE request_files ADD COLUMN IF NOT EXISTS cloudinary_public_id VARCHAR(255);
ALTER TABLE request_files ADD COLUMN IF NOT EXISTS secure_url TEXT;
ALTER TABLE request_files ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE request_files ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_request_files_tenant ON request_files(tenant_id);

-- message_attachments : idem
ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS cloudinary_public_id VARCHAR(255);
ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS secure_url TEXT;
ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE message_attachments ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_attachments_tenant ON message_attachments(tenant_id);
