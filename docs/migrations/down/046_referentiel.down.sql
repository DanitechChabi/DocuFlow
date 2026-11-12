-- Retour arrière de 046_referentiel.sql (à appliquer à la main).
DROP INDEX IF EXISTS idx_metadata_schemas_referentiel;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS referentiel;
