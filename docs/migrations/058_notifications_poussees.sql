-- 058 — Notifications sur l'ordinateur ou le téléphone (Web Push) : les
-- appareils abonnés de chaque utilisateur, et la trace de l'envoi de chaque
-- notification. Les clés VAPID viennent des variables d'environnement
-- VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ; à défaut, le serveur en crée une
-- paire au premier démarrage et la garde ici (cles_serveur).

CREATE TABLE IF NOT EXISTS push_abonnements (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  appareil    VARCHAR(255),
  cree_le     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dernier_envoi TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_abonnements_user ON push_abonnements (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS cles_serveur (
  nom    VARCHAR(100) PRIMARY KEY,
  valeur TEXT NOT NULL,
  cree_le TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS poussee_le TIMESTAMP;
-- Les notifications déjà là ne sont jamais poussées.
UPDATE notifications SET poussee_le = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE poussee_le IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_a_pousser ON notifications (created_at) WHERE poussee_le IS NULL;
