-- ============================================================================
-- 046_referentiel.sql — classes « référentiel ».
-- ============================================================================
--
-- Un classeur importé (registre d'entreprises, liste de dossiers, fichier du
-- personnel…) n'est pas qu'une suite de fiches : c'est ce que l'organisation
-- SAIT déjà. Les fiches d'une classe marquée « référentiel » servent donc à
-- reconnaître les documents à indexer : quand un document cite l'une de ces
-- entreprises ou l'un de ces numéros, l'indexation assistée propose les
-- informations de la fiche correspondante, écrites comme dans le référentiel.
-- ============================================================================

ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS referentiel BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_metadata_schemas_referentiel ON metadata_schemas(tenant_id) WHERE referentiel;
