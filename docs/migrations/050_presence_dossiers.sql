-- 050 — Présence d'un dossier aux archives (édition AFGC).
-- Le demandeur sait, en demandant, si son dossier est entré aux archives et
-- dans quelle semaine : la recherche par nom compare des dénominations
-- simplifiées (minuscules, sans accents ni ponctuation), au trigramme près.
-- L'expression doit rester identique à NOM_SIMPLE (services/entreeService).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_dossiers_entres_nom_simple ON dossiers_entres USING GIN (
  (trim(regexp_replace(translate(lower(denomination), 'àáâäãéèêëíîïóôöõúùûüçñ', 'aaaaaeeeeiiioooouuuucn'), '[^a-z0-9]+', ' ', 'g'))) gin_trgm_ops
);
