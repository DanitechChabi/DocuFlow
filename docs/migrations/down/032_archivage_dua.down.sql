-- Retour arrière de 032_archivage_dua.sql — à exécuter À LA MAIN.
-- ATTENTION : les bordereaux d'élimination (et leurs procès-verbaux) sont des
-- pièces probantes ; les exporter avant. Les documents déjà éliminés restent
-- des pierres tombales (deleted_at posé, fichiers détruits) : ils apparaîtront
-- dans la corbeille, sans fichier — l'élimination, elle, est irréversible.
BEGIN;
SET LOCAL docuflow.audit_override = 'on';
DROP TABLE IF EXISTS decisions_sort_final;
DROP TRIGGER IF EXISTS trg_document_files_elimine ON document_files;
DROP FUNCTION IF EXISTS refuser_fichier_elimine();
DROP TRIGGER IF EXISTS trg_documents_elimination ON documents;
DROP FUNCTION IF EXISTS garder_pierre_tombale();
DROP INDEX IF EXISTS idx_documents_elimines;
ALTER TABLE documents DROP COLUMN IF EXISTS elimine_bordereau_id;
ALTER TABLE documents DROP COLUMN IF EXISTS elimine_at;
DROP TABLE IF EXISTS bordereau_documents;
DROP TABLE IF EXISTS bordereaux_compteurs;
DROP TABLE IF EXISTS bordereaux_elimination;
DROP FUNCTION IF EXISTS bordereaux_inalterables();
DROP TRIGGER IF EXISTS trg_documents_archive_at ON documents;
DROP FUNCTION IF EXISTS documents_dater_archivage();
ALTER TABLE documents DROP COLUMN IF EXISTS archive_at;
ALTER TABLE metadata_schemas DROP CONSTRAINT IF EXISTS metadata_schemas_dua_sort_check;
ALTER TABLE metadata_schemas DROP CONSTRAINT IF EXISTS metadata_schemas_sort_final_check;
ALTER TABLE metadata_schemas DROP CONSTRAINT IF EXISTS metadata_schemas_dua_point_depart_check;
ALTER TABLE metadata_schemas DROP CONSTRAINT IF EXISTS metadata_schemas_dua_annees_check;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS dua_reference;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS sort_final;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS dua_point_depart;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS dua_annees;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '032_archivage_dua.sql';
  END IF;
END $$;
COMMIT;
