-- Retour arrière de 025_request_loans.sql — à exécuter À LA MAIN.
-- ATTENTION : supprime le registre des prêts (remises, retours, signalements).
-- Les demandes elles-mêmes et le journal d'audit (qui trace chaque remise et
-- chaque retour) sont conservés. Exporter le registre avant si nécessaire.
BEGIN;
DROP TABLE IF EXISTS request_loans;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '025_request_loans.sql';
  END IF;
END $$;
COMMIT;
