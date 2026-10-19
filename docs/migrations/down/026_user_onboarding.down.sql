-- Retour arrière de 026_user_onboarding.sql — à exécuter À LA MAIN.
-- La progression des visites guidées est perdue : chacun reverra les visites.
BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS onboarding;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '026_user_onboarding.sql';
  END IF;
END $$;
COMMIT;
