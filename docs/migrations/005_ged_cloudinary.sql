-- 005_ged_cloudinary.sql — stocke l'URL sécurisée Cloudinary des fichiers du GED
-- Idempotent : peut être exécuté sur une base neuve ou existante.
--
-- La reconstruction d'URL via cloudinary.url(public_id, {resource_type}) est peu
-- fiable : Cloudinary classe certains formats autrement que le mime (PDF → image),
-- et ajoute version + format. On stocke donc le secure_url renvoyé à l'upload.
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS secure_url TEXT;

-- Ajouter aussi pour request_files et message_attachments (déjà fait dans 003 mais redondance OK)
ALTER TABLE request_files ADD COLUMN IF NOT EXISTS secure_url TEXT;
ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS secure_url TEXT;
