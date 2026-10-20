-- ============================================================================
-- 029_classes_documents.sql — classes de documents, charte de nommage,
-- rangement automatique (modèle M-Files)
-- ============================================================================
-- Un schéma de métadonnées devient une CLASSE (Facture, Contrat, Prorogation…)
-- qui porte ses propres propriétés. Le schéma par défaut (is_default) reste
-- celui des PROPRIÉTÉS COMMUNES, affichées pour toutes les classes.
--
--   metadata_schemas.code              — code court de la classe (FAC, CTR…)
--   metadata_schemas.mots_cles         — mots qui la font reconnaître dans le
--                                        texte d'un scan (indexation assistée)
--   metadata_schemas.modele_nom        — charte de nommage : modèle du titre,
--                                        ex. « {code}-{année}-{compteur} — {Fournisseur} »
--   metadata_schemas.dossier_defaut_id — plan de classement : où ranger
--   metadata_schemas.sous_dossier_annee— … dans un sous-dossier par année
--   documents.classe_id                — classe du document
--   documents.numero_classe            — numéro attribué par le compteur
--   classe_compteurs                   — compteur par classe et par année
--
-- Les documents existants dont le type porte le nom d'une classe y sont
-- rattachés ; les autres restent sans classe et s'affichent comme avant.
-- Idempotent. Retour arrière : docs/migrations/down/029_classes_documents.down.sql
-- ============================================================================

ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS code VARCHAR(12);
ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS mots_cles TEXT;
ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS modele_nom TEXT;
ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS dossier_defaut_id INTEGER REFERENCES document_folders(id) ON DELETE SET NULL;
ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS sous_dossier_annee BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS classe_id INTEGER REFERENCES metadata_schemas(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS numero_classe INTEGER;
CREATE INDEX IF NOT EXISTS idx_documents_classe ON documents(tenant_id, classe_id);

CREATE TABLE IF NOT EXISTS classe_compteurs (
    schema_id INTEGER NOT NULL REFERENCES metadata_schemas(id) ON DELETE CASCADE,
    annee INTEGER NOT NULL,
    valeur INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (schema_id, annee)
);

-- Rattachement des documents existants : type = nom d'une classe (hors
-- propriétés communes), sans tenir compte de la casse.
UPDATE documents d
   SET classe_id = s.id
  FROM metadata_schemas s
 WHERE d.classe_id IS NULL
   AND s.tenant_id = d.tenant_id
   AND s.is_default IS NOT TRUE
   AND d.type_document IS NOT NULL
   AND lower(trim(d.type_document)) = lower(s.name);
