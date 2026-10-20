-- Retour arrière de 029_classes_documents.sql — à exécuter À LA MAIN.
-- Les classes restent des schémas de métadonnées et les valeurs saisies sont
-- conservées ; seuls le rattachement des documents, la charte, le rangement
-- et les compteurs disparaissent. Les titres déjà calculés restent en place.
BEGIN;
DROP TABLE IF EXISTS classe_compteurs;
DROP INDEX IF EXISTS idx_documents_classe;
ALTER TABLE documents DROP COLUMN IF EXISTS numero_classe;
ALTER TABLE documents DROP COLUMN IF EXISTS classe_id;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS sous_dossier_annee;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS dossier_defaut_id;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS modele_nom;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS mots_cles;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS code;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '029_classes_documents.sql';
  END IF;
END $$;
COMMIT;
