DROP INDEX IF EXISTS idx_notifications_a_pousser;
ALTER TABLE notifications DROP COLUMN IF EXISTS poussee_le;
DROP TABLE IF EXISTS cles_serveur;
DROP TABLE IF EXISTS push_abonnements;
