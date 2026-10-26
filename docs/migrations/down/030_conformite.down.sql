-- Retour arrière de 030_conformite.sql — à exécuter À LA MAIN.
-- Les analyses et les alertes sont des données DÉRIVÉES : elles se
-- recalculent depuis les documents. Rien de ce que les utilisateurs ont
-- saisi sur les documents n'est touché ; seuls les statuts « traitée » ou
-- « ignorée » des alertes sont perdus.
BEGIN;
DROP TABLE IF EXISTS compliance_alerts;
DROP TABLE IF EXISTS document_extractions;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS nature_conformite;
UPDATE roles SET permissions = array_remove(array_remove(permissions, 'compliance.view'), 'compliance.manage')
 WHERE is_system;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '030_conformite.sql';
  END IF;
END $$;
COMMIT;
