-- ============================================================================
-- 030_conformite.sql — analyse des documents et contrôle de conformité
-- ============================================================================
-- Architecture « médaillon » (bronze / argent / or) sur PostgreSQL :
--
--   BRONZE  le fichier versé et son texte (documents, document_files — déjà là)
--   ARGENT  document_extractions : ce que l'analyse a lu dans le document
--           (nature, émetteur, destinataire, montants, dates, identifiants),
--           par règles et, si l'organisation l'a activé, par un modèle de
--           langage (Groq ou Ollama)
--   OR      compliance_alerts : les incohérences détectées ENTRE documents
--           (identifiant d'entreprise, montants devis/facture, chronologie,
--           attestations expirées, registre officiel), avec leur traitement
--
--   metadata_schemas.nature_conformite — une classe (Facture, Devis…) dit à
--       quel rôle elle joue dans les contrôles : facture | devis | attestation
--
-- Les documents existants sont analysés en arrière-plan au démarrage ; rien
-- n'est modifié sur eux. Idempotent.
-- Retour arrière : docs/migrations/down/030_conformite.down.sql
-- ============================================================================

ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS nature_conformite VARCHAR(20)
  CHECK (nature_conformite IS NULL OR nature_conformite IN ('facture', 'devis', 'attestation'));

-- Classes du catalogue DocuFlow déjà installées : leur rôle est connu.
UPDATE metadata_schemas SET nature_conformite = 'facture'
 WHERE nature_conformite IS NULL AND code IN ('FACF', 'FACC');
UPDATE metadata_schemas SET nature_conformite = 'devis'
 WHERE nature_conformite IS NULL AND code = 'DEV';

CREATE TABLE IF NOT EXISTS document_extractions (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    nature VARCHAR(20) NOT NULL DEFAULT 'autre',        -- facture | devis | attestation | autre
    confiance NUMERIC(3,2),                             -- 0.00 – 1.00
    source VARCHAR(10) NOT NULL DEFAULT 'regles',       -- regles | llm | mixte
    modele VARCHAR(100),                                -- ex. groq/llama-3.3-70b-versatile
    donnees JSONB NOT NULL DEFAULT '{}'::jsonb,
    erreur TEXT,                                        -- échec du modèle (les règles ont servi)
    analyse_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id)
);
CREATE INDEX IF NOT EXISTS idx_document_extractions_tenant ON document_extractions(tenant_id, nature);

CREATE TABLE IF NOT EXISTS compliance_alerts (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    empreinte VARCHAR(40) NOT NULL,                     -- identité stable d'une alerte
    type VARCHAR(40) NOT NULL,
    severite VARCHAR(10) NOT NULL CHECK (severite IN ('critique', 'haute', 'moyenne', 'faible')),
    description TEXT NOT NULL,
    document_ids INTEGER[] NOT NULL DEFAULT '{}',
    champ VARCHAR(50),
    valeur_a TEXT,
    valeur_b TEXT,
    suggestion TEXT,
    statut VARCHAR(10) NOT NULL DEFAULT 'ouverte'
      CHECK (statut IN ('ouverte', 'traitee', 'ignoree', 'resolue')),
    note TEXT,
    traite_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    traite_at TIMESTAMPTZ,
    detectee_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    mise_a_jour_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, empreinte)
);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_tenant ON compliance_alerts(tenant_id, statut, severite);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_documents ON compliance_alerts USING GIN (document_ids);

-- Permissions : consulter la conformité (admin, archiviste, responsable) et la
-- gérer — traiter les alertes, relancer l'analyse (admin, archiviste).
UPDATE roles
   SET permissions = array_append(permissions, 'compliance.view')
 WHERE is_system
   AND key IN ('admin', 'archiviste', 'responsable')
   AND NOT ('compliance.view' = ANY (permissions))
   AND NOT ('*' = ANY (permissions));
UPDATE roles
   SET permissions = array_append(permissions, 'compliance.manage')
 WHERE is_system
   AND key IN ('admin', 'archiviste')
   AND NOT ('compliance.manage' = ANY (permissions))
   AND NOT ('*' = ANY (permissions));
