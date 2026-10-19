-- ============================================================================
-- 027_ged_recherche_contenu.sql — le contenu des documents devient cherchable
-- ============================================================================
-- CONSTAT : le texte extrait des fichiers ne servait qu'à proposer des tags
-- automatiques, puis était jeté. En mode Cloudinary (la production), il
-- n'était même pas extrait : le fichier temporaire était supprimé par
-- l'envoi vers Cloudinary AVANT l'extraction, qui ne trouvait plus rien. La
-- recherche « dans le contenu » n'a donc jamais pu fonctionner en ligne.
--
-- 1. Texte conservé :
--    document_files.texte_extrait   — le texte de CETTE version (immuable,
--                                     comme le fichier) ;
--    document_files.texte_extrait_at — tentative faite (NULL = à faire : le
--                                     rattrapage en arrière-plan la traitera) ;
--    documents.contenu_texte        — le texte de toutes les versions, pour
--                                     l'index.
-- 2. Index plein texte : le contenu y entre (poids D, sous les références,
--    la description et les tags).
-- 3. Similarité des noms (pg_trgm, migration 010) indexée : la recherche
--    automatique tolère les fautes de frappe (« SOTRA » / « S.O.T.R.A SA »).
-- 4. requests.ged_score — meilleur score de correspondance trouvé dans la GED
--    (0-100) : le badge « Dans la GED » des listes sans recalcul.
-- 5. request_files.source_document_file_id — une pièce jointe COPIÉE depuis la
--    GED (« Transmettre ce document ») partage le binaire du document : la
--    supprimer de la demande ne doit pas détruire le fichier de la GED.
--
-- Idempotent. Retour arrière : docs/migrations/down/027_ged_recherche_contenu.down.sql
-- ============================================================================

ALTER TABLE document_files ADD COLUMN IF NOT EXISTS texte_extrait TEXT;
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS texte_extrait_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS contenu_texte TEXT;
CREATE INDEX IF NOT EXISTS idx_document_files_texte_a_faire ON document_files(id) WHERE texte_extrait_at IS NULL;

CREATE OR REPLACE FUNCTION update_document_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('french', COALESCE(NEW.nom_entreprise,'')), 'A') ||
        setweight(to_tsvector('french', COALESCE(NEW.num_dossier,'')), 'A') ||
        setweight(to_tsvector('french', COALESCE(NEW.num_acte,'')), 'A') ||
        setweight(to_tsvector('french', COALESCE(NEW.description,'')), 'B') ||
        setweight(to_tsvector('french', COALESCE(array_to_string(NEW.tags, ' '),'')), 'C') ||
        setweight(to_tsvector('french', COALESCE(NEW.contenu_texte,'')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_search_vector ON documents;
CREATE TRIGGER trg_document_search_vector
    BEFORE INSERT OR UPDATE OF nom_entreprise, num_dossier, num_acte, description, tags, contenu_texte
    ON documents
    FOR EACH ROW EXECUTE FUNCTION update_document_search_vector();

-- Documents dont l'index n'a jamais été calculé (créés avant 010, ou trigger
-- absent à l'époque) : on le calcule une fois.
UPDATE documents SET description = description WHERE search_vector IS NULL;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_documents_nom_trgm ON documents USING gin (lower(nom_entreprise) gin_trgm_ops);

ALTER TABLE requests ADD COLUMN IF NOT EXISTS ged_score SMALLINT;
ALTER TABLE request_files ADD COLUMN IF NOT EXISTS source_document_file_id INTEGER REFERENCES document_files(id) ON DELETE SET NULL;
