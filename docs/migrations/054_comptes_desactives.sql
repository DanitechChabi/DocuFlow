-- 054 — Comptes désactivés et dernière connexion.
-- Un agent qui quitte l'organisation n'est plus supprimé (ses demandes, prêts
-- et traces resteraient orphelins) : son compte est désactivé — il ne peut
-- plus se connecter, ses sessions tombent — et peut être réactivé.
ALTER TABLE users ADD COLUMN IF NOT EXISTS desactive_le TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS desactive_par VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS derniere_connexion TIMESTAMP;
