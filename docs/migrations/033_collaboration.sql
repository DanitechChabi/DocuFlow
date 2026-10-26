-- ============================================================================
-- 033_collaboration.sql — collaboration documentaire : favoris, suivi des
-- documents (abonnements), commentaires avec mentions, liens de partage publics
-- ============================================================================
--
-- Ce que proposent Alfresco (favoris, « follow », commentaires, « quick
-- share ») et M-Files (favoris, notifications, commentaires, « share public
-- link »), et que la GED n'offrait pas : travailler À PLUSIEURS autour d'un
-- document sans sortir de DocuFlow.
--
-- 1. FAVORIS (document_favoris). Marque-page personnel : une étoile sur la fiche
--    et dans la liste, une page « Mes favoris ». Préférence d'interface, pas un
--    acte documentaire : rien au journal d'audit. Le favori n'ouvre aucun droit —
--    un document sorti du périmètre (ACL) de l'utilisateur disparaît de sa liste
--    sans que la ligne soit supprimée (il réapparaît si l'accès revient).
--
-- 2. SUIVI (document_abonnements). Suivre un document, c'est être notifié
--    (table notifications, colonne document_id de la 031 : la cloche ouvre la
--    fiche) quand : une version est ajoutée, le statut change, la fiche ou les
--    métadonnées sont modifiées, un commentaire est posté, un gel juridique est
--    posé ou levé, une version est restaurée. L'auteur du geste n'est jamais
--    notifié de son propre geste.
--    SUIVI AUTOMATIQUE : le créateur d'un document (trigger ci-dessous, quel que
--    soit le chemin de création : versement, masse, demande, assemblage) et
--    quiconque le commente le suivent d'office. Un « Ne plus suivre » explicite
--    est MÉMORISÉ (suivi = false) et jamais annulé par l'automatisme : commenter
--    à nouveau ne réabonne pas qui s'est désabonné. Seul un « Suivre » explicite
--    rétablit le suivi.
--    Les destinataires sont filtrés AU MOMENT DE L'ENVOI : permission
--    documents.view et lecture du dossier (ACL). Un abonné qui a perdu l'accès
--    ne reçoit plus rien — la notification révélerait le document.
--    Les documents existants ne reçoivent pas d'abonnements rétroactifs : le
--    suivi automatique vaut pour les documents créés à partir d'ici.
--
-- 3. COMMENTAIRES (document_commentaires). Fil plat, réponses sur UN niveau.
--    Mentions « @identifiant » : la personne mentionnée est notifiée même si
--    elle ne suit pas le document — à condition de pouvoir le lire (on ne
--    mentionne pas quelqu'un hors du périmètre : il recevrait le titre d'un
--    document qu'il ne peut pas ouvrir). Lire et écrire des commentaires
--    relèvent de documents.view (commenter est un acte de collaboration, pas
--    une modification du document) : y compris sur un document archivé, verrouillé
--    ou gelé, qui restent intouchés. Seul l'AUTEUR modifie ou supprime son
--    commentaire. La suppression laisse une pierre tombale (« Commentaire
--    supprimé », auteur et date conservés, les réponses gardent leur contexte)
--    mais EFFACE le contenu : un commentaire peut être personnel, son auteur doit
--    pouvoir le retirer. Pour la même raison, le journal d'audit trace les
--    gestes (COMMENTAIRE_AJOUTE / _MODIFIE / _SUPPRIME) sans jamais le texte,
--    et les notifications ne citent pas le commentaire.
--
-- 4. LIENS DE PARTAGE PUBLICS (document_partages). Un lien /partage/<jeton>
--    donne à un tiers sans compte l'accès à UN fichier du document :
--    - jeton de 256 bits aléatoires, montré UNE fois à la création ; seule son
--      empreinte SHA-256 est en base — une fuite de la base ne livre aucun lien
--      utilisable ;
--    - expiration obligatoire (réglage partage_duree_jours, 90 jours au plus),
--      mot de passe facultatif (bcrypt), nombre maximal de téléchargements
--      facultatif, version courante OU version figée, révocation ;
--    - compteurs de consultations et de téléchargements, dernier accès ;
--    - chaque accès public, chaque création et révocation est inscrit au
--      journal chaîné (PARTAGE_CONSULTE, PARTAGE_CREE, PARTAGE_REVOQUE) ;
--    - interrupteur d'organisation partage_public_actif : désactivé, plus aucun
--      lien ne se crée NI ne s'ouvre ;
--    - un document en corbeille (ou éliminé) n'est plus servi.
--    Créer un lien exige documents.share et la lecture du document.
--
-- 5. RESTAURATION DE VERSION : aucune colonne nouvelle. La version restaurée
--    devient une NOUVELLE version, copie exacte (empreinte identique, texte
--    indexé repris) ; les versions intermédiaires sont conservées.
--
-- Aucune permission nouvelle : documents.view, documents.share,
-- documents.manage_versions. Les clés vers users suivent la 014 : CASCADE pour
-- ce qui n'a pas d'existence propre (favori, abonnement), SET NULL pour ce qui
-- doit survivre à son auteur (commentaire, lien), le nom étant recopié.
--
-- Idempotent. Retour arrière : docs/migrations/down/033_collaboration.down.sql
-- ============================================================================

-- 1. Favoris ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_favoris (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_document_favoris_liste ON document_favoris(tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_favoris_document ON document_favoris(document_id);

-- 2. Suivi (abonnements) ----------------------------------------------------
-- suivi = false : désabonnement explicite, mémorisé (voir l'en-tête).
CREATE TABLE IF NOT EXISTS document_abonnements (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    suivi BOOLEAN NOT NULL DEFAULT true,
    origine VARCHAR(12) NOT NULL DEFAULT 'manuel',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    maj_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, document_id)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_abonnements_origine_check') THEN
    ALTER TABLE document_abonnements ADD CONSTRAINT document_abonnements_origine_check
      CHECK (origine IN ('manuel', 'createur', 'commentaire'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_document_abonnements_document ON document_abonnements(document_id) WHERE suivi;
CREATE INDEX IF NOT EXISTS idx_document_abonnements_liste ON document_abonnements(tenant_id, user_id, maj_at DESC) WHERE suivi;

-- Le créateur suit son document, quel que soit le chemin de création. Un échec
-- ici ne doit JAMAIS refuser le versement : l'abonnement est un confort.
CREATE OR REPLACE FUNCTION document_abonner_createur() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO document_abonnements (tenant_id, user_id, document_id, origine)
    SELECT NEW.tenant_id, NEW.created_by, NEW.id, 'createur'
     WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.created_by AND u.tenant_id = NEW.tenant_id)
    ON CONFLICT (user_id, document_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'abonnement du créateur non enregistré (document %) : %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_documents_abonnement_createur ON documents;
CREATE TRIGGER trg_documents_abonnement_createur AFTER INSERT ON documents
  FOR EACH ROW WHEN (NEW.created_by IS NOT NULL) EXECUTE FUNCTION document_abonner_createur();

-- 3. Commentaires -------------------------------------------------------------
-- contenu NULL ⇔ commentaire supprimé (pierre tombale). mentions : identifiants
-- des personnes mentionnées ET autorisées, au moment de l'écriture.
CREATE TABLE IF NOT EXISTS document_commentaires (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES document_commentaires(id) ON DELETE CASCADE,
    auteur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    auteur_nom VARCHAR(150),
    contenu TEXT,
    mentions INTEGER[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_at TIMESTAMPTZ,
    supprime_at TIMESTAMPTZ
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_commentaires_contenu_check') THEN
    ALTER TABLE document_commentaires ADD CONSTRAINT document_commentaires_contenu_check CHECK (
      (supprime_at IS NULL AND contenu IS NOT NULL AND length(contenu) BETWEEN 1 AND 5000)
      OR (supprime_at IS NOT NULL AND contenu IS NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_document_commentaires_document ON document_commentaires(document_id, created_at);
CREATE INDEX IF NOT EXISTS idx_document_commentaires_parent ON document_commentaires(parent_id) WHERE parent_id IS NOT NULL;

-- 4. Liens de partage publics -------------------------------------------------
-- version_mode 'fixe' + fichier_id NULL : la version partagée a été retirée,
-- le lien est mort (jamais redirigé en silence vers un autre contenu).
CREATE TABLE IF NOT EXISTS document_partages (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_mode VARCHAR(8) NOT NULL DEFAULT 'courante',
    fichier_id INTEGER REFERENCES document_files(id) ON DELETE SET NULL,
    version_numero INTEGER,
    jeton_hash CHAR(64) NOT NULL,
    libelle VARCHAR(120),
    mot_de_passe_hash VARCHAR(100),
    expire_at TIMESTAMPTZ NOT NULL,
    max_telechargements INTEGER,
    nb_telechargements INTEGER NOT NULL DEFAULT 0,
    nb_consultations INTEGER NOT NULL DEFAULT 0,
    dernier_acces_at TIMESTAMPTZ,
    cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    cree_par_nom VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoque_at TIMESTAMPTZ,
    revoque_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    revoque_par_nom VARCHAR(150)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_partages_version_mode_check') THEN
    ALTER TABLE document_partages ADD CONSTRAINT document_partages_version_mode_check
      CHECK (version_mode IN ('courante', 'fixe'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_partages_max_check') THEN
    ALTER TABLE document_partages ADD CONSTRAINT document_partages_max_check
      CHECK (max_telechargements IS NULL OR max_telechargements BETWEEN 1 AND 1000);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_partages_jeton ON document_partages(jeton_hash);
CREATE INDEX IF NOT EXISTS idx_document_partages_document ON document_partages(document_id, created_at DESC);

-- Les notifications liées à un document se multiplient avec le suivi : la
-- suppression d'un document (CASCADE) ne doit pas parcourir toute la table.
CREATE INDEX IF NOT EXISTS idx_notifications_document ON notifications(document_id) WHERE document_id IS NOT NULL;
