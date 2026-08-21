-- ============================================================================
-- 014_admin_deletion_rules.sql — Rendre les suppressions administratives possibles
-- ============================================================================
-- CONSTAT (vérifié sur la base de production Neon le 19/08/2026)
--
-- Le superadministrateur de la plateforme ne pouvait plus supprimer un
-- utilisateur. Deux verrous se cumulaient :
--
--   1. Treize clés étrangères pointent vers `users(id)` SANS clause ON DELETE,
--      donc en NO ACTION : `audit_logs.id_user`, `requests.id_user`,
--      `requests.assignee_id`, `messages.sender_id`, `messages.receiver_id`,
--      `notifications.id_user`, `request_files.uploaded_by`,
--      `request_history.user_id`, `documents.created_by`,
--      `document_files.uploaded_by`, `document_folders.created_by`,
--      `document_history.user_id`, `document_relations.created_by`.
--      Or `auditMiddleware` écrit une ligne dans `audit_logs` à CHAQUE écriture
--      HTTP : dès qu'un utilisateur a fait quoi que ce soit, il devient
--      définitivement indestructible (erreur 23503, renvoyée au frontend en 500
--      « Erreur lors de la suppression de l'utilisateur »). D'où l'impression
--      d'une régression : la suppression ne marchait que sur des comptes
--      n'ayant jamais rien fait.
--
--   2. Le trigger append-only `trg_audit_no_update` (migration 012) intercepte
--      BEFORE UPDATE OR DELETE sur `audit_logs`. Il neutralisait donc même la
--      seule clé correctement déclarée, `audit_logs.actor_id ON DELETE SET
--      NULL` : passer une colonne à NULL est un UPDATE. La suppression était
--      bloquée deux fois.
--
-- Le même NO ACTION sur les dix colonnes `tenant_id` empêchait la suppression
-- d'une entreprise, et le trigger interdisait toute purge du journal d'audit.
--
-- CE QUE FAIT CETTE MIGRATION
--
--   §1 Clés vers `users(id)` : SET NULL pour les colonnes d'attribution
--      (l'événement est conservé, seul son auteur est anonymisé), CASCADE pour
--      les lignes qui n'ont pas d'existence propre (notifications).
--   §2 Clés vers `tenants(id)` : CASCADE. Ces colonnes sont NOT NULL, SET NULL
--      est donc impossible ; supprimer une entreprise doit emporter ses données.
--   §3 Clés inter-tables qui bloquaient la cascade d'entreprise.
--   §4 Trigger append-only réécrit : l'inaltérabilité est conservée, avec deux
--      dérogations précises et motivées (voir §4).
--
-- Idempotente et non destructive : aucune donnée n'est supprimée ici. Elle ne
-- change que des règles de suppression. Réexécutable sans effet de bord.
--
-- PAS DE BEGIN/COMMIT DANS CE FICHIER — et c'est délibéré.
-- Cette migration en portait un. Or elle est destinée à être jouée par un
-- exécuteur (migrate.js, un client psql, une épreuve automatisée) qui peut
-- lui-même avoir ouvert une transaction. Dans ce cas, le COMMIT final ne
-- refermait pas « son » BEGIN mais celui de l'appelant : la transaction
-- englobante se trouvait validée à mi-parcours, et tout ce qui suivait
-- s'exécutait hors transaction — y compris ce qu'un ROLLBACK était censé
-- annuler. Une épreuve censée ne rien laisser derrière elle écrivait donc pour
-- de bon. PostgreSQL n'imbrique pas les transactions ; seuls les SAVEPOINT le
-- font, et un fichier SQL ne peut pas savoir s'il est appelé seul ou non.
-- La règle est donc : le fichier décrit le CHANGEMENT, l'appelant décide de la
-- transaction. Jouée seule, cette migration reste correcte — psql valide alors
-- chaque instruction, et elle est de toute façon idempotente.
--
-- Prérequis : docs/setup_db.sql puis 010, 011, 012.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper : réécrit la règle ON DELETE d'une clé étrangère à colonne unique.
--
-- Il DÉCOUVRE les contraintes existantes sur (table, colonne) → parent au lieu
-- de les nommer, pour deux raisons : les noms diffèrent selon la migration qui
-- les a posées, et `requests.id_user` porte DEUX clés étrangères identiques
-- (`requests_id_user_fkey` posée par la déclaration inline et `fk_user` par la
-- contrainte nommée, toutes deux dans setup_db.sql). Les nommer une par une
-- laisserait le doublon en place, et le doublon suffit à rebloquer la
-- suppression. Découvrir puis tout remplacer par une seule contrainte
-- canonique règle les deux problèmes d'un coup.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION docuflow_set_fk_rule(
    p_child TEXT, p_col TEXT, p_parent TEXT, p_rule TEXT
) RETURNS void AS $$
DECLARE
    existing RECORD;
    canonical TEXT;
BEGIN
    -- Table ou colonne absente : la base n'a pas cette fonctionnalité, on passe.
    IF to_regclass(p_child) IS NULL OR to_regclass(p_parent) IS NULL THEN
        RAISE NOTICE '014: table absente (%  ou %), ignorée', p_child, p_parent;
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = p_child AND column_name = p_col) THEN
        RAISE NOTICE '014: colonne %.% absente, ignorée', p_child, p_col;
        RETURN;
    END IF;

    FOR existing IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f'
          AND c.conrelid = to_regclass(p_child)
          AND c.confrelid = to_regclass(p_parent)
          AND a.attname = p_col
          AND array_length(c.conkey, 1) = 1
    LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_child, existing.conname);
    END LOOP;

    canonical := format('%s_%s_fkey', p_child, p_col);
    EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE %s',
        p_child, canonical, p_col, p_parent, p_rule
    );
END $$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- §1. Clés vers users(id)
--
-- SET NULL, et non CASCADE, pour tout ce qui relève de l'ATTRIBUTION : la
-- demande, le document ou la ligne de journal doivent survivre au départ de
-- leur auteur. Supprimer un employé ne doit pas effacer l'activité de son
-- entreprise. Toutes ces colonnes ont été vérifiées nullables en production.
--
-- Les colonnes dénormalisées `audit_logs.user_name` / `actor_username`
-- conservent le nom en clair : l'imputabilité de l'événement survit à
-- l'anonymisation du pointeur (droit à l'effacement RGPD d'un côté,
-- inaltérabilité du journal de l'autre).
-- ----------------------------------------------------------------------------
SELECT docuflow_set_fk_rule('audit_logs',         'id_user',        'users', 'SET NULL');
SELECT docuflow_set_fk_rule('audit_logs',         'actor_id',       'users', 'SET NULL');
SELECT docuflow_set_fk_rule('requests',           'id_user',        'users', 'SET NULL');
SELECT docuflow_set_fk_rule('requests',           'assignee_id',    'users', 'SET NULL');
SELECT docuflow_set_fk_rule('request_files',      'uploaded_by',    'users', 'SET NULL');
SELECT docuflow_set_fk_rule('request_history',    'user_id',        'users', 'SET NULL');
SELECT docuflow_set_fk_rule('messages',           'sender_id',      'users', 'SET NULL');
SELECT docuflow_set_fk_rule('messages',           'receiver_id',    'users', 'SET NULL');
SELECT docuflow_set_fk_rule('documents',          'created_by',     'users', 'SET NULL');
SELECT docuflow_set_fk_rule('documents',          'checked_out_by', 'users', 'SET NULL');
SELECT docuflow_set_fk_rule('document_files',     'uploaded_by',    'users', 'SET NULL');
SELECT docuflow_set_fk_rule('document_folders',   'created_by',     'users', 'SET NULL');
SELECT docuflow_set_fk_rule('document_history',   'user_id',        'users', 'SET NULL');
SELECT docuflow_set_fk_rule('document_relations', 'created_by',     'users', 'SET NULL');
SELECT docuflow_set_fk_rule('dynamic_views',      'created_by',     'users', 'SET NULL');

-- CASCADE : une notification n'a pas d'existence propre, elle appartient à son
-- destinataire. Anonymisée, elle deviendrait une ligne que personne ne peut
-- plus lire ni supprimer.
SELECT docuflow_set_fk_rule('notifications', 'id_user', 'users', 'CASCADE');

-- ----------------------------------------------------------------------------
-- §2. Clés vers tenants(id) — CASCADE
--
-- Ces colonnes sont NOT NULL : SET NULL est structurellement impossible. Six
-- tables (migrations 010/011) étaient déjà en CASCADE, dix restaient en NO
-- ACTION — l'incohérence expliquait pourquoi `tenantController.deleteTenant`
-- échouait malgré son commentaire « les contraintes FK gèrent ».
-- ----------------------------------------------------------------------------
SELECT docuflow_set_fk_rule('users',            'tenant_id', 'tenants', 'CASCADE');
SELECT docuflow_set_fk_rule('requests',         'tenant_id', 'tenants', 'CASCADE');
SELECT docuflow_set_fk_rule('request_history',  'tenant_id', 'tenants', 'CASCADE');
SELECT docuflow_set_fk_rule('messages',         'tenant_id', 'tenants', 'CASCADE');
SELECT docuflow_set_fk_rule('notifications',    'tenant_id', 'tenants', 'CASCADE');
SELECT docuflow_set_fk_rule('documents',        'tenant_id', 'tenants', 'CASCADE');
SELECT docuflow_set_fk_rule('document_folders', 'tenant_id', 'tenants', 'CASCADE');
SELECT docuflow_set_fk_rule('sections',         'tenant_id', 'tenants', 'CASCADE');
SELECT docuflow_set_fk_rule('settings',         'tenant_id', 'tenants', 'CASCADE');
SELECT docuflow_set_fk_rule('audit_logs',       'tenant_id', 'tenants', 'CASCADE');

-- ----------------------------------------------------------------------------
-- §3. Clés inter-tables qui bloquaient la cascade
--
-- Supprimer une entreprise supprime ses demandes (§2) ; ces trois clés vers
-- `requests` étaient en NO ACTION et auraient arrêté la cascade en chemin.
-- ----------------------------------------------------------------------------
-- Le journal garde la trace de l'événement, sans plus pointer vers la demande
-- disparue : `action` en nomme déjà l'objet en clair.
SELECT docuflow_set_fk_rule('audit_logs', 'request_id', 'requests', 'SET NULL');

-- L'historique et les notifications d'une demande n'ont pas de sens sans elle.
SELECT docuflow_set_fk_rule('request_history', 'request_id', 'requests', 'CASCADE');
SELECT docuflow_set_fk_rule('notifications',   'request_id', 'requests', 'CASCADE');

-- Une demande archivée en document doit survivre à la suppression de celui-ci.
SELECT docuflow_set_fk_rule('requests', 'document_id', 'documents', 'SET NULL');

DROP FUNCTION docuflow_set_fk_rule(TEXT, TEXT, TEXT, TEXT);

-- ----------------------------------------------------------------------------
-- §4. Journal d'audit : inaltérabilité conservée, deux dérogations motivées
--
-- Le trigger de la migration 012 refusait tout UPDATE et tout DELETE, sans
-- exception. Conforme sur le principe (GoBD, NF Z42-013), mais il rendait le
-- journal plus rigide que la loi ne l'exige : il empêchait aussi l'effacement
-- d'un compte (RGPD art. 17) et la clôture d'un client qui résilie.
--
-- Deux dérogations, et seulement deux :
--
--   (a) ANONYMISATION PAR CLÉ ÉTRANGÈRE — un UPDATE qui ne fait que passer
--       `id_user`, `actor_id` ou `request_id` à NULL est accepté. Le contenu
--       probant de la ligne (action, date, IP, nom de l'acteur, détails) reste
--       intact : on détache un pointeur, on ne réécrit pas l'événement.
--       Autorisée sans condition, car c'est le mécanisme même du SET NULL du §1.
--
--   (b) PURGE ADMINISTRATIVE EXPLICITE — tout le reste (UPDATE de contenu,
--       DELETE) exige le drapeau de session `docuflow.audit_override = 'on'`.
--       `SET LOCAL` le limite à la transaction en cours : il ne peut pas fuir
--       d'une requête à l'autre à travers le pool de connexions, et aucun code
--       ne l'obtient par accident. Il faut le poser délibérément.
--
-- L'inaltérabilité vaut donc toujours contre ce qu'un journal d'audit doit
-- empêcher : la retouche discrète, l'erreur de code, l'injection SQL. Ce
-- qu'elle n'empêche plus, c'est l'acte administratif assumé et lui-même
-- journalisé.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
DECLARE
    before  audit_logs;
    probe   audit_logs;
BEGIN
    -- (b) Dérogation explicite : purge administrative.
    IF coalesce(current_setting('docuflow.audit_override', true), '') = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    -- (a) Anonymisation par clé étrangère.
    --
    -- On reconstruit NEW en y remettant les trois pointeurs d'origine : si le
    -- résultat est identique à OLD, alors l'UPDATE ne touchait QUE ces
    -- pointeurs. La comparaison porte sur la ligne entière plutôt que sur une
    -- liste de colonnes : une colonne ajoutée plus tard sera automatiquement
    -- protégée, alors qu'une liste explicite qu'on aurait oublié de compléter
    -- l'aurait laissée modifiable en silence. Le contrôle échoue fermé.
    IF TG_OP = 'UPDATE' THEN
        before := OLD;
        probe  := NEW;
        probe.id_user    := before.id_user;
        probe.actor_id   := before.actor_id;
        probe.request_id := before.request_id;

        IF probe IS NOT DISTINCT FROM before
           AND (NEW.id_user    IS NULL OR NEW.id_user    IS NOT DISTINCT FROM before.id_user)
           AND (NEW.actor_id   IS NULL OR NEW.actor_id   IS NOT DISTINCT FROM before.actor_id)
           AND (NEW.request_id IS NULL OR NEW.request_id IS NOT DISTINCT FROM before.request_id)
        THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION
        'audit_logs est append-only : % refusé sur la ligne %. Une purge administrative doit poser SET LOCAL docuflow.audit_override = ''on'' dans sa transaction.',
        TG_OP, OLD.id
        USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_logs;
CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- ============================================================================
-- VÉRIFICATION (après application)
-- ============================================================================
-- Plus aucune ligne ne doit ressortir en NO ACTION ('a') :
--   SELECT conrelid::regclass::text, conname, confdeltype
--   FROM pg_constraint WHERE contype = 'f' AND confdeltype = 'a';
--
-- Le trigger doit toujours être en place :
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal;
-- ============================================================================
-- ROLLBACK (retour à l'état antérieur, à exécuter manuellement)
-- ============================================================================
-- Les règles ON DELETE d'origine étaient NO ACTION ; pour revenir en arrière
-- sur une colonne : ALTER TABLE x DROP CONSTRAINT x_col_fkey, puis
-- ALTER TABLE x ADD CONSTRAINT x_col_fkey FOREIGN KEY (col) REFERENCES y(id);
--
-- Trigger strictement append-only d'origine :
-- CREATE OR REPLACE FUNCTION prevent_audit_modification()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     RAISE EXCEPTION 'audit_logs est append-only : modification/suppression interdite (action=%, id=%)', TG_OP, OLD.id;
-- END;
-- $$ LANGUAGE plpgsql;
-- ============================================================================
-- Fin de la migration
-- ============================================================================
