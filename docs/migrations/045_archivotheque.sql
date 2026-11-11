-- ============================================================================
-- 045_archivotheque.sql — archivothèque virtuelle.
-- ============================================================================
--
-- Valoriser les archives, c'est en montrer quelques-unes : une sélection de
-- pièces consultables en ligne, sans compte. Une pièce n'y entre qu'à trois
-- conditions, toutes tracées ici :
--   — elle est communicable au public (décret n° 2007-532, art. 32 et 33) ;
--   — celui qui la propose déclare qu'elle ne porte aucune donnée
--     personnelle, ou qu'elles ont été masquées ;
--   — une personne habilitée autorise la publication.
-- Le fichier publié est figé à la proposition : une version déposée plus
-- tard dans la GED ne part pas d'elle-même en ligne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS archivotheque_pieces (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    fichier_id INTEGER REFERENCES document_files(id) ON DELETE SET NULL,
    titre VARCHAR(300) NOT NULL,
    notice TEXT,
    date_affichee VARCHAR(60),
    theme VARCHAR(120),
    sans_donnees_personnelles BOOLEAN NOT NULL DEFAULT false,
    statut VARCHAR(12) NOT NULL DEFAULT 'proposee' CHECK (statut IN ('proposee', 'publiee', 'retiree')),
    propose_par INTEGER,
    propose_par_nom VARCHAR(150),
    propose_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    autorise_par INTEGER,
    autorise_par_nom VARCHAR(150),
    autorise_at TIMESTAMPTZ,
    retire_par_nom VARCHAR(150),
    retire_at TIMESTAMPTZ,
    retire_motif TEXT,
    vues INTEGER NOT NULL DEFAULT 0,
    UNIQUE (tenant_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_archivotheque_publiees ON archivotheque_pieces(tenant_id, autorise_at DESC) WHERE statut = 'publiee';
