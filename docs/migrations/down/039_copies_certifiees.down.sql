-- Retour arrière de 039_copies_certifiees.sql (à appliquer à la main).
DELETE FROM horodatages WHERE objet_type = 'copie_certifiee';
ALTER TABLE horodatages DROP CONSTRAINT IF EXISTS horodatages_objet_type_check;
ALTER TABLE horodatages ADD CONSTRAINT horodatages_objet_type_check
  CHECK (objet_type IN ('sceau', 'pv_elimination', 'versement'));
DROP TABLE IF EXISTS copies_certifiees_compteurs;
DROP TABLE IF EXISTS copies_certifiees;
DROP FUNCTION IF EXISTS copies_certifiees_inalterables();
