-- Retour arrière de 027_ged_recherche_contenu.sql — à exécuter À LA MAIN.
-- Le texte extrait est perdu (il sera ré-extrait si 027 est ré-appliquée).
-- ATTENTION : les pièces jointes copiées depuis la GED perdent leur marque de
-- provenance ; supprimer l'une d'elles détruirait alors le fichier de la GED.
BEGIN;
CREATE OR REPLACE FUNCTION update_document_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('french', COALESCE(NEW.nom_entreprise,'')), 'A') ||
        setweight(to_tsvector('french', COALESCE(NEW.num_dossier,'')), 'A') ||
        setweight(to_tsvector('french', COALESCE(NEW.num_acte,'')), 'A') ||
        setweight(to_tsvector('french', COALESCE(NEW.description,'')), 'B') ||
        setweight(to_tsvector('french', COALESCE(array_to_string(NEW.tags, ' '),'')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_document_search_vector ON documents;
CREATE TRIGGER trg_document_search_vector
    BEFORE INSERT OR UPDATE OF nom_entreprise, num_dossier, num_acte, description, tags
    ON documents
    FOR EACH ROW EXECUTE FUNCTION update_document_search_vector();
DROP INDEX IF EXISTS idx_documents_nom_trgm;
DROP INDEX IF EXISTS idx_document_files_texte_a_faire;
ALTER TABLE request_files DROP COLUMN IF EXISTS source_document_file_id;
ALTER TABLE requests DROP COLUMN IF EXISTS ged_score;
ALTER TABLE documents DROP COLUMN IF EXISTS contenu_texte;
ALTER TABLE document_files DROP COLUMN IF EXISTS texte_extrait_at;
ALTER TABLE document_files DROP COLUMN IF EXISTS texte_extrait;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '027_ged_recherche_contenu.sql';
  END IF;
END $$;
COMMIT;
