-- 006_requests_archive.sql — Archivage des demandes
-- Ajoute la colonne `archived` aux demandes pour permettre
-- à l'ultra-admin d'archiver ou de supprimer les demandes sans
-- encombrer le tableau de bord.

ALTER TABLE requests ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_requests_archived ON requests(archived);
CREATE INDEX IF NOT EXISTS idx_requests_tenant_archived ON requests(tenant_id, archived);
