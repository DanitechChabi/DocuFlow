-- Retour arrière de 038_archives_physiques.sql (à appliquer à la main).
ALTER TABLE request_loans DROP CONSTRAINT IF EXISTS request_loans_nature_check;
ALTER TABLE request_loans DROP COLUMN IF EXISTS emplacement_id, DROP COLUMN IF EXISTS document_id, DROP COLUMN IF EXISTS nature;
DROP TABLE IF EXISTS recolement_lignes;
DROP TABLE IF EXISTS recolements;
DROP FUNCTION IF EXISTS recolements_inalterables();
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_support_check;
ALTER TABLE documents DROP COLUMN IF EXISTS cote_physique, DROP COLUMN IF EXISTS emplacement_id, DROP COLUMN IF EXISTS support;
DROP TABLE IF EXISTS emplacements;
