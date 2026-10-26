-- ============================================================================
-- 035_recherche_echeances.sql — retrouver, surveiller, rappeler, restituer
-- ============================================================================
--
-- 1. RECHERCHES ENREGISTRÉES (Alfresco « saved searches », M-Files « vues »).
--    Une recherche avancée (critères combinés : texte, fiche, classe et ses
--    propriétés typées, dossier et sous-dossiers, dates, archivage) se garde
--    sous un nom. Elle est privée, ou partagée avec l'organisation — les
--    autres la voient et l'exécutent, sans pouvoir la modifier. Les critères
--    sont stockés en JSON tels que validés par le serveur : une recherche
--    n'est jamais du SQL, elle est retraduite à chaque exécution, avec le
--    périmètre (ACL) de celui qui l'exécute.
--
--    ALERTE (M-Files « me prévenir des nouveaux objets ») : au plus une fois
--    par jour, la recherche est rejouée avec le périmètre de son auteur ; les
--    documents qui y entrent pour la première fois lui sont notifiés.
--    « Première fois » est tenu par recherche_alertes_vus : l'ensemble des
--    documents déjà connus de l'alerte. Il est initialisé sans notification
--    quand l'alerte est activée (ou ses critères modifiés) — l'auteur n'est
--    pas inondé par l'existant — et un document n'est signalé qu'une fois,
--    même s'il sort puis rentre dans les résultats. Un document qui devient
--    lisible plus tard (ACL élargie) ou qui ne correspond qu'après indexation
--    est, lui, bien « nouveau » le jour où il apparaît.
--
-- 2. ÉCHÉANCIER (rappels de dates). document_echeances porte trois sources :
--    - 'manuelle'   : posée depuis la fiche (« Renouvellement du contrat ») ;
--    - 'metadonnee' : dérivée d'une propriété DATE marquée « échéance »
--                     (metadata_fields.est_echeance) — fin de contrat, date
--                     d'échéance d'une facture, validité d'une attestation ;
--    - 'analyse'    : dérivée de la date d'échéance lue par l'analyse (030,
--                     document_extractions.donnees->>'date_echeance').
--    La dérivation est IDEMPOTENTE : une ligne par document et par source
--    (cle_source = 'champ:<id>' ou 'analyse'), mise à jour si la date change
--    (le cycle de rappel repart alors : une échéance renouvelée est une
--    nouvelle échéance), jamais dupliquée.
--
--    Rappels : à J-n (rappel_jours_avant, sinon le réglage
--    echeances_rappel_jours) puis le jour même, une fois chacun
--    (rappel_envoye_at, echeance_envoyee_at). « Reporter » diffère les
--    rappels jusqu'à reporte_au, où une relance unique est envoyée.
--
-- 3. Les propriétés de date dont le NOM technique dit l'échéance (catalogue
--    de classes DocuFlow : date d'échéance, de fin, de validité,
--    d'expiration) sont marquées d'office ; l'Échéancier permet d'en marquer
--    ou démarquer d'autres.
--
-- Aucune permission nouvelle : recherche avancée = search.advanced,
-- recherches enregistrées = search.documents, échéances = documents.view
-- (+ documents.edit pour viser autrui), export = documents.download.
--
-- Idempotent. Retour arrière : docs/migrations/down/035_recherche_echeances.down.sql
-- ============================================================================

-- 1. Recherches enregistrées ------------------------------------------------
CREATE TABLE IF NOT EXISTS recherches_enregistrees (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- L'auteur : sa recherche part avec lui (014 : CASCADE ou SET NULL).
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nom VARCHAR(120) NOT NULL,
    description TEXT,
    criteres JSONB NOT NULL DEFAULT '{}'::jsonb,
    partagee BOOLEAN NOT NULL DEFAULT false,
    epinglee BOOLEAN NOT NULL DEFAULT false,
    alerte BOOLEAN NOT NULL DEFAULT false,
    alerte_verifiee_at TIMESTAMPTZ,
    alerte_derniere_notif_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id, nom)
);
CREATE INDEX IF NOT EXISTS idx_recherches_tenant ON recherches_enregistrees(tenant_id, partagee);
CREATE INDEX IF NOT EXISTS idx_recherches_alertes ON recherches_enregistrees(alerte_verifiee_at NULLS FIRST) WHERE alerte;

CREATE TABLE IF NOT EXISTS recherche_alertes_vus (
    recherche_id INTEGER NOT NULL REFERENCES recherches_enregistrees(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    vu_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (recherche_id, document_id)
);

-- 2. Échéancier ----------------------------------------------------------------
ALTER TABLE metadata_fields ADD COLUMN IF NOT EXISTS est_echeance BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS document_echeances (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    date_echeance DATE NOT NULL,
    libelle VARCHAR(200) NOT NULL,
    note TEXT,
    source VARCHAR(12) NOT NULL DEFAULT 'manuelle',
    cle_source VARCHAR(40),                 -- NULL pour une échéance manuelle
    champ_id INTEGER REFERENCES metadata_fields(id) ON DELETE CASCADE,
    rappel_jours_avant SMALLINT,            -- NULL = réglage echeances_rappel_jours
    destinataire_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    destinataire_role VARCHAR(50),
    statut VARCHAR(10) NOT NULL DEFAULT 'a_venir',
    rappel_envoye_at TIMESTAMPTZ,
    echeance_envoyee_at TIMESTAMPTZ,
    reporte_au DATE,
    relance_envoyee_at TIMESTAMPTZ,
    traitee_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    traitee_par_nom VARCHAR(150),
    traitee_at TIMESTAMPTZ,
    commentaire TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_echeances_source_check') THEN
    ALTER TABLE document_echeances ADD CONSTRAINT document_echeances_source_check
      CHECK (source IN ('manuelle', 'metadonnee', 'analyse'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_echeances_statut_check') THEN
    ALTER TABLE document_echeances ADD CONSTRAINT document_echeances_statut_check
      CHECK (statut IN ('a_venir', 'notifiee', 'traitee', 'annulee'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_echeances_rappel_check') THEN
    ALTER TABLE document_echeances ADD CONSTRAINT document_echeances_rappel_check
      CHECK (rappel_jours_avant IS NULL OR rappel_jours_avant BETWEEN 0 AND 365);
  END IF;
END $$;
-- Idempotence de la dérivation : une seule échéance par document et par source.
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_echeances_source
  ON document_echeances(document_id, cle_source) WHERE cle_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_document_echeances_tenant ON document_echeances(tenant_id, statut, date_echeance);
CREATE INDEX IF NOT EXISTS idx_document_echeances_document ON document_echeances(document_id);

-- 3. Propriétés d'échéance du catalogue DocuFlow -------------------------------
UPDATE metadata_fields SET est_echeance = true
 WHERE type = 'date' AND NOT est_echeance
   AND name IN ('date_d_echeance', 'nouvelle_date_d_echeance', 'date_de_fin', 'date_de_validite',
                'date_d_expiration', 'expiration_date');
