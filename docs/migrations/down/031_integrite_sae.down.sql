-- Retour arrière de 031_integrite_sae.sql — à exécuter À LA MAIN.
-- ATTENTION : retirer le chaînage ne réécrit pas le journal (il reste
-- append-only) ; les colonnes de chaîne disparaissent avec leurs valeurs, les
-- sceaux et les traces de purge aussi. Les gels juridiques en cours sont
-- perdus : les lever d'abord.
BEGIN;
DROP TRIGGER IF EXISTS trg_document_files_gel ON document_files;
DROP TRIGGER IF EXISTS trg_documents_gel ON documents;
DROP FUNCTION IF EXISTS refuser_si_gele();
DROP FUNCTION IF EXISTS document_est_gele(INTEGER);
DROP TABLE IF EXISTS document_gels;
DROP TRIGGER IF EXISTS trg_audit_sceaux_inalterables ON audit_sceaux;
DROP FUNCTION IF EXISTS audit_sceaux_inalterables();
DROP TABLE IF EXISTS audit_sceaux;
DROP TRIGGER IF EXISTS trg_audit_zz_purge ON audit_logs;
DROP FUNCTION IF EXISTS audit_noter_purge();
DROP TABLE IF EXISTS audit_chaine_purges;
DROP TRIGGER IF EXISTS trg_audit_zz_chainage ON audit_logs;
DROP FUNCTION IF EXISTS audit_chainer();
DROP TABLE IF EXISTS audit_chaine_tetes;
DROP FUNCTION IF EXISTS audit_empreinte_ligne(audit_logs);
DROP INDEX IF EXISTS idx_audit_logs_chaine;
-- Le trigger append-only bloque les UPDATE et DELETE, pas les ALTER : les
-- colonnes se retirent sans toucher aux lignes.
ALTER TABLE audit_logs DROP COLUMN IF EXISTS chaine_hash;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS chaine_precedent;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS chaine_rang;
DROP INDEX IF EXISTS idx_document_files_a_verifier;
DROP INDEX IF EXISTS idx_document_files_empreinte;
ALTER TABLE notifications DROP COLUMN IF EXISTS document_id;
ALTER TABLE document_files DROP CONSTRAINT IF EXISTS document_files_empreinte_origine_check;
ALTER TABLE document_files DROP CONSTRAINT IF EXISTS document_files_integrite_statut_check;
ALTER TABLE document_files DROP COLUMN IF EXISTS integrite_verifiee_at;
ALTER TABLE document_files DROP COLUMN IF EXISTS integrite_statut;
ALTER TABLE document_files DROP COLUMN IF EXISTS empreinte_origine;
ALTER TABLE document_files DROP COLUMN IF EXISTS empreinte_at;
ALTER TABLE document_files DROP COLUMN IF EXISTS empreinte_sha256;
UPDATE roles SET permissions = array_remove(array_remove(array_remove(array_remove(permissions,
  'archives.view'), 'archives.manage'), 'archives.hold'), 'archives.validate') WHERE is_system;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '031_integrite_sae.sql';
  END IF;
END $$;
COMMIT;
