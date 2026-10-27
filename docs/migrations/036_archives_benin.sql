-- ============================================================================
-- 036_archives_benin.sql — conformité au décret n° 2007-532 du 2 novembre 2007
-- (attributions, organisation et fonctionnement des Archives Nationales du
-- Bénin) : visa de l'autorité d'archives sur les éliminations, bordereaux de
-- versement, délais de communicabilité.
-- ============================================================================
--
-- 1. VISA DE L'AUTORITÉ D'ARCHIVES SUR LES ÉLIMINATIONS (art. 44). Les listes
--    de documents à éliminer sont soumises à la Direction des Archives
--    Nationales (ou à la Direction des Archives Départementales qui la
--    représente, art. 24) ; la destruction a lieu sous son contrôle, sur place
--    ou par une entreprise spécialisée. Le circuit interne (brouillon →
--    proposé → validé) est complété, quand l'organisation l'exige
--    (bordereaux_elimination.visa_requis, figé à la proposition), par :
--      validé → transmis (à l'autorité) → visé → exécuté.
--    Le visa reçu est enregistré : autorité, numéro, date, décision (accordé,
--    partiel, refusé), observations, pièce (le courrier de visa, scanné dans
--    la GED). Un visa PARTIEL exclut des lignes (bordereau_documents.exclu_visa)
--    qui seront écartées à l'exécution ; un visa REFUSÉ rejette le bordereau.
--    L'exécution note le mode de destruction, le prestataire et le contrôleur.
--
-- 2. BORDEREAUX DE VERSEMENT (art. 42-47). Chaque année les services versent
--    au pré-archivage ; le pré-archivage verse aux archives publiques les
--    documents de 10 ans. Un bordereau de versement suit :
--      brouillon → transmis → pris en charge (récépissé) | annulé.
--    Chaque ligne garde l'instantané du document (comme un bordereau
--    d'élimination). La prise en charge marque les documents versés
--    (documents.verse_at, verse_versement_id) : ils restent consultables dans
--    DocuFlow, archivés, l'original étant confié au service d'archives.
--
-- 3. COMMUNICABILITÉ (art. 32-33). La classe porte sa catégorie : règle
--    générale de 30 ans, état civil 100 ans après l'acte, dossiers de
--    personnel 90 ans après la naissance, etc. Les liens de partage publics
--    vers un document non encore communicable exigent une autorisation
--    (art. 32 al. 3 : comité permanent), dont la référence est conservée.
--
-- Idempotent. Retour arrière : docs/migrations/down/036_archives_benin.down.sql
-- ============================================================================

-- 1. Visa de l'autorité d'archives ---------------------------------------------
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS visa_requis BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS transmis_par INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS transmis_par_nom VARCHAR(150);
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS transmis_at TIMESTAMPTZ;
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS visa_autorite VARCHAR(200);
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS visa_numero VARCHAR(100);
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS visa_date DATE;
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS visa_decision VARCHAR(10);
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS visa_observations TEXT;
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS visa_piece_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS visa_saisi_par INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS visa_saisi_par_nom VARCHAR(150);
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS visa_saisi_at TIMESTAMPTZ;
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS mode_destruction VARCHAR(12);
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS prestataire VARCHAR(200);
ALTER TABLE bordereaux_elimination ADD COLUMN IF NOT EXISTS controle_par VARCHAR(200);
ALTER TABLE bordereau_documents ADD COLUMN IF NOT EXISTS exclu_visa BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  ALTER TABLE bordereaux_elimination DROP CONSTRAINT IF EXISTS bordereaux_elimination_statut_check;
  ALTER TABLE bordereaux_elimination ADD CONSTRAINT bordereaux_elimination_statut_check
    CHECK (statut IN ('brouillon', 'propose', 'valide', 'transmis', 'vise', 'rejete', 'execute', 'annule'));
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bordereaux_elimination_visa_decision_check') THEN
    ALTER TABLE bordereaux_elimination ADD CONSTRAINT bordereaux_elimination_visa_decision_check
      CHECK (visa_decision IS NULL OR visa_decision IN ('accorde', 'partiel', 'refuse'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bordereaux_elimination_mode_destruction_check') THEN
    ALTER TABLE bordereaux_elimination ADD CONSTRAINT bordereaux_elimination_mode_destruction_check
      CHECK (mode_destruction IS NULL OR mode_destruction IN ('sur_place', 'prestataire'));
  END IF;
END $$;

-- 2. Bordereaux de versement ---------------------------------------------------
CREATE TABLE IF NOT EXISTS bordereaux_versement (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    numero VARCHAR(20) NOT NULL,                    -- BV-2026-0001, par organisation
    intitule VARCHAR(200) NOT NULL,
    destination VARCHAR(20) NOT NULL DEFAULT 'pre_archivage'
      CHECK (destination IN ('pre_archivage', 'archives_publiques')),
    service_destinataire VARCHAR(200),              -- « Dépôt de pré-archivage », « Archives départementales du … »
    commentaire TEXT,
    statut VARCHAR(16) NOT NULL DEFAULT 'brouillon'
      CHECK (statut IN ('brouillon', 'transmis', 'pris_en_charge', 'annule')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_nom VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    transmis_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    transmis_par_nom VARCHAR(150),
    transmis_at TIMESTAMPTZ,
    recepisse_numero VARCHAR(100),
    recepisse_date DATE,
    recepisse_piece_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    pris_en_charge_par_nom VARCHAR(150),            -- l'agent du service d'archives qui signe le récépissé
    enregistre_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    enregistre_par_nom VARCHAR(150),
    enregistre_at TIMESTAMPTZ,
    annule_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    annule_par_nom VARCHAR(150),
    annule_at TIMESTAMPTZ,
    motif_annulation TEXT,
    empreinte CHAR(64),                             -- empreinte du bordereau à sa transmission
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);
ALTER TABLE bordereaux_versement ALTER COLUMN statut TYPE VARCHAR(16);
CREATE INDEX IF NOT EXISTS idx_bordereaux_versement_tenant ON bordereaux_versement(tenant_id, statut, created_at DESC);

CREATE TABLE IF NOT EXISTS versements_compteurs (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    annee INTEGER NOT NULL,
    dernier INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, annee)
);

CREATE TABLE IF NOT EXISTS versement_documents (
    id SERIAL PRIMARY KEY,
    versement_id INTEGER NOT NULL REFERENCES bordereaux_versement(id) ON DELETE CASCADE,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    ordre INTEGER NOT NULL DEFAULT 0,
    reference VARCHAR(100),
    intitule TEXT,
    classe VARCHAR(100),
    dossier TEXT,
    annee INTEGER,
    date_document DATE,
    echeance DATE,
    sort_final VARCHAR(12),
    communicabilite VARCHAR(20),
    nb_fichiers INTEGER NOT NULL DEFAULT 0,
    volume_octets BIGINT NOT NULL DEFAULT 0,
    fichiers JSONB NOT NULL DEFAULT '[]'::jsonb,
    ajoute_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_versement_documents_versement ON versement_documents(versement_id, ordre);
CREATE UNIQUE INDEX IF NOT EXISTS idx_versement_documents_unique ON versement_documents(versement_id, document_id) WHERE document_id IS NOT NULL;

-- Un bordereau pris en charge (et ses lignes) ne se modifie plus.
CREATE OR REPLACE FUNCTION versements_inalterables() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  fige BOOLEAN;
BEGIN
  IF coalesce(current_setting('docuflow.audit_override', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME = 'bordereaux_versement' THEN
    fige := OLD.statut = 'pris_en_charge';
    IF fige AND TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - 'created_by' - 'transmis_par' - 'enregistre_par' - 'annule_par' - 'recepisse_piece_document_id')
         = (to_jsonb(OLD) - 'created_by' - 'transmis_par' - 'enregistre_par' - 'annule_par' - 'recepisse_piece_document_id') THEN
      RETURN NEW;
    END IF;
  ELSE
    SELECT v.statut = 'pris_en_charge' INTO fige FROM bordereaux_versement v WHERE v.id = OLD.versement_id;
    IF coalesce(fige, false) AND TG_OP = 'UPDATE' AND NEW.document_id IS NULL
       AND (to_jsonb(NEW) - 'document_id') = (to_jsonb(OLD) - 'document_id') THEN
      RETURN NEW;
    END IF;
  END IF;
  IF coalesce(fige, false) THEN
    RAISE EXCEPTION 'VERSEMENT_PRIS_EN_CHARGE: un bordereau de versement pris en charge ne se modifie plus (% refusé)', TG_OP
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS trg_bordereaux_versement_inalterables ON bordereaux_versement;
CREATE TRIGGER trg_bordereaux_versement_inalterables BEFORE UPDATE OR DELETE ON bordereaux_versement
  FOR EACH ROW EXECUTE FUNCTION versements_inalterables();
DROP TRIGGER IF EXISTS trg_versement_documents_inalterables ON versement_documents;
CREATE TRIGGER trg_versement_documents_inalterables BEFORE UPDATE OR DELETE ON versement_documents
  FOR EACH ROW EXECUTE FUNCTION versements_inalterables();

ALTER TABLE documents ADD COLUMN IF NOT EXISTS verse_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS verse_versement_id INTEGER REFERENCES bordereaux_versement(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_documents_verses ON documents(tenant_id, verse_at) WHERE verse_at IS NOT NULL;

-- 3. Communicabilité ---------------------------------------------------------
ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS communicabilite VARCHAR(20);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metadata_schemas_communicabilite_check') THEN
    ALTER TABLE metadata_schemas ADD CONSTRAINT metadata_schemas_communicabilite_check
      CHECK (communicabilite IS NULL OR communicabilite IN
        ('libre', 'general', 'etat_civil', 'medical', 'personnel', 'judiciaire', 'statistique', 'surete'));
  END IF;
END $$;

-- Autorisation de communication anticipée portée par un lien de partage public.
ALTER TABLE document_partages ADD COLUMN IF NOT EXISTS autorisation_communication TEXT;

-- Permission « communication anticipée » (art. 32 al. 3) donnée aux rôles système
-- qui gèrent déjà les archives ; les rôles personnalisés restent tels quels.
UPDATE roles SET permissions = array_append(permissions, 'archives.communicate')
 WHERE is_system AND key IN ('admin', 'archiviste')
   AND NOT ('archives.communicate' = ANY (permissions)) AND NOT ('*' = ANY (permissions));
