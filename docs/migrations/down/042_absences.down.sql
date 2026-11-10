-- Retour arrière de 042_absences.sql (à appliquer à la main).
DROP TABLE IF EXISTS absences;
ALTER TABLE courriers DROP COLUMN IF EXISTS lettre, DROP COLUMN IF EXISTS lettre_signataire, DROP COLUMN IF EXISTS lettre_qualite, DROP COLUMN IF EXISTS lettre_lieu;
