-- ============================================================================
-- 032_archivage_dua.sql — archivage réglementaire : durée d'utilité
-- administrative (DUA), sort final, bordereaux d'élimination, procès-verbal
-- ============================================================================
--
-- 1. DUA ET SORT FINAL PAR CLASSE. Une classe de documents (metadata_schemas,
--    modèle M-Files) porte désormais sa règle de conservation, celle du
--    tableau de gestion : combien d'années (dua_annees), à compter de quel
--    événement (dua_point_depart), et ce qu'il advient du document au terme
--    (sort_final) :
--      conservation  versement aux archives définitives ;
--      elimination   destruction, par bordereau validé ;
--      tri           décision au cas par cas (éliminer ou conserver).
--    dua_reference garde la base légale (article, ligne du tableau de
--    gestion). Une classe sans DUA ne produit aucune échéance : il n'y a PAS
--    de repli sur les réglages « Conservation » (default_retention_years) —
--    une destruction doit reposer sur une règle explicite, jamais sur un
--    défaut. Les politiques de rétention historiques (retention_policies,
--    retentionService) continuent de fonctionner telles quelles.
--
-- 2. DATE D'ARCHIVAGE. Le point de départ « archivage » exige de savoir quand
--    le document est entré au statut « archivé ». Plutôt que de relire
--    l'historique (document_history, texte libre, sans tenant), la date est
--    portée par documents.archive_at et tenue par un TRIGGER : quel que soit
--    le chemin (fiche, rétention automatique, script), entrer en « archivé »
--    la pose, en sortir (désarchivage) l'efface — la DUA ne court que pour un
--    document archivé. Les documents déjà archivés sont rattrapés : dernière
--    entrée « archivé » de leur historique, à défaut leur dernière mise à jour.
--
-- 3. BORDEREAUX D'ÉLIMINATION, avec SÉPARATION DES TÂCHES : l'archiviste
--    (archives.manage) prépare le bordereau puis le propose ; un valideur
--    (archives.validate) qui n'en est ni l'auteur ni le proposant le valide
--    ou le rejette (motif obligatoire) ; l'archiviste l'exécute. Chaque ligne
--    garde l'INSTANTANÉ du document (référence, intitulé, classe, dates,
--    échéance, fichiers et leurs empreintes SHA-256) : après l'élimination,
--    le bordereau et son procès-verbal sont la seule mémoire de ce qui a été
--    détruit. Un bordereau exécuté est une pièce probante : la base refuse de
--    le modifier (seules passent les anonymisations ON DELETE SET NULL, et la
--    suppression d'une organisation entière, drapeau docuflow.audit_override).
--
-- 4. PIERRE TOMBALE. Un document éliminé n'est pas supprimé : sa ligne reste
--    (identifiant, référence, classe), ses fichiers et son contenu partent.
--    Elle porte elimine_at / elimine_bordereau_id, ET deleted_at : toutes les
--    listes qui écartent déjà la corbeille (deleted_at IS NULL) écartent ainsi
--    les documents éliminés sans modification — y compris celles écrites
--    demain ; seules les vues de la corbeille l'excluent explicitement. La
--    base refuse de « restaurer » une pierre tombale, de lui rendre des
--    fichiers, et d'éliminer un document sous gel juridique (031).
--
-- 5. DÉCISIONS DE SORT FINAL. Au terme de la DUA, un document à conserver est
--    versé aux archives définitives ; un document « tri » (ou à éliminer que
--    l'on décide de garder) est conservé avec une note. La décision le sort
--    de la liste des échéances à traiter.
--
-- Idempotent. Retour arrière : docs/migrations/down/032_archivage_dua.down.sql
-- ============================================================================

-- 1. DUA et sort final des classes -------------------------------------------
ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS dua_annees INTEGER;
ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS dua_point_depart VARCHAR(20) NOT NULL DEFAULT 'date_document';
ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS sort_final VARCHAR(12);
ALTER TABLE metadata_schemas ADD COLUMN IF NOT EXISTS dua_reference TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metadata_schemas_dua_annees_check') THEN
    ALTER TABLE metadata_schemas ADD CONSTRAINT metadata_schemas_dua_annees_check
      CHECK (dua_annees IS NULL OR dua_annees BETWEEN 0 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metadata_schemas_dua_point_depart_check') THEN
    ALTER TABLE metadata_schemas ADD CONSTRAINT metadata_schemas_dua_point_depart_check
      CHECK (dua_point_depart IN ('date_document', 'creation', 'archivage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metadata_schemas_sort_final_check') THEN
    ALTER TABLE metadata_schemas ADD CONSTRAINT metadata_schemas_sort_final_check
      CHECK (sort_final IS NULL OR sort_final IN ('conservation', 'elimination', 'tri'));
  END IF;
  -- Une DUA sans sort final ne dirait pas quoi faire à l'échéance.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metadata_schemas_dua_sort_check') THEN
    ALTER TABLE metadata_schemas ADD CONSTRAINT metadata_schemas_dua_sort_check
      CHECK (dua_annees IS NULL OR sort_final IS NOT NULL);
  END IF;
END $$;

-- 2. Date d'archivage ---------------------------------------------------------
ALTER TABLE documents ADD COLUMN IF NOT EXISTS archive_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION documents_dater_archivage() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.statut = 'archivé' THEN NEW.archive_at := COALESCE(NEW.archive_at, now()); END IF;
    RETURN NEW;
  END IF;
  IF NEW.statut = 'archivé' AND OLD.statut IS DISTINCT FROM 'archivé' THEN
    NEW.archive_at := now();
  ELSIF NEW.statut IS DISTINCT FROM 'archivé' THEN
    NEW.archive_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_documents_archive_at ON documents;
CREATE TRIGGER trg_documents_archive_at BEFORE INSERT OR UPDATE OF statut ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_dater_archivage();

-- Rattrapage (UPDATE OF archive_at seul : aucun autre trigger ne se déclenche).
UPDATE documents d
   SET archive_at = COALESCE(
         (SELECT max(h.created_at) FROM document_history h
           WHERE h.document_id = d.id AND h.new_status = 'archivé'),
         d.updated_at, d.created_at)
 WHERE d.statut = 'archivé' AND d.archive_at IS NULL;

-- 3. Bordereaux d'élimination -------------------------------------------------
CREATE TABLE IF NOT EXISTS bordereaux_elimination (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    numero VARCHAR(20) NOT NULL,                -- BE-2026-0001, par organisation
    intitule VARCHAR(200) NOT NULL,
    commentaire TEXT,
    statut VARCHAR(12) NOT NULL DEFAULT 'brouillon'
      CHECK (statut IN ('brouillon', 'propose', 'valide', 'rejete', 'execute', 'annule')),
    -- Les noms sont recopiés : un bordereau se signe d'un nom, et la
    -- suppression d'un compte ne doit pas effacer qui a agi.
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_nom VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    propose_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    propose_par_nom VARCHAR(150),
    propose_at TIMESTAMPTZ,
    valide_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    valide_par_nom VARCHAR(150),
    valide_at TIMESTAMPTZ,
    rejete_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    rejete_par_nom VARCHAR(150),
    rejete_at TIMESTAMPTZ,
    motif_rejet TEXT,
    execute_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    execute_par_nom VARCHAR(150),
    execute_at TIMESTAMPTZ,
    annule_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    annule_par_nom VARCHAR(150),
    annule_at TIMESTAMPTZ,
    motif_annulation TEXT,
    -- Empreinte SHA-256 du procès-verbal, figée à l'exécution (et inscrite au
    -- journal chaîné) : un PV imprimé se compare à elle.
    empreinte_pv CHAR(64),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_bordereaux_elimination_tenant ON bordereaux_elimination(tenant_id, statut, created_at DESC);

CREATE TABLE IF NOT EXISTS bordereaux_compteurs (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    annee INTEGER NOT NULL,
    dernier INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, annee)
);

CREATE TABLE IF NOT EXISTS bordereau_documents (
    id SERIAL PRIMARY KEY,
    bordereau_id INTEGER NOT NULL REFERENCES bordereaux_elimination(id) ON DELETE CASCADE,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    ordre INTEGER NOT NULL DEFAULT 0,
    -- Instantané (rafraîchi à la proposition, figé à l'exécution).
    reference VARCHAR(100),
    intitule TEXT,
    classe VARCHAR(100),
    classe_code VARCHAR(12),
    dossier TEXT,
    type_document VARCHAR(100),
    annee INTEGER,
    date_document DATE,
    cree_le TIMESTAMPTZ,
    archive_le TIMESTAMPTZ,
    depart DATE,
    dua_annees INTEGER,
    point_depart VARCHAR(20),
    echeance DATE,
    sort_final VARCHAR(12),
    dua_reference TEXT,
    nb_fichiers INTEGER NOT NULL DEFAULT 0,
    volume_octets BIGINT NOT NULL DEFAULT 0,
    fichiers JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{version, nom, type, taille, empreinte_sha256, constat}]
    resultat VARCHAR(10) CHECK (resultat IS NULL OR resultat IN ('elimine', 'ecarte')),
    motif_ecart TEXT,
    ajoute_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    elimine_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bordereau_documents_bordereau ON bordereau_documents(bordereau_id, ordre);
CREATE INDEX IF NOT EXISTS idx_bordereau_documents_document ON bordereau_documents(document_id) WHERE document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bordereau_documents_unique ON bordereau_documents(bordereau_id, document_id) WHERE document_id IS NOT NULL;

-- Un bordereau exécuté (et ses lignes) ne se modifie plus. Passent seulement :
-- la mise à NULL d'un pointeur (compte ou document supprimé), et tout ce que
-- fait la suppression d'une organisation (drapeau docuflow.audit_override).
CREATE OR REPLACE FUNCTION bordereaux_inalterables() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  fige BOOLEAN;
BEGIN
  IF coalesce(current_setting('docuflow.audit_override', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME = 'bordereaux_elimination' THEN
    fige := OLD.statut = 'execute';
    IF fige AND TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - 'created_by' - 'propose_par' - 'valide_par' - 'rejete_par' - 'execute_par' - 'annule_par')
         = (to_jsonb(OLD) - 'created_by' - 'propose_par' - 'valide_par' - 'rejete_par' - 'execute_par' - 'annule_par') THEN
      RETURN NEW;
    END IF;
  ELSE
    SELECT b.statut = 'execute' INTO fige FROM bordereaux_elimination b WHERE b.id = OLD.bordereau_id;
    IF coalesce(fige, false) AND TG_OP = 'UPDATE' AND NEW.document_id IS NULL
       AND (to_jsonb(NEW) - 'document_id') = (to_jsonb(OLD) - 'document_id') THEN
      RETURN NEW;
    END IF;
  END IF;
  IF coalesce(fige, false) THEN
    RAISE EXCEPTION 'BORDEREAU_EXECUTE: un bordereau d''élimination exécuté ne se modifie plus (% refusé)', TG_OP
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS trg_bordereaux_inalterables ON bordereaux_elimination;
CREATE TRIGGER trg_bordereaux_inalterables BEFORE UPDATE OR DELETE ON bordereaux_elimination
  FOR EACH ROW EXECUTE FUNCTION bordereaux_inalterables();
DROP TRIGGER IF EXISTS trg_bordereau_documents_inalterables ON bordereau_documents;
CREATE TRIGGER trg_bordereau_documents_inalterables BEFORE UPDATE OR DELETE ON bordereau_documents
  FOR EACH ROW EXECUTE FUNCTION bordereaux_inalterables();

-- 4. Pierre tombale -------------------------------------------------------------
ALTER TABLE documents ADD COLUMN IF NOT EXISTS elimine_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS elimine_bordereau_id INTEGER
  REFERENCES bordereaux_elimination(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_documents_elimines ON documents(tenant_id, elimine_at) WHERE elimine_at IS NOT NULL;

CREATE OR REPLACE FUNCTION garder_pierre_tombale() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('docuflow.gel_override', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.elimine_at IS NOT NULL THEN
    IF NEW.elimine_at IS DISTINCT FROM OLD.elimine_at OR NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'DOCUMENT_ELIMINE: le document % a été éliminé, il ne se restaure pas', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.elimine_at IS NOT NULL THEN
    IF document_est_gele(OLD.id) THEN
      RAISE EXCEPTION 'GEL_JURIDIQUE: le document % est sous gel juridique', OLD.id USING ERRCODE = 'P0001';
    END IF;
    NEW.deleted_at := COALESCE(NEW.deleted_at, now());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_documents_elimination ON documents;
CREATE TRIGGER trg_documents_elimination BEFORE UPDATE OF elimine_at, deleted_at ON documents
  FOR EACH ROW EXECUTE FUNCTION garder_pierre_tombale();

-- Un document éliminé ne reçoit plus de fichier.
CREATE OR REPLACE FUNCTION refuser_fichier_elimine() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND elimine_at IS NOT NULL) THEN
    RAISE EXCEPTION 'DOCUMENT_ELIMINE: le document % a été éliminé', NEW.document_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_document_files_elimine ON document_files;
CREATE TRIGGER trg_document_files_elimine BEFORE INSERT ON document_files
  FOR EACH ROW EXECUTE FUNCTION refuser_fichier_elimine();

-- 5. Décisions de sort final --------------------------------------------------
CREATE TABLE IF NOT EXISTS decisions_sort_final (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    decision VARCHAR(12) NOT NULL CHECK (decision IN ('versement', 'conservation')),
    note TEXT,
    decide_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decide_par_nom VARCHAR(150),
    decide_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id)
);
CREATE INDEX IF NOT EXISTS idx_decisions_sort_final_tenant ON decisions_sort_final(tenant_id);
