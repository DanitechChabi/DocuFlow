-- ============================================================================
-- 043_description_papier.sql — la description archivistique des dossiers
-- papier, telle qu'elle se porte sur un bordereau de traitement.
-- ============================================================================
--
-- Sur le terrain, chaque dossier traité donne une ligne de bordereau : cote,
-- analyse, DATES EXTRÊMES, et pour la boîte qui le reçoit son TYPE et la
-- COULEUR DE SON ÉTIQUETTE. Les boîtes se rangent FONDS par fonds (respect
-- des fonds : PRMP, comptabilité, moyens généraux…). Ces bordereaux servent
-- ensuite à rédiger le répertoire, l'instrument de recherche.
--
--   emplacements.fonds              le service producteur dont viennent les
--                                   documents de la boîte ;
--   emplacements.type_boite         boîte d'archives, carton, liasse… (libre) ;
--   emplacements.couleur_etiquette  code couleur de l'étiquette collée au dos ;
--   documents.annee_debut/_fin      dates extrêmes du dossier, en années
--                                   (c'est l'usage des répertoires) ;
--   documents.range_par(_nom), range_at   qui a rangé le dossier, et quand :
--                                   « personne ne se souvient où c'est rangé,
--                                   ni qui l'a rangé » n'arrive plus.
-- ============================================================================

ALTER TABLE emplacements ADD COLUMN IF NOT EXISTS fonds VARCHAR(150);
ALTER TABLE emplacements ADD COLUMN IF NOT EXISTS type_boite VARCHAR(60);
ALTER TABLE emplacements ADD COLUMN IF NOT EXISTS couleur_etiquette VARCHAR(10);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emplacements_couleur_check') THEN
    ALTER TABLE emplacements ADD CONSTRAINT emplacements_couleur_check
      CHECK (couleur_etiquette IS NULL OR couleur_etiquette IN ('blanc', 'jaune', 'vert', 'bleu', 'rouge', 'rose', 'orange', 'violet', 'gris'));
  END IF;
END $$;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS annee_debut INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS annee_fin INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS range_par INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS range_par_nom VARCHAR(150);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS range_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_dates_extremes_check') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_dates_extremes_check
      CHECK ((annee_debut IS NULL OR annee_debut BETWEEN 1000 AND 2200)
         AND (annee_fin IS NULL OR annee_fin BETWEEN 1000 AND 2200)
         AND (annee_debut IS NULL OR annee_fin IS NULL OR annee_fin >= annee_debut));
  END IF;
END $$;
