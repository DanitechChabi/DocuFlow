-- Retour arrière de 040_portail_citoyen.sql (à appliquer à la main).
DROP TABLE IF EXISTS demandes_citoyennes;
DROP INDEX IF EXISTS idx_copies_certifiees_jeton;
ALTER TABLE copies_certifiees DROP COLUMN IF EXISTS jeton_verification;
