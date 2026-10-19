-- ============================================================================
-- 025_request_loans.sql — prêt des dossiers physiques (registre de sortie)
-- ============================================================================
-- LE CIRCUIT REMPLACÉ : un agent appelle, l'archiviste cherche le dossier
-- papier, l'inscrit au registre, le remet contre signature ; plus tard, le
-- dossier revient, on le note « retourné » et on le range dans sa boîte.
--
-- Dans DocuFlow, la DEMANDE est la ligne du registre : l'agent l'a faite de
-- son propre compte. Cette table n'ajoute que ce que le registre papier
-- portait en plus — la remise, la date de retour prévue, le retour.
--
-- POURQUOI UNE TABLE À PART, ET PAS DE NOUVEAUX STATUTS
-- La remise fait passer la demande en « livré », comme aujourd'hui : la
-- machine à états, les statistiques, les e-mails et les écrans existants
-- restent tels quels. Le suivi du prêt vit ici, à côté.
--
-- PAS DE SIGNATURE DE L'AGENT PAR DÉFAUT : la remise est enregistrée par
-- l'archiviste et notifiée à l'agent, qui peut la SIGNALER s'il ne l'a pas
-- reçue (accusé de réception tacite). Une organisation peut exiger une
-- confirmation explicite (réglage loan_require_confirmation) :
-- reception_confirmee_at la porte.
--
-- Un prêt par demande (UNIQUE) : reprêter un dossier, c'est une nouvelle
-- demande (« Redemander »).
--
-- Idempotent. Retour arrière : docs/migrations/down/025_request_loans.down.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS request_loans (
    id                      SERIAL PRIMARY KEY,
    tenant_id               INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    request_id              INTEGER NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
    -- L'agent qui a le dossier : l'auteur de la demande au moment de la remise.
    emprunteur_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    remis_par               INTEGER REFERENCES users(id) ON DELETE SET NULL,
    remis_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_retour_prevue      DATE NOT NULL,
    observation_remise      TEXT,
    reception_confirmee_at  TIMESTAMPTZ,
    signale_at              TIMESTAMPTZ,
    signalement             TEXT,
    retourne_at             TIMESTAMPTZ,
    retourne_par            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    observation_retour      TEXT,
    -- Relances de retard : une par jour au plus.
    derniere_relance_at     TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT request_loans_retour_apres_remise CHECK (retourne_at IS NULL OR retourne_at >= remis_at)
);

-- Le registre interroge surtout « ce qui est dehors » d'une organisation.
CREATE INDEX IF NOT EXISTS idx_request_loans_en_cours ON request_loans(tenant_id, date_retour_prevue) WHERE retourne_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_request_loans_tenant ON request_loans(tenant_id, remis_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_loans_emprunteur ON request_loans(emprunteur_id);
