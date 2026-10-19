-- Retour arrière de 024_notifications_columns.sql — à exécuter À LA MAIN.
-- ATTENTION : si ces colonnes existaient AVANT 024 (ajoutées à la main en
-- production), ce script les supprime quand même, et le code qui les écrit
-- échouera. Ne l'exécuter que sur une base où 024 les a créées.
BEGIN;
DROP INDEX IF EXISTS idx_notifications_request;
ALTER TABLE notifications DROP COLUMN IF EXISTS request_id;
ALTER TABLE notifications DROP COLUMN IF EXISTS type;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '024_notifications_columns.sql';
  END IF;
END $$;
COMMIT;
