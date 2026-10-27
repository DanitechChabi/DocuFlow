-- Retour arrière de 037_horodatage_formats.sql (à appliquer à la main).
DROP TABLE IF EXISTS horodatages;
DROP FUNCTION IF EXISTS horodatages_inalterables();
ALTER TABLE document_files DROP CONSTRAINT IF EXISTS document_files_format_risque_check;
ALTER TABLE document_files
  DROP COLUMN IF EXISTS copie_de_file_id, DROP COLUMN IF EXISTS format_identifie_at, DROP COLUMN IF EXISTS pdfa,
  DROP COLUMN IF EXISTS format_risque, DROP COLUMN IF EXISTS format_version, DROP COLUMN IF EXISTS format_nom;
