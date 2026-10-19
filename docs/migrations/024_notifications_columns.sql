-- ============================================================================
-- 024_notifications_columns.sql — colonnes que le code écrit déjà
-- ============================================================================
-- requestController insère dans `notifications` les colonnes `type` et
-- `request_id` (« demande créée », « assignée », « statut changé », avec le
-- lien vers la demande). AUCUN script du dépôt ne les crée : setup_db.sql
-- n'en dit rien, aucune migration non plus. La base de production les a
-- vraisemblablement reçues à la main ; une base neuve (installation de bureau,
-- nouveau serveur) ne les a pas, et chaque création de demande y échoue en
-- erreur 500 — APRÈS l'enregistrement de la demande, que le demandeur croit
-- perdue et recrée.
--
-- Idempotent : sans effet là où les colonnes existent déjà.
-- Retour arrière : docs/migrations/down/024_notifications_columns.down.sql
-- ============================================================================

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_request ON notifications(request_id);
