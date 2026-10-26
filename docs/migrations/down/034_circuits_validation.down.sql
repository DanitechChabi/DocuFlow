-- Retour arrière de 034_circuits_validation.sql — à exécuter À LA MAIN.
-- ATTENTION : les circuits configurés, les circuits en cours, les tâches et
-- les VISAS sont perdus. Les visas restent prouvés par le journal chaîné
-- (VISA_APPROUVE / VISA_REFUSE / VISA_VU : empreinte du fichier visé et du
-- visa), qui n'est pas touché. Les documents « en validation » le restent :
-- les remettre « disponible » par la fiche si besoin.
BEGIN;
DROP TRIGGER IF EXISTS trg_circuit_visas_inalterables ON circuit_visas;
DROP FUNCTION IF EXISTS circuit_visas_inalterables();
DROP TABLE IF EXISTS circuit_visas;
DROP TABLE IF EXISTS circuit_taches;
DROP TABLE IF EXISTS circuit_instances;
DROP TABLE IF EXISTS circuit_etapes;
DROP TABLE IF EXISTS circuit_modeles;
DELETE FROM settings WHERE key IN ('circuits_relance_jours', 'circuits_nouvelle_version');
UPDATE roles SET permissions = array_remove(array_remove(permissions, 'workflows.manage'), 'workflows.start')
 WHERE is_system;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '034_circuits_validation.sql';
  END IF;
END $$;
COMMIT;
