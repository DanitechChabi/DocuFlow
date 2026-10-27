-- ============================================================================
-- 040_portail_citoyen.sql — démarches en ligne pour l'usager.
-- ============================================================================
--
-- 1. VÉRIFICATION PUBLIQUE DES COPIES CERTIFIÉES. Chaque nouvelle copie reçoit
--    un jeton aléatoire, imprimé en QR code sur le PDF : n'importe quelle
--    administration vérifie la copie sans compte ni appel téléphonique. Le
--    jeton n'est pas le numéro (séquentiel, donc devinable).
--
-- 2. DEMANDES CITOYENNES. Un usager dépose sans compte une demande d'acte
--    (naissance, mariage, décès…) sur le portail de l'organisation et la suit
--    par un code de suivi. La demande entre dans le circuit habituel (table
--    requests, « À traiter ») au nom d'un compte technique « Portail citoyen » ;
--    l'identité de l'usager vit ici, à part, pour ne pas la mêler aux comptes.
-- ============================================================================

ALTER TABLE copies_certifiees ADD COLUMN IF NOT EXISTS jeton_verification VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS idx_copies_certifiees_jeton ON copies_certifiees(jeton_verification) WHERE jeton_verification IS NOT NULL;

CREATE TABLE IF NOT EXISTS demandes_citoyennes (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    code_suivi VARCHAR(16) NOT NULL UNIQUE,
    type_acte VARCHAR(20) NOT NULL CHECK (type_acte IN ('naissance', 'mariage', 'deces', 'autre')),
    demandeur_nom TEXT NOT NULL,
    demandeur_prenoms TEXT NOT NULL,
    telephone VARCHAR(30) NOT NULL,
    email TEXT,
    lien VARCHAR(20) NOT NULL CHECK (lien IN ('soi_meme', 'parent', 'conjoint', 'mandataire', 'autre')),
    personne_concernee TEXT NOT NULL,
    date_evenement DATE,
    annee_evenement INTEGER,
    lieu_evenement TEXT,
    numero_acte TEXT,
    motif TEXT,
    ip VARCHAR(64),
    pret_notifie_at TIMESTAMPTZ,
    retire_at TIMESTAMPTZ,
    retire_par_nom TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (request_id)
);
CREATE INDEX IF NOT EXISTS idx_demandes_citoyennes_tenant ON demandes_citoyennes(tenant_id, created_at DESC);
