-- 004_ged.sql — GED (gestion électronique des documents) reliée aux demandes
-- Idempotent : peut être exécuté sur une base neuve ou existante.

-- 1. Dossiers / classement (arborescence)
CREATE TABLE IF NOT EXISTS document_folders (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    parent_id INTEGER REFERENCES document_folders(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_folders_tenant ON document_folders(tenant_id);

-- 2. Fichiers d'un document (avec versions)
CREATE TABLE IF NOT EXISTS document_files (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version INTEGER DEFAULT 1,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    cloudinary_public_id VARCHAR(255),
    mime_type VARCHAR(100),
    file_size INTEGER,
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_files_document ON document_files(document_id);

-- 3. Historique du cycle de vie documentaire
CREATE TABLE IF NOT EXISTS document_history (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    previous_status VARCHAR(20),
    new_status VARCHAR(20),
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_history_document ON document_history(document_id);

-- 4. Enrichir documents (le schéma minimal vient de setup_db.sql)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS type_document VARCHAR(100);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE documents ADD COLUMN IF NOT EXISTS auteur VARCHAR(100);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS date_document DATE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'disponible'
    CHECK (statut IN ('disponible', 'prêt', 'archivé'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS dossier_id INTEGER REFERENCES document_folders(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_entreprise ON documents(tenant_id, nom_entreprise);
CREATE INDEX IF NOT EXISTS idx_documents_dossier ON documents(tenant_id, num_dossier, num_acte);
CREATE INDEX IF NOT EXISTS idx_documents_statut ON documents(statut);

-- 5. Lien demande ↔ document
ALTER TABLE requests ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES documents(id);
