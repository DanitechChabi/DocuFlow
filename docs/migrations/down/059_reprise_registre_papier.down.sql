DROP INDEX IF EXISTS idx_request_loans_reprise;
ALTER TABLE request_loans DROP COLUMN IF EXISTS reprise_empreinte;
ALTER TABLE request_loans DROP COLUMN IF EXISTS emprunteur_nom;
