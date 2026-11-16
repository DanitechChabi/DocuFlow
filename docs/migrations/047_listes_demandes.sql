-- ============================================================================
-- Migration 047 : demandes groupées en listes, et cadre des sorties
--
-- Pendant certaines périodes (soldes créditeurs, passage du commissaire aux
-- comptes, commission bancaire…), les dossiers ne se demandent pas un par un :
-- un service envoie un classeur Excel de listes (« Liste 1 » … « Liste n »).
-- Une LISTE réunit les demandes déposées d'un coup ; elle se transmet et se
-- retourne d'un geste, et l'on retrouve ensuite tout ce qui est sorti dans ce
-- cadre et dans cette liste.
--
-- Le cadre de chaque sortie reste porté par requests.motif (liste réglable par
-- organisation) ; la liste le rappelle pour l'affichage et la recherche.
-- Rien ne change pour les demandes déposées une à une (lot_id NULL).
-- ============================================================================

CREATE TABLE IF NOT EXISTS request_lots (
    id            SERIAL PRIMARY KEY,
    tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    libelle       VARCHAR(120) NOT NULL,
    cadre         VARCHAR(100) NOT NULL,
    -- Classeur d'origine (nom du fichier), pour retrouver la source.
    fichier       VARCHAR(255),
    -- Pour qui les dossiers sortent (l'emprunteur) ; et qui a déposé la liste,
    -- lorsque l'archiviste la saisit pour un service.
    demandeur_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    cree_par      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_lots_tenant ON request_lots(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_lots_cadre ON request_lots(tenant_id, cadre);

ALTER TABLE requests ADD COLUMN IF NOT EXISTS lot_id INTEGER REFERENCES request_lots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_requests_lot ON requests(lot_id) WHERE lot_id IS NOT NULL;
-- Recherche des sorties par cadre (« tout ce qui est sorti pour les soldes créditeurs »).
CREATE INDEX IF NOT EXISTS idx_requests_tenant_motif ON requests(tenant_id, motif);
