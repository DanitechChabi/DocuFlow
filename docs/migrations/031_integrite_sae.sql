-- ============================================================================
-- 031_integrite_sae.sql — preuve et intégrité (exigences d'un SAE, NF Z42-013
-- / ISO 14641) : empreintes, contrôle d'intégrité, journal chaîné et scellé,
-- gel juridique
-- ============================================================================
--
-- 1. EMPREINTES. Chaque fichier versé reçoit son empreinte SHA-256, calculée
--    à l'ingestion (les fichiers antérieurs sont rattrapés en arrière-plan).
--    Elle sert trois fois : repérer un doublon, prouver qu'un fichier n'a pas
--    changé (contrôle d'intégrité périodique), et figurer sur le certificat.
--
-- 2. JOURNAL CHAÎNÉ. audit_logs est déjà append-only (012/014) ; il devient en
--    plus vérifiable à rebours : chaque ligne porte l'empreinte de la ligne
--    précédente de la même organisation. Retoucher, retirer ou insérer après
--    coup une ligne — même avec les droits du serveur de base — rompt la chaîne,
--    et la vérification le montre. Les lignes antérieures à cette migration ne
--    sont pas réécrites (le journal ne se modifie pas) : la chaîne commence ici.
--
--    Trois compléments :
--    - la TÊTE de chaîne (audit_chaine_tetes) retient le dernier maillon : une
--      troncature de la fin du journal, sinon invisible, devient un écart ;
--    - les PURGES ADMINISTRATIVES (drapeau docuflow.audit_override de la 014)
--      laissent une trace : chaque plage de lignes retirée garde ses empreintes
--      de bord, si bien que la chaîne reste vérifiable de bout en bout et que
--      la purge apparaît comme déclarée, non comme une falsification ;
--    - les SCEAUX (audit_sceaux) figent périodiquement la tête de chaîne. Un
--      relevé de sceaux conservé hors de DocuFlow permet de prouver qu'aucun
--      maillon antérieur n'a été réécrit, même par recalcul complet.
--
-- 3. GEL JURIDIQUE (legal hold). Un document gelé — contentieux, enquête,
--    contrôle fiscal — ne peut plus être mis à la corbeille, purgé, éliminé, ni
--    perdre une version. Le refus est posé dans le code ET en base : une requête
--    directe ne le contourne pas. Poser et lever un gel sont journalisés.
--
-- 4. PERMISSIONS du module Archives (DUA et éliminations suivent en 032) :
--    archives.view, archives.manage, archives.hold, archives.validate.
--
-- Idempotent. Retour arrière : docs/migrations/down/031_integrite_sae.down.sql
-- ============================================================================

-- 1. Empreintes et état d'intégrité des fichiers ------------------------------
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS empreinte_sha256 CHAR(64);
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS empreinte_at TIMESTAMPTZ;
-- 'versement' : calculée sur le fichier reçu ; 'rattrapage' : calculée après
-- coup sur le fichier stocké — elle prouve l'intégrité depuis cette date-là
-- seulement, et le certificat le dit.
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS empreinte_origine VARCHAR(12);
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS integrite_statut VARCHAR(12);
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS integrite_verifiee_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_files_integrite_statut_check') THEN
    ALTER TABLE document_files ADD CONSTRAINT document_files_integrite_statut_check
      CHECK (integrite_statut IS NULL OR integrite_statut IN ('intacte', 'alteree', 'introuvable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_files_empreinte_origine_check') THEN
    ALTER TABLE document_files ADD CONSTRAINT document_files_empreinte_origine_check
      CHECK (empreinte_origine IS NULL OR empreinte_origine IN ('versement', 'rattrapage'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_document_files_empreinte
  ON document_files(empreinte_sha256) WHERE empreinte_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_document_files_a_verifier
  ON document_files(integrite_verifiee_at NULLS FIRST) WHERE empreinte_sha256 IS NOT NULL;

-- 2. Journal d'audit chaîné ---------------------------------------------------
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chaine_rang BIGINT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chaine_precedent CHAR(64);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chaine_hash CHAR(64);
CREATE INDEX IF NOT EXISTS idx_audit_logs_chaine
  ON audit_logs(tenant_id, chaine_rang) WHERE chaine_hash IS NOT NULL;

-- Forme canonique d'une ligne. Trois choix :
--  - liste EXPLICITE de colonnes : une colonne ajoutée plus tard ne change pas
--    l'empreinte des lignes passées ;
--  - un tableau JSON, pas une concaténation : aucun séparateur à échapper, donc
--    aucun moyen de déplacer du texte d'un champ à l'autre à empreinte égale ;
--  - les POINTEURS id_user, actor_id et request_id sont exclus. La 014 les met
--    légitimement à NULL quand l'utilisateur ou la demande est supprimé
--    (anonymisation) ; les inclure ferait passer chaque anonymisation pour une
--    falsification. L'identité de l'acteur reste couverte par actor_username /
--    user_name, que rien ne modifie.
-- Les dates sont formatées explicitement : l'empreinte ne dépend pas du réglage
-- DateStyle de la session qui vérifie.
CREATE OR REPLACE FUNCTION audit_empreinte_ligne(l audit_logs) RETURNS CHAR(64) LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(json_build_array(
      l.chaine_precedent, l.chaine_rang, l.id, l.tenant_id,
      l.action, l.object_type, l.object_id, l.details_json, l.ip_address,
      l.actor_username, l.user_name,
      to_char(l.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      to_char(l."timestamp", 'YYYY-MM-DD"T"HH24:MI:SS.US')
    )::text, 'UTF8')), 'hex')
$$;

CREATE TABLE IF NOT EXISTS audit_chaine_tetes (
    tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    dernier_rang BIGINT NOT NULL DEFAULT 0,
    dernier_hash CHAR(64) NOT NULL DEFAULT repeat('0', 64),
    maj_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La ligne de tête sert aussi de verrou : deux insertions concurrentes d'une
-- même organisation se sérialisent sur elle (jusqu'à la fin de la transaction),
-- les organisations différentes ne s'attendent jamais.
CREATE OR REPLACE FUNCTION audit_chainer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  rang_avant BIGINT;
  hash_avant CHAR(64);
BEGIN
  INSERT INTO audit_chaine_tetes AS t (tenant_id) VALUES (NEW.tenant_id)
  ON CONFLICT (tenant_id) DO UPDATE SET maj_at = now()
  RETURNING t.dernier_rang, t.dernier_hash INTO rang_avant, hash_avant;

  NEW.chaine_rang := rang_avant + 1;
  NEW.chaine_precedent := hash_avant;
  NEW.chaine_hash := audit_empreinte_ligne(NEW);

  UPDATE audit_chaine_tetes SET dernier_rang = NEW.chaine_rang, dernier_hash = NEW.chaine_hash
   WHERE tenant_id = NEW.tenant_id;
  RETURN NEW;
END $$;

-- Le NOM compte : les triggers BEFORE d'une même table s'exécutent dans l'ordre
-- alphabétique, et celui-ci doit passer APRÈS trg_audit_sync_timestamps (012),
-- qui complète encore occurred_at, user_name… L'empreinte doit porter sur la
-- ligne telle qu'elle sera écrite.
DROP TRIGGER IF EXISTS trg_audit_zz_chainage ON audit_logs;
CREATE TRIGGER trg_audit_zz_chainage BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_chainer();

-- Purges déclarées : une ligne par plage contiguë de maillons retirés, avec
-- l'empreinte qui la précédait et celle de son dernier maillon. La vérification
-- enjambe ainsi la plage sans en connaître le contenu.
CREATE TABLE IF NOT EXISTS audit_chaine_purges (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rang_debut BIGINT NOT NULL,
    rang_fin BIGINT NOT NULL,
    precedent CHAR(64) NOT NULL,
    hash_fin CHAR(64) NOT NULL,
    nb_lignes INTEGER NOT NULL,
    purge_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_chaine_purges ON audit_chaine_purges(tenant_id, rang_debut);

CREATE OR REPLACE FUNCTION audit_noter_purge() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Îlots de rangs consécutifs : rang - row_number() est constant sur une plage.
  -- Une organisation en cours de suppression (CASCADE) n'existe déjà plus : son
  -- journal part avec elle, sans trace à conserver.
  INSERT INTO audit_chaine_purges (tenant_id, rang_debut, rang_fin, precedent, hash_fin, nb_lignes)
  SELECT s.tenant_id, min(s.chaine_rang), max(s.chaine_rang),
         (array_agg(s.chaine_precedent ORDER BY s.chaine_rang))[1],
         (array_agg(s.chaine_hash ORDER BY s.chaine_rang DESC))[1],
         count(*)
    FROM (SELECT r.tenant_id, r.chaine_rang, r.chaine_precedent, r.chaine_hash,
                 r.chaine_rang - row_number() OVER (PARTITION BY r.tenant_id ORDER BY r.chaine_rang) AS ilot
            FROM retirees r
           WHERE r.chaine_hash IS NOT NULL) s
   WHERE EXISTS (SELECT 1 FROM tenants t WHERE t.id = s.tenant_id)
   GROUP BY s.tenant_id, s.ilot;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_audit_zz_purge ON audit_logs;
CREATE TRIGGER trg_audit_zz_purge AFTER DELETE ON audit_logs
  REFERENCING OLD TABLE AS retirees
  FOR EACH STATEMENT EXECUTE FUNCTION audit_noter_purge();

-- Sceaux : la tête de chaîne figée à un instant. Pas de clé étrangère vers
-- users (le nom est recopié) : supprimer un utilisateur ne doit pas réécrire un
-- sceau, et la table est append-only comme le journal.
CREATE TABLE IF NOT EXISTS audit_sceaux (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    chaine_rang BIGINT NOT NULL,
    chaine_hash CHAR(64) NOT NULL,
    origine VARCHAR(10) NOT NULL DEFAULT 'auto' CHECK (origine IN ('auto', 'manuel')),
    scelle_par INTEGER,
    scelle_par_nom VARCHAR(150),
    scelle_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_sceaux_tenant ON audit_sceaux(tenant_id, scelle_at DESC);

CREATE OR REPLACE FUNCTION audit_sceaux_inalterables() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('docuflow.audit_override', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'audit_sceaux est append-only : % refusé', TG_OP USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_audit_sceaux_inalterables ON audit_sceaux;
CREATE TRIGGER trg_audit_sceaux_inalterables BEFORE UPDATE OR DELETE ON audit_sceaux
  FOR EACH ROW EXECUTE FUNCTION audit_sceaux_inalterables();

-- 3. Gel juridique --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_gels (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    motif TEXT NOT NULL,
    reference VARCHAR(120),                 -- n° d'affaire, de contentieux, de contrôle
    pose_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    pose_par_nom VARCHAR(150),
    pose_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    leve_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    leve_par_nom VARCHAR(150),
    leve_at TIMESTAMPTZ,
    motif_levee TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_gels_actif ON document_gels(document_id) WHERE leve_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_document_gels_tenant ON document_gels(tenant_id, leve_at);

CREATE OR REPLACE FUNCTION document_est_gele(p_document INTEGER) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM document_gels WHERE document_id = p_document AND leve_at IS NULL)
$$;

-- Garde en base : ni corbeille, ni destruction, ni retrait de version d'un
-- document gelé, quel que soit le chemin (application, script, console SQL).
-- Seule dérogation : docuflow.gel_override, posé par SET LOCAL dans la
-- suppression d'une organisation entière par le super administrateur.
CREATE OR REPLACE FUNCTION refuser_si_gele() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  doc INTEGER;
BEGIN
  IF coalesce(current_setting('docuflow.gel_override', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME = 'documents' THEN
    doc := OLD.id;
    IF TG_OP = 'UPDATE' AND NOT (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
      RETURN NEW;
    END IF;
  ELSE
    doc := OLD.document_id;
  END IF;
  IF document_est_gele(doc) THEN
    RAISE EXCEPTION 'GEL_JURIDIQUE: le document % est sous gel juridique', doc USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_documents_gel ON documents;
CREATE TRIGGER trg_documents_gel BEFORE UPDATE OF deleted_at OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION refuser_si_gele();
DROP TRIGGER IF EXISTS trg_document_files_gel ON document_files;
CREATE TRIGGER trg_document_files_gel BEFORE DELETE ON document_files
  FOR EACH ROW EXECUTE FUNCTION refuser_si_gele();

-- Une notification peut désormais pointer un document (fichier altéré, gel
-- posé…) : l'interface ouvre la fiche au clic.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE;

-- 4. Permissions du module Archives -------------------------------------------
UPDATE roles SET permissions = array_append(permissions, 'archives.view')
 WHERE is_system AND key IN ('admin', 'archiviste', 'responsable')
   AND NOT ('archives.view' = ANY (permissions)) AND NOT ('*' = ANY (permissions));
UPDATE roles SET permissions = array_append(permissions, 'archives.manage')
 WHERE is_system AND key IN ('admin', 'archiviste')
   AND NOT ('archives.manage' = ANY (permissions)) AND NOT ('*' = ANY (permissions));
UPDATE roles SET permissions = array_append(permissions, 'archives.hold')
 WHERE is_system AND key IN ('admin', 'archiviste')
   AND NOT ('archives.hold' = ANY (permissions)) AND NOT ('*' = ANY (permissions));
UPDATE roles SET permissions = array_append(permissions, 'archives.validate')
 WHERE is_system AND key IN ('admin', 'responsable')
   AND NOT ('archives.validate' = ANY (permissions)) AND NOT ('*' = ANY (permissions));
