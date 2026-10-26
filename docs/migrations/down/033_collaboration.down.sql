-- Retour arrière de 033_collaboration.sql — à exécuter À LA MAIN.
-- ATTENTION : favoris, abonnements, commentaires et liens de partage sont
-- perdus ; les liens publics déjà diffusés cessent de fonctionner. Le journal
-- d'audit (PARTAGE_*, COMMENTAIRE_*, VERSION_RESTAUREE) est conservé.
BEGIN;
DROP INDEX IF EXISTS idx_notifications_document;
DROP TABLE IF EXISTS document_partages;
DROP TABLE IF EXISTS document_commentaires;
DROP TRIGGER IF EXISTS trg_documents_abonnement_createur ON documents;
DROP FUNCTION IF EXISTS document_abonner_createur();
DROP TABLE IF EXISTS document_abonnements;
DROP TABLE IF EXISTS document_favoris;
DO $$
BEGIN
  IF to_regclass('migrations') IS NOT NULL THEN
    DELETE FROM migrations WHERE filename = '033_collaboration.sql';
  END IF;
END $$;
COMMIT;
