-- Retour arrière de 043_description_papier.sql (à appliquer à la main).
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_dates_extremes_check;
ALTER TABLE documents DROP COLUMN IF EXISTS annee_debut, DROP COLUMN IF EXISTS annee_fin,
  DROP COLUMN IF EXISTS range_par, DROP COLUMN IF EXISTS range_par_nom, DROP COLUMN IF EXISTS range_at;
ALTER TABLE emplacements DROP CONSTRAINT IF EXISTS emplacements_couleur_check;
ALTER TABLE emplacements DROP COLUMN IF EXISTS fonds, DROP COLUMN IF EXISTS type_boite, DROP COLUMN IF EXISTS couleur_etiquette;
