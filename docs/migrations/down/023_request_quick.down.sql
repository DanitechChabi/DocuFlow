-- ============================================================================
-- Retour arrière de 023_request_quick.sql — à exécuter À LA MAIN.
-- ============================================================================
-- Ce dossier n'est pas lu par backend/migrate.js (qui ne parcourt que les
-- .sql de docs/migrations, sans descendre dans les sous-dossiers).
--
-- ATTENTION : rétablir NOT NULL échoue si des demandes rapides (sans
-- références) ont été créées entre-temps. Elles sont d'abord complétées par
-- une valeur de repli visible (« À compléter », année de création), pour que
-- le retour arrière ne détruise aucune demande. Les colonnes ajoutées sont
-- supprimées : leur contenu (description, date souhaitée, bénéficiaire) est
-- PERDU — l'exporter avant si nécessaire.
-- ============================================================================

BEGIN;

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_identifiable;

UPDATE requests SET nom_entreprise = 'À compléter' WHERE nom_entreprise IS NULL;
UPDATE requests SET num_dossier = 'À compléter' WHERE num_dossier IS NULL;
UPDATE requests SET num_acte = 'À compléter' WHERE num_acte IS NULL;
UPDATE requests SET annee = EXTRACT(YEAR FROM created_at)::int WHERE annee IS NULL;

ALTER TABLE requests ALTER COLUMN nom_entreprise SET NOT NULL;
ALTER TABLE requests ALTER COLUMN num_dossier SET NOT NULL;
ALTER TABLE requests ALTER COLUMN num_acte SET NOT NULL;
ALTER TABLE requests ALTER COLUMN annee SET NOT NULL;

ALTER TABLE requests DROP COLUMN IF EXISTS source_request_id;
ALTER TABLE requests DROP COLUMN IF EXISTS beneficiaire;
ALTER TABLE requests DROP COLUMN IF EXISTS date_souhaitee;
ALTER TABLE requests DROP COLUMN IF EXISTS description;

UPDATE roles
   SET permissions = array_remove(permissions, 'requests.create')
 WHERE is_system AND key IN ('archiviste', 'lecteur');

-- Table de suivi de migrate.js / bootstrap desktop — absente si les
-- migrations ont été passées à la main (psql, éditeur SQL de Neon).
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '023_request_quick.sql';
  END IF;
END $$;

COMMIT;
