-- Retour arrière de la migration 047 : les demandes restent, sans leur liste.
DROP INDEX IF EXISTS idx_requests_tenant_motif;
DROP INDEX IF EXISTS idx_requests_lot;
ALTER TABLE requests DROP COLUMN IF EXISTS lot_id;
DROP INDEX IF EXISTS idx_request_lots_cadre;
DROP INDEX IF EXISTS idx_request_lots_tenant;
DROP TABLE IF EXISTS request_lots;
