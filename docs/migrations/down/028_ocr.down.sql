-- Retour arrière de 028_ocr.sql — à exécuter À LA MAIN.
-- Le texte déjà reconnu par OCR reste dans texte_extrait (et dans l'index) ;
-- seule l'information de provenance et la file d'attente disparaissent.
BEGIN;
DROP INDEX IF EXISTS idx_document_files_ocr_a_faire;
ALTER TABLE document_files DROP COLUMN IF EXISTS ocr_tente_at;
ALTER TABLE document_files DROP COLUMN IF EXISTS texte_source;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '028_ocr.sql';
  END IF;
END $$;
COMMIT;
