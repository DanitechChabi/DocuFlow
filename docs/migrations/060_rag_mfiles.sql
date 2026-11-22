-- 060 — Recherche dans M-Files (API REST) et RAG.
--
-- rag_passages : les morceaux de texte que DocuBot cite pour répondre
--   (documents de la GED, fichiers M-Files indexés). Recherche plein texte
--   en français ; vecteur (multilingual-e5-small) quand le modèle est là.
-- mfiles_objets : ce que l'application sait d'un objet M-Files (titre,
--   classe, propriétés, fichiers) et la version déjà indexée.
CREATE TABLE IF NOT EXISTS rag_passages (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source      VARCHAR(20) NOT NULL,          -- 'ged' | 'mfiles'
    source_ref  VARCHAR(100) NOT NULL,         -- id du document ; « type-id » M-Files
    version     VARCHAR(40),
    titre       VARCHAR(500),
    morceau     INTEGER NOT NULL,
    texte       TEXT NOT NULL,
    vecteur     REAL[],
    cree_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, source, source_ref, morceau)
);
CREATE INDEX IF NOT EXISTS idx_rag_passages_texte ON rag_passages USING GIN (to_tsvector('french', texte));
CREATE INDEX IF NOT EXISTS idx_rag_passages_source ON rag_passages (tenant_id, source, source_ref);

CREATE TABLE IF NOT EXISTS mfiles_objets (
    tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    objet_type  INTEGER NOT NULL,
    objet_id    INTEGER NOT NULL,
    version     INTEGER,
    titre       VARCHAR(500),
    classe      VARCHAR(255),
    proprietes  JSONB,
    fichiers    JSONB,
    modifie_le  TIMESTAMPTZ,
    vu_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
    indexe_version INTEGER,
    indexe_le   TIMESTAMPTZ,
    erreur_index TEXT,
    PRIMARY KEY (tenant_id, objet_type, objet_id)
);
