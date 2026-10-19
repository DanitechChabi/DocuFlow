-- ============================================================================
-- 028_ocr.sql — reconnaissance de caractères (OCR) des documents scannés
-- ============================================================================
-- Un scan (PDF sans couche texte, photo, TIFF) n'a pas de texte à extraire :
-- 027 le note « tenté, vide ». Ces fichiers passent désormais par l'OCR, en
-- arrière-plan (services/ocrService), et leur texte rejoint l'index comme
-- celui de n'importe quel document.
--
--   texte_source  — 'texte' (couche texte du fichier) ou 'ocr' (reconnu) :
--                   l'interface peut dire d'où vient le texte, et un OCR
--                   imparfait n'est pas pris pour le texte d'origine ;
--   ocr_tente_at  — OCR fait ou abandonné (NULL = en file d'attente).
--
-- Idempotent. Retour arrière : docs/migrations/down/028_ocr.down.sql
-- ============================================================================

ALTER TABLE document_files ADD COLUMN IF NOT EXISTS texte_source VARCHAR(10);
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS ocr_tente_at TIMESTAMPTZ;

-- Ce qui a déjà un texte vient de la couche texte du fichier.
UPDATE document_files SET texte_source = 'texte' WHERE texte_extrait IS NOT NULL AND texte_source IS NULL;

-- File d'attente de l'OCR : extraction faite, rien trouvé, OCR pas encore tenté.
CREATE INDEX IF NOT EXISTS idx_document_files_ocr_a_faire ON document_files(id)
  WHERE texte_extrait IS NULL AND texte_extrait_at IS NOT NULL AND ocr_tente_at IS NULL;
