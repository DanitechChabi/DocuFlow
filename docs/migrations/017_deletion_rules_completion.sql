-- ============================================================================
-- 017_deletion_rules_completion.sql — Les deux clés oubliées par la 014
-- ============================================================================
-- CONSTAT
--
-- La 014 annonce en fin de fichier : « Plus aucune ligne ne doit ressortir en
-- NO ACTION ». Après son application, deux subsistent :
--
--   request_files.tenant_id       → tenants(id)   NO ACTION
--   message_attachments.tenant_id → tenants(id)   NO ACTION
--
-- Ces deux colonnes ne figurent pas au §2 de la 014 parce qu'elles n'ont pas
-- été créées avec leur table : la 007 les ajoute après coup
-- (ALTER TABLE ... ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)), sans
-- clause ON DELETE, et l'inventaire du §2 a été dressé à partir des tables
-- multi-tenant d'origine.
--
-- Conséquence vérifiée sur la base locale : supprimer une entreprise échoue en
-- 23503 dès qu'une seule de ses demandes porte un fichier joint — c'est-à-dire
-- dans le cas normal. Le symptôme est exactement celui que la 014 devait faire
-- disparaître, ce qui rend le diagnostic trompeur : l'administrateur constate
-- que la migration « n'a pas marché » alors qu'elle a marché à deux tables près.
--
-- POURQUOI UN FICHIER SÉPARÉ PLUTÔT QU'UNE CORRECTION DE LA 014
--
-- La 014 est déjà enregistrée dans `migrations` sur les bases en service. Y
-- ajouter deux lignes ne les rejouerait jamais : migrate.js saute tout fichier
-- déjà enregistré. La correction ne parviendrait qu'aux bases neuves, et les
-- bases existantes — les seules qui ont le problème — resteraient bloquées, avec
-- un fichier qui affirme le contraire. Une migration nouvelle est le seul moyen
-- d'atteindre les deux populations.
--
-- Idempotente : la règle est découverte puis réécrite ; réexécuter ne change
-- rien. Non destructive : aucune donnée n'est touchée, seules des règles de
-- suppression changent.
--
-- PAS DE BEGIN/COMMIT DANS CE FICHIER — voir l'en-tête de la 014 : PostgreSQL
-- n'imbrique pas les transactions, et un COMMIT ici refermerait celle de
-- l'appelant. La transaction est l'affaire de l'exécuteur.
--
-- Prérequis : 007_schema_align.sql (qui crée les colonnes) et 014.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CASCADE, et non SET NULL
--
-- Les deux colonnes sont NOT NULL (la 007 les passe explicitement à NOT NULL
-- après avoir posé un DEFAULT 1) : SET NULL est structurellement impossible,
-- il échouerait à la première suppression. CASCADE est de toute façon le bon
-- choix ici — un fichier joint à une demande d'entreprise supprimée n'a plus
-- de propriétaire, plus de lecteur autorisé et plus de raison d'exister.
--
-- La suppression en base n'emporte pas le binaire chez Cloudinary : celui-ci
-- est adressé par `cloudinary_public_id`, hors de portée d'une contrainte SQL.
-- C'est déjà le cas pour les six tables passées en CASCADE par la 014 ; le
-- nettoyage du stockage distant est un travail applicatif, pas une règle de
-- clé étrangère.
--
-- La découverte remplace le nommage, comme au §1 de la 014 : le nom réel dépend
-- de la migration qui a posé la contrainte, et une table peut en porter deux
-- équivalentes. Les nommer une par une laisserait le doublon, et le doublon
-- suffit à rebloquer la suppression.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    cible      TEXT;
    contrainte RECORD;
    canonique  TEXT;
BEGIN
    FOREACH cible IN ARRAY ARRAY['request_files', 'message_attachments']
    LOOP
        IF to_regclass(cible) IS NULL THEN
            RAISE NOTICE '017 : table % absente, ignorée', cible;
            CONTINUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = cible AND column_name = 'tenant_id') THEN
            RAISE NOTICE '017 : colonne %.tenant_id absente, ignorée', cible;
            CONTINUE;
        END IF;

        FOR contrainte IN
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
            WHERE c.contype = 'f'
              AND c.conrelid = to_regclass(cible)
              AND c.confrelid = to_regclass('tenants')
              AND a.attname = 'tenant_id'
              AND array_length(c.conkey, 1) = 1
        LOOP
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', cible, contrainte.conname);
        END LOOP;

        canonique := format('%s_tenant_id_fkey', cible);
        EXECUTE format(
            'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) '
            'REFERENCES tenants(id) ON DELETE CASCADE',
            cible, canonique
        );
        RAISE NOTICE '017 : %.tenant_id passée en ON DELETE CASCADE', cible;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Garde-fou : la promesse de la 014 est désormais tenue, et on le vérifie ici
-- plutôt que dans un commentaire.
--
-- `licenses.tenant_id` est volontairement en SET NULL (voir 015 : une licence
-- payée survit à l'entreprise qui l'a payée) — SET NULL n'est pas NO ACTION, ce
-- contrôle ne la concerne donc pas.
--
-- Échouer ici est préférable à laisser passer : la migration est jouée dans la
-- transaction de migrate.js, l'exception annule tout et rien n'est enregistré.
-- Une suppression d'entreprise qui échoue en production est bien plus coûteuse à
-- diagnostiquer qu'une migration qui refuse de passer en annonçant sa raison.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    restantes TEXT;
BEGIN
    SELECT string_agg(format('%s.%s', conrelid::regclass::text, conname), ', ')
      INTO restantes
      FROM pg_constraint
     WHERE contype = 'f' AND confdeltype = 'a';

    IF restantes IS NOT NULL THEN
        RAISE EXCEPTION 'Clés étrangères encore en NO ACTION après la 017 : %', restantes
            USING HINT = 'Ajouter la règle ON DELETE correspondante, comme au §2 de la 014.';
    END IF;
END $$;

-- ============================================================================
-- Vérification après application
--
--   SELECT conrelid::regclass::text, conname, confdeltype
--   FROM pg_constraint WHERE contype = 'f' AND confdeltype = 'a';
--   -- doit renvoyer 0 ligne
--
--   SELECT conrelid::regclass::text, confdeltype
--   FROM pg_constraint
--   WHERE conname IN ('request_files_tenant_id_fkey', 'message_attachments_tenant_id_fkey');
--   -- doit renvoyer 2 lignes, confdeltype = 'c'
-- ============================================================================
-- ROLLBACK (état antérieur : NO ACTION, à exécuter manuellement)
--
--   ALTER TABLE request_files DROP CONSTRAINT request_files_tenant_id_fkey;
--   ALTER TABLE request_files ADD CONSTRAINT request_files_tenant_id_fkey
--       FOREIGN KEY (tenant_id) REFERENCES tenants(id);
--   ALTER TABLE message_attachments DROP CONSTRAINT message_attachments_tenant_id_fkey;
--   ALTER TABLE message_attachments ADD CONSTRAINT message_attachments_tenant_id_fkey
--       FOREIGN KEY (tenant_id) REFERENCES tenants(id);
--
-- Revenir en arrière rebloque la suppression d'entreprise : à ne faire que si
-- une contrainte externe l'impose.
-- ============================================================================
