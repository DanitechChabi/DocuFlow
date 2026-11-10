-- ============================================================================
-- 041_courrier.sql — gestion du courrier (bureau d'ordre).
-- ============================================================================
--
-- Le registre du courrier d'une administration : chaque lettre reçue
-- (ARRIVÉE), envoyée (DÉPART) ou échangée entre services (INTERNE) reçoit à
-- l'enregistrement un numéro chronologique annuel (A-2026-00001), puis suit
-- son chemin : affectation à un agent avec l'instruction du responsable,
-- prise en charge, réponse liée, clôture. Chaque étape est horodatée.
--
--   * Le numéro vient d'un compteur par organisation, sens et année : ni trou
--     ni doublon, même à deux enregistrements simultanés.
--   * Le scan de la lettre est un document de la GED (document_id) : il y est
--     indexé, cherchable, conservé selon sa classe.
--   * Une réponse est un courrier DÉPART qui pointe sur l'arrivée
--     (reponse_a_id) ; son expédition clôt l'arrivée.
--   * Confidentiel : visible de celui qui l'a enregistré, de l'agent chargé et
--     des personnes en copie seulement.
--   * notifications.lien : une notification peut mener à n'importe quel écran
--     (jusqu'ici, seulement à un document ou une demande).
-- ============================================================================

CREATE TABLE IF NOT EXISTS courriers (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sens VARCHAR(8) NOT NULL CHECK (sens IN ('arrivee', 'depart', 'interne')),
    numero VARCHAR(24) NOT NULL,
    objet TEXT NOT NULL,
    correspondant TEXT NOT NULL,                 -- expéditeur (arrivée) ou destinataire (départ)
    organisme TEXT,
    reference_externe TEXT,                      -- la référence portée par la lettre reçue
    date_courrier DATE,                          -- date écrite sur la lettre
    canal VARCHAR(12) NOT NULL DEFAULT 'papier'
        CHECK (canal IN ('papier', 'poste', 'porteur', 'email', 'portail', 'autre')),
    nature VARCHAR(16) NOT NULL DEFAULT 'lettre'
        CHECK (nature IN ('lettre', 'note', 'demande', 'reclamation', 'invitation', 'facture', 'rapport', 'autre')),
    urgent BOOLEAN NOT NULL DEFAULT FALSE,
    confidentiel BOOLEAN NOT NULL DEFAULT FALSE,
    statut VARCHAR(14) NOT NULL
        CHECK (statut IN ('enregistre', 'affecte', 'en_traitement', 'brouillon', 'expedie', 'clos')),
    reponse_attendue BOOLEAN NOT NULL DEFAULT FALSE,
    echeance DATE,
    assigne_a INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigne_nom TEXT,
    assigne_at TIMESTAMPTZ,
    instruction TEXT,                            -- annotation du responsable à l'affectation
    copies INTEGER[] NOT NULL DEFAULT '{}',
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    reponse_a_id INTEGER REFERENCES courriers(id) ON DELETE SET NULL,
    expedie_at TIMESTAMPTZ,
    mode_expedition TEXT,
    accuse_reception_at TIMESTAMPTZ,
    clos_at TIMESTAMPTZ,
    clos_motif VARCHAR(12) CHECK (clos_motif IS NULL OR clos_motif IN ('repondu', 'information', 'sans_suite', 'expedie')),
    relance_at TIMESTAMPTZ,
    retard_notifie_at TIMESTAMPTZ,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_nom TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_courriers_tenant ON courriers(tenant_id, sens, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_courriers_assigne ON courriers(tenant_id, assigne_a) WHERE statut IN ('affecte', 'en_traitement');
CREATE INDEX IF NOT EXISTS idx_courriers_reponse ON courriers(reponse_a_id) WHERE reponse_a_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS courrier_compteurs (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sens VARCHAR(8) NOT NULL,
    annee INTEGER NOT NULL,
    dernier INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, sens, annee)
);

CREATE TABLE IF NOT EXISTS courrier_evenements (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    courrier_id INTEGER NOT NULL REFERENCES courriers(id) ON DELETE CASCADE,
    action VARCHAR(24) NOT NULL,
    par INTEGER,
    par_nom TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_courrier_evenements ON courrier_evenements(courrier_id, id);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS lien TEXT;

-- Permissions du courrier pour les rôles système ; les rôles personnalisés
-- restent tels quels.
UPDATE roles SET permissions = array_append(permissions, 'mail.view')
 WHERE is_system AND key IN ('admin', 'responsable', 'archiviste', 'agent')
   AND NOT ('mail.view' = ANY (permissions)) AND NOT ('*' = ANY (permissions));
UPDATE roles SET permissions = array_append(permissions, 'mail.register')
 WHERE is_system AND key IN ('admin', 'responsable', 'archiviste')
   AND NOT ('mail.register' = ANY (permissions)) AND NOT ('*' = ANY (permissions));
UPDATE roles SET permissions = array_append(permissions, 'mail.manage')
 WHERE is_system AND key IN ('admin', 'responsable')
   AND NOT ('mail.manage' = ANY (permissions)) AND NOT ('*' = ANY (permissions));
