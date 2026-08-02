-- ============================================================================
-- Migration 002 : Tables pour les fichiers joints (demandes et messagerie)
-- ============================================================================

-- 1. Fichiers joints aux demandes
CREATE TABLE IF NOT EXISTS request_files (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    cloudinary_public_id VARCHAR(255),
    mime_type VARCHAR(100),
    file_size INTEGER,
    secure_url TEXT,
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_request_files_request ON request_files(request_id);

-- 2. Fichiers joints aux messages
CREATE TABLE IF NOT EXISTS message_attachments (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    cloudinary_public_id VARCHAR(255),
    mime_type VARCHAR(100),
    file_size INTEGER,
    secure_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);

-- 3. Ajouter les colonnes Cloudinary si la table existe déjà (idempotent)
ALTER TABLE request_files ADD COLUMN IF NOT EXISTS cloudinary_public_id VARCHAR(255);
ALTER TABLE request_files ADD COLUMN IF NOT EXISTS secure_url TEXT;
ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS cloudinary_public_id VARCHAR(255);
ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS secure_url TEXT;
