-- ============================================================================
-- 012_mfiles_core_align.sql — Alignement du cœur GED M-Files sur le schéma réel
-- ============================================================================
-- Remplace l'ancienne 012_mfiles_full_core.sql, qui était structurellement
-- fautive : elle redéclarait `document_relations` et `retention_policies` avec
-- des colonnes différentes de celles de la migration 010, en `CREATE TABLE IF
-- NOT EXISTS`. Sur une base où ces tables existaient déjà, elle ne faisait donc
-- rien du tout ; et elle dupliquait metadata_fields/metadata_values sous les
-- noms document_metadata_definitions/document_metadata_values.
--
-- Constat sur la base de production (Neon) : la migration 010 n'a jamais été
-- appliquée, et `audit_logs` provient de docs/setup_db.sql avec une structure
-- ancienne (id_user, request_id, user_name, timestamp) que le code existant
-- (auditService, requestController, requestDetailsController) utilise toujours.
-- Un `CREATE TABLE IF NOT EXISTS audit_logs` comme dans la 010 n'aurait donc
-- pas ajouté les colonnes attendues par la GED documentaire.
--
-- Cette migration est idempotente et NON destructive : elle ajoute les colonnes
-- manquantes sans rien casser des usages historiques.
-- Prérequis : 010_metadata_typed.sql puis 011_mfiles_features.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. audit_logs — convergence ancienne structure ↔ journal GED append-only
--    Ancien code : id_user, request_id, user_name, timestamp
--    Code GED    : actor_id, actor_username, object_type, object_id,
--                  details_json, occurred_at
--    Les deux jeux de colonnes coexistent ; les nouvelles sont nullables.
-- ----------------------------------------------------------------------------
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_username VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS object_type VARCHAR(50);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS object_id INTEGER;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details_json JSONB DEFAULT '{}'::jsonb;

-- `occurred_at` est ajoutée SANS valeur par défaut, contrairement aux autres
-- colonnes : un `DEFAULT CURRENT_TIMESTAMP` serait appliqué immédiatement à
-- toutes les lignes existantes, qui porteraient alors l'heure de la migration au
-- lieu de leur heure d'origine — et le rattrapage `WHERE occurred_at IS NULL`
-- plus bas ne corrigerait rien, puisque plus aucune ligne ne serait nulle. La
-- valeur par défaut est posée après le rattrapage, pour les insertions futures.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMP;

-- `timestamp` reste la colonne historique : on la conserve et on la garde
-- synchronisée avec occurred_at pour que les deux lectures fonctionnent.
--
-- Le trigger append-only est retiré le temps du rattrapage : s'il a été posé par
-- une exécution antérieure, il ferait échouer ces trois UPDATE. Il est reposé
-- plus bas, une fois la convergence terminée.
DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_logs;

UPDATE audit_logs SET occurred_at = "timestamp" WHERE occurred_at IS NULL AND "timestamp" IS NOT NULL;
UPDATE audit_logs SET actor_id = id_user WHERE actor_id IS NULL AND id_user IS NOT NULL;
UPDATE audit_logs SET actor_username = user_name WHERE actor_username IS NULL AND user_name IS NOT NULL;

-- Réparation des bases ayant reçu la version antérieure de cette migration, où
-- `occurred_at` était créée avec DEFAULT CURRENT_TIMESTAMP : toutes les lignes
-- existantes y portent l'heure de la migration et non leur heure d'origine. Le
-- garde `IS NULL` ci-dessus ne peut donc pas les atteindre. On réaligne sur la
-- colonne historique, seule source fiable de la date de l'événement.
UPDATE audit_logs SET occurred_at = "timestamp"
WHERE "timestamp" IS NOT NULL AND occurred_at IS DISTINCT FROM "timestamp";

-- Valeur par défaut pour les insertions futures : posée seulement maintenant,
-- une fois les lignes historiques réalignées (voir le commentaire de l'ALTER).
ALTER TABLE audit_logs ALTER COLUMN occurred_at SET DEFAULT CURRENT_TIMESTAMP;

-- Les insertions passant par l'ancien chemin (auditService) ne renseignent pas
-- occurred_at ; ce trigger garantit que les deux colonnes de date restent alignées
-- dans les deux sens, sans imposer de changement au code appelant.
CREATE OR REPLACE FUNCTION sync_audit_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.occurred_at IS NULL AND NEW."timestamp" IS NOT NULL THEN
        NEW.occurred_at := NEW."timestamp";
    ELSIF NEW."timestamp" IS NULL AND NEW.occurred_at IS NOT NULL THEN
        NEW."timestamp" := NEW.occurred_at;
    END IF;
    IF NEW.actor_id IS NULL AND NEW.id_user IS NOT NULL THEN
        NEW.actor_id := NEW.id_user;
    ELSIF NEW.id_user IS NULL AND NEW.actor_id IS NOT NULL THEN
        NEW.id_user := NEW.actor_id;
    END IF;
    IF NEW.actor_username IS NULL AND NEW.user_name IS NOT NULL THEN
        NEW.actor_username := NEW.user_name;
    ELSIF NEW.user_name IS NULL AND NEW.actor_username IS NOT NULL THEN
        NEW.user_name := NEW.actor_username;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_sync_timestamps ON audit_logs;
CREATE TRIGGER trg_audit_sync_timestamps
    BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION sync_audit_timestamps();

CREATE INDEX IF NOT EXISTS idx_audit_logs_object ON audit_logs(object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred ON audit_logs(occurred_at DESC);

-- Append-only (conformité GoBD / NF Z42-013) : aucune modification ni
-- suppression après insertion. Posé APRÈS les UPDATE de rattrapage ci-dessus.
-- NB : superadminController supprime des lignes audit_logs lors de la purge
--      d'une demande ; ce DELETE est désormais refusé par conception — le code
--      l'entoure déjà d'un .catch(() => {}).
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs est append-only : modification/suppression interdite (action=%, id=%)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_logs;
CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- ----------------------------------------------------------------------------
-- 2. document_relations — garantir les colonnes du schéma 010
--    (source/target, et non from/to comme le voulait l'ancienne 012)
-- ----------------------------------------------------------------------------
ALTER TABLE document_relations ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);

DO $$
BEGIN
    -- Base ayant reçu l'ancienne 012 : renommer vers la convention 010.
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'document_relations' AND column_name = 'from_document_id')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'document_relations' AND column_name = 'source_document_id') THEN
        ALTER TABLE document_relations RENAME COLUMN from_document_id TO source_document_id;
        ALTER TABLE document_relations RENAME COLUMN to_document_id TO target_document_id;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_relations_unique_triplet') THEN
        ALTER TABLE document_relations
            ADD CONSTRAINT document_relations_unique_triplet
            UNIQUE (source_document_id, target_document_id, relation_type);
    END IF;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Contrainte unique document_relations non ajoutée : %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- 3. retention_policies — garantir les colonnes du schéma 010
-- ----------------------------------------------------------------------------
ALTER TABLE retention_policies ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE retention_policies ADD COLUMN IF NOT EXISTS applies_to_schema_id INTEGER REFERENCES metadata_schemas(id) ON DELETE SET NULL;
ALTER TABLE retention_policies ADD COLUMN IF NOT EXISTS retention_years INTEGER DEFAULT 5;
ALTER TABLE retention_policies ADD COLUMN IF NOT EXISTS action_on_expiry VARCHAR(20) DEFAULT 'archive';
ALTER TABLE retention_policies ADD COLUMN IF NOT EXISTS notify_before_days INTEGER DEFAULT 30;

-- Reprise des données si la base avait reçu l'ancienne 012
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'retention_policies' AND column_name = 'retention_period_days') THEN
        UPDATE retention_policies
        SET retention_years = GREATEST(1, ROUND(retention_period_days / 365.0)::int)
        WHERE retention_years IS NULL AND retention_period_days IS NOT NULL;
        ALTER TABLE retention_policies ALTER COLUMN retention_period_days DROP NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'retention_policies' AND column_name = 'metadata_filter_json') THEN
        ALTER TABLE retention_policies ALTER COLUMN metadata_filter_json DROP NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'retention_policies' AND column_name = 'action') THEN
        UPDATE retention_policies
        SET action_on_expiry = CASE lower(action)
                                   WHEN 'delete' THEN 'delete'
                                   WHEN 'review' THEN 'alert'
                                   ELSE 'archive'
                               END
        WHERE action_on_expiry IS NULL AND action IS NOT NULL;
        ALTER TABLE retention_policies ALTER COLUMN action DROP NOT NULL;
    END IF;
END $$;

ALTER TABLE retention_policies ALTER COLUMN retention_years SET NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. Tables parasites de l'ancienne 012 (doublons de 010) : supprimées si vides
--    Elles ne sont référencées par aucun code après l'alignement des services.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_audit_log') THEN
        IF NOT EXISTS (SELECT 1 FROM document_audit_log LIMIT 1) THEN
            DROP TABLE document_audit_log;
        ELSE
            RAISE NOTICE 'document_audit_log conservée (contient des données) — migration manuelle requise.';
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_metadata_values') THEN
        IF NOT EXISTS (SELECT 1 FROM document_metadata_values LIMIT 1) THEN
            DROP TABLE document_metadata_values;
        ELSE
            RAISE NOTICE 'document_metadata_values conservée (contient des données) — migration manuelle requise.';
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_metadata_definitions') THEN
        IF NOT EXISTS (SELECT 1 FROM document_metadata_definitions LIMIT 1) THEN
            DROP TABLE document_metadata_definitions;
        ELSE
            RAISE NOTICE 'document_metadata_definitions conservée (contient des données) — migration manuelle requise.';
        END IF;
    END IF;
END $$;

-- ============================================================================
-- ROLLBACK (à exécuter manuellement en cas de retour arrière)
-- ============================================================================
-- DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_logs;
-- DROP TRIGGER IF EXISTS trg_audit_sync_timestamps ON audit_logs;
-- DROP FUNCTION IF EXISTS sync_audit_timestamps();
-- ALTER TABLE audit_logs DROP COLUMN IF EXISTS actor_id;
-- ALTER TABLE audit_logs DROP COLUMN IF EXISTS actor_username;
-- ALTER TABLE audit_logs DROP COLUMN IF EXISTS object_type;
-- ALTER TABLE audit_logs DROP COLUMN IF EXISTS object_id;
-- ALTER TABLE audit_logs DROP COLUMN IF EXISTS details_json;
-- ALTER TABLE audit_logs DROP COLUMN IF EXISTS occurred_at;
-- ALTER TABLE document_relations DROP CONSTRAINT IF EXISTS document_relations_unique_triplet;
-- ALTER TABLE document_relations DROP COLUMN IF EXISTS created_by;
-- ALTER TABLE retention_policies DROP COLUMN IF EXISTS applies_to_schema_id;
-- ALTER TABLE retention_policies DROP COLUMN IF EXISTS retention_years;
-- ALTER TABLE retention_policies DROP COLUMN IF EXISTS action_on_expiry;
-- ALTER TABLE retention_policies DROP COLUMN IF EXISTS notify_before_days;
-- ALTER TABLE retention_policies DROP COLUMN IF EXISTS description;
-- ============================================================================
-- Fin de la migration
-- ============================================================================
