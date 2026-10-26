-- ============================================================================
-- 034_circuits_validation.sql — circuits de validation (workflows M-Files /
-- processus Alfresco), « Mes tâches » et visa électronique
-- ============================================================================
--
-- 1. MODÈLES DE CIRCUIT (circuit_modeles, circuit_etapes). Un circuit est une
--    suite ORDONNÉE d'étapes (séquentielles : la suivante s'ouvre quand la
--    précédente est close). Chaque étape désigne ses destinataires — un
--    utilisateur, un rôle (users.role) ou un groupe —, une action (« visa » :
--    approuver ou refuser ; « information » : prendre connaissance), un délai
--    en jours (échéance des tâches) et une règle à plusieurs destinataires
--    (« un » : la première réponse vaut pour l'étape ; « tous » : chacun doit
--    approuver). Un circuit peut se rattacher à une CLASSE de documents ; un
--    seul circuit par défaut par classe, éventuellement démarré
--    automatiquement à la création ou à l'indexation d'un document de la
--    classe (comme le « workflow par défaut » d'une classe M-Files).
--
-- 2. INSTANCES (circuit_instances). Un circuit lancé sur un document. Les
--    étapes y sont RECOPIÉES au démarrage (colonne etapes) : modifier ou
--    supprimer le modèle ensuite ne change pas un circuit en cours, et
--    l'historique d'un document dit ce qui a été demandé à l'époque. Une seule
--    instance en cours par document (index unique partiel — la base arbitre
--    deux démarrages simultanés).
--
-- 3. TÂCHES (circuit_taches). Une par destinataire de l'étape en cours. Une
--    tâche déléguée ou réassignée est close et remplacée par une nouvelle
--    (origine_tache_id) : la chaîne reste lisible.
--
-- 4. VISAS (circuit_visas). Chaque décision — approbation, refus, prise de
--    connaissance — laisse un visa : qui (nom recopié), quand, quelle étape,
--    quel commentaire, depuis quelle adresse, et SURTOUT sur quoi : l'empreinte
--    SHA-256 de la version courante du fichier (031) et son numéro. Le visa
--    prouve QUEL contenu exact a été approuvé ; une version déposée ensuite ne
--    le porte pas. Son contenu est figé dans empreinte_visa, elle-même inscrite
--    au journal chaîné (VISA_APPROUVE / VISA_REFUSE / VISA_VU).
--    La table est APPEND-ONLY : ni modification ni suppression, sauf
--      - les pointeurs (signataire, tâche, fichier) remis à NULL par les clés
--        étrangères (suppression d'un compte : règles de la 014) ;
--      - la disparition du document, de l'instance ou de l'organisation
--        (purge, cascade) ;
--      - le drapeau docuflow.audit_override de la 014 (administration).
--
-- 5. PERMISSIONS du module Circuits : workflows.manage (configurer, réassigner,
--    annuler tout circuit — admin, archiviste) et workflows.start (lancer un
--    circuit, annuler celui qu'on a lancé — admin, archiviste, responsable,
--    agent). Viser n'exige aucune permission : il faut être destinataire.
--
-- Idempotent. Retour arrière : docs/migrations/down/034_circuits_validation.down.sql
-- ============================================================================

-- 1. Modèles ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circuit_modeles (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nom VARCHAR(150) NOT NULL,
    description TEXT,
    -- Pas de CHECK liant par_defaut / demarrage_auto à classe_id : la
    -- suppression d'une classe (SET NULL) échouerait. Le service le garantit.
    classe_id INTEGER REFERENCES metadata_schemas(id) ON DELETE SET NULL,
    par_defaut BOOLEAN NOT NULL DEFAULT false,
    demarrage_auto BOOLEAN NOT NULL DEFAULT false,
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    cree_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, nom)
);
-- Un seul circuit par défaut par classe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_circuit_modeles_defaut
  ON circuit_modeles(tenant_id, classe_id) WHERE par_defaut AND classe_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS circuit_etapes (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    circuit_id INTEGER NOT NULL REFERENCES circuit_modeles(id) ON DELETE CASCADE,
    rang SMALLINT NOT NULL CHECK (rang BETWEEN 1 AND 50),
    libelle VARCHAR(150) NOT NULL,
    type_assignation VARCHAR(12) NOT NULL CHECK (type_assignation IN ('utilisateur', 'role', 'groupe')),
    -- Un destinataire disparu (compte, groupe supprimés) laisse l'étape sans
    -- destinataire : le démarrage le refuse, une étape déjà ouverte se replie
    -- sur les gestionnaires des circuits.
    assigne_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigne_role VARCHAR(50),
    assigne_groupe_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    action VARCHAR(12) NOT NULL DEFAULT 'visa' CHECK (action IN ('visa', 'information')),
    delai_jours SMALLINT CHECK (delai_jours IS NULL OR delai_jours BETWEEN 0 AND 365),
    regle VARCHAR(4) NOT NULL DEFAULT 'un' CHECK (regle IN ('un', 'tous')),
    UNIQUE (circuit_id, rang)
);
CREATE INDEX IF NOT EXISTS idx_circuit_etapes_circuit ON circuit_etapes(circuit_id, rang);

-- 2. Instances ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circuit_instances (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    circuit_id INTEGER REFERENCES circuit_modeles(id) ON DELETE SET NULL,
    circuit_nom VARCHAR(150) NOT NULL,
    etapes JSONB NOT NULL,                       -- copie des étapes au démarrage
    etape_courante SMALLINT,                     -- rang en cours (ou atteint en fin)
    statut VARCHAR(12) NOT NULL DEFAULT 'en cours'
      CHECK (statut IN ('en cours', 'approuvé', 'refusé', 'annulé')),
    demarrage VARCHAR(12) NOT NULL DEFAULT 'manuel'
      CHECK (demarrage IN ('manuel', 'automatique', 'relance')),
    demarre_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    demarre_par_nom VARCHAR(150),
    demarre_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version_depart INTEGER,                      -- version du fichier au démarrage
    empreinte_depart CHAR(64),
    statut_document_avant VARCHAR(20),
    termine_at TIMESTAMPTZ,
    termine_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    termine_par_nom VARCHAR(150),
    motif_fin TEXT,                              -- motif du refus ou de l'annulation
    relance_de INTEGER REFERENCES circuit_instances(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_circuit_instances_active
  ON circuit_instances(document_id) WHERE statut = 'en cours';
CREATE INDEX IF NOT EXISTS idx_circuit_instances_document
  ON circuit_instances(tenant_id, document_id, demarre_at DESC);
CREATE INDEX IF NOT EXISTS idx_circuit_instances_circuit ON circuit_instances(circuit_id);

-- 3. Tâches -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circuit_taches (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    instance_id INTEGER NOT NULL REFERENCES circuit_instances(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    etape_rang SMALLINT NOT NULL,
    action VARCHAR(12) NOT NULL CHECK (action IN ('visa', 'information')),
    assigne_a INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigne_nom VARCHAR(150),
    statut VARCHAR(12) NOT NULL DEFAULT 'à traiter'
      CHECK (statut IN ('à traiter', 'approuvée', 'refusée', 'vue', 'déléguée', 'réassignée', 'close')),
    secours BOOLEAN NOT NULL DEFAULT false,      -- confiée aux gestionnaires faute de destinataire
    pour_le_compte_de VARCHAR(150),              -- délégation : au nom de qui
    cree_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    echeance_at TIMESTAMPTZ,
    traite_at TIMESTAMPTZ,
    traite_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    traite_par_nom VARCHAR(150),
    commentaire TEXT,
    origine_tache_id INTEGER REFERENCES circuit_taches(id) ON DELETE SET NULL,
    relance_at TIMESTAMPTZ,                      -- dernier rappel de retard
    nb_relances INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_circuit_taches_a_traiter
  ON circuit_taches(tenant_id, assigne_a) WHERE statut = 'à traiter';
CREATE INDEX IF NOT EXISTS idx_circuit_taches_instance ON circuit_taches(instance_id, etape_rang);
CREATE INDEX IF NOT EXISTS idx_circuit_taches_echeance
  ON circuit_taches(echeance_at) WHERE statut = 'à traiter' AND echeance_at IS NOT NULL;
-- Un destinataire n'a qu'une tâche ouverte par étape d'une instance.
CREATE UNIQUE INDEX IF NOT EXISTS idx_circuit_taches_ouverte
  ON circuit_taches(instance_id, etape_rang, assigne_a) WHERE statut = 'à traiter';

-- 4. Visas --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circuit_visas (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    instance_id INTEGER NOT NULL REFERENCES circuit_instances(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tache_id INTEGER REFERENCES circuit_taches(id) ON DELETE SET NULL,
    etape_rang SMALLINT NOT NULL,
    etape_libelle VARCHAR(150) NOT NULL,
    decision VARCHAR(10) NOT NULL CHECK (decision IN ('approuvé', 'refusé', 'vu')),
    signataire_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    signataire_nom VARCHAR(150) NOT NULL,
    signataire_username VARCHAR(50),
    pour_le_compte_de VARCHAR(150),
    commentaire TEXT,
    ip_address VARCHAR(64),
    fichier_id INTEGER REFERENCES document_files(id) ON DELETE SET NULL,
    document_version INTEGER,
    empreinte_sha256 CHAR(64),                   -- empreinte de la version visée
    empreinte_visa CHAR(64) NOT NULL,            -- empreinte du visa lui-même
    signe_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_circuit_visas_instance ON circuit_visas(instance_id, etape_rang);
CREATE INDEX IF NOT EXISTS idx_circuit_visas_document ON circuit_visas(tenant_id, document_id);

CREATE OR REPLACE FUNCTION circuit_visas_inalterables() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('docuflow.audit_override', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Seuls les pointeurs peuvent passer à NULL (clés étrangères SET NULL).
    IF ROW(NEW.id, NEW.tenant_id, NEW.instance_id, NEW.document_id, NEW.etape_rang, NEW.etape_libelle,
           NEW.decision, NEW.signataire_nom, NEW.signataire_username, NEW.pour_le_compte_de, NEW.commentaire,
           NEW.ip_address, NEW.document_version, NEW.empreinte_sha256, NEW.empreinte_visa, NEW.signe_at)
       IS NOT DISTINCT FROM
       ROW(OLD.id, OLD.tenant_id, OLD.instance_id, OLD.document_id, OLD.etape_rang, OLD.etape_libelle,
           OLD.decision, OLD.signataire_nom, OLD.signataire_username, OLD.pour_le_compte_de, OLD.commentaire,
           OLD.ip_address, OLD.document_version, OLD.empreinte_sha256, OLD.empreinte_visa, OLD.signe_at)
       AND (NEW.signataire_id IS NULL OR NEW.signataire_id IS NOT DISTINCT FROM OLD.signataire_id)
       AND (NEW.tache_id IS NULL OR NEW.tache_id IS NOT DISTINCT FROM OLD.tache_id)
       AND (NEW.fichier_id IS NULL OR NEW.fichier_id IS NOT DISTINCT FROM OLD.fichier_id) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'circuit_visas est append-only : un visa ne se modifie pas' USING ERRCODE = 'check_violation';
  END IF;
  -- Suppression : seulement quand le document, l'instance ou l'organisation
  -- a déjà disparu (purge du document, suppression de l'organisation).
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = OLD.document_id)
     OR NOT EXISTS (SELECT 1 FROM circuit_instances WHERE id = OLD.instance_id)
     OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'circuit_visas est append-only : un visa ne se supprime pas' USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_circuit_visas_inalterables ON circuit_visas;
CREATE TRIGGER trg_circuit_visas_inalterables BEFORE UPDATE OR DELETE ON circuit_visas
  FOR EACH ROW EXECUTE FUNCTION circuit_visas_inalterables();

-- 5. Permissions du module Circuits -------------------------------------------
UPDATE roles SET permissions = array_append(permissions, 'workflows.manage')
 WHERE is_system AND key IN ('admin', 'archiviste')
   AND NOT ('workflows.manage' = ANY (permissions)) AND NOT ('*' = ANY (permissions));
UPDATE roles SET permissions = array_append(permissions, 'workflows.start')
 WHERE is_system AND key IN ('admin', 'archiviste', 'responsable', 'agent')
   AND NOT ('workflows.start' = ANY (permissions)) AND NOT ('*' = ANY (permissions));
