-- Retour arrière de 035_recherche_echeances.sql — à exécuter À LA MAIN.
-- ATTENTION : les recherches enregistrées, leurs alertes et toutes les
-- échéances (manuelles comprises) sont perdues ; les notifications déjà
-- envoyées restent. Le marquage « échéance » des propriétés disparaît.
BEGIN;
DROP TABLE IF EXISTS document_echeances;
DROP TABLE IF EXISTS recherche_alertes_vus;
DROP TABLE IF EXISTS recherches_enregistrees;
ALTER TABLE metadata_fields DROP COLUMN IF EXISTS est_echeance;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '035_recherche_echeances.sql';
  END IF;
END $$;
COMMIT;
