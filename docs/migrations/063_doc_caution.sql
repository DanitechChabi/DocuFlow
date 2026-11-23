-- 063 — Doc Caution : les actes (Word, PDF) du dossier partagé, lus par
-- l'application pour retrouver un acte à partir de la référence du marché
-- écrite sur le courrier du DE (remboursements), puis le dossier lui-même.
--   texte_compact : le texte en minuscules, sans espaces ni ponctuation, pour
--   qu'une référence se retrouve quelle que soit sa mise en forme
--   (« N° 2026/123/MEF » ou « n°2026-123 MEF »).
CREATE TABLE IF NOT EXISTS doc_caution_actes (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    chemin          VARCHAR(1000) NOT NULL,       -- chemin relatif dans Doc Caution
    nom_fichier     VARCHAR(500) NOT NULL,
    origine         VARCHAR(20) NOT NULL DEFAULT 'depot', -- 'dossier' (lu sur le partage) | 'depot' (déposé depuis le navigateur)
    taille          BIGINT,
    modifie_le      TIMESTAMPTZ,
    empreinte       VARCHAR(64),
    num_acte        VARCHAR(50),
    annee           INTEGER,
    client          VARCHAR(500),
    references_marche TEXT[],
    texte           TEXT,
    texte_compact   TEXT,
    erreur          VARCHAR(500),
    indexe_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, chemin)
);
CREATE INDEX IF NOT EXISTS idx_doc_caution_compact ON doc_caution_actes USING GIN (texte_compact gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_doc_caution_acte ON doc_caution_actes (tenant_id, num_acte);
