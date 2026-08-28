-- 018_bulk_upload_status.sql — Extension du statut des documents pour le téléversement en masse
-- Idempotent : peut être exécuté sur une base neuve ou existante.

-- 1. Suppression de l'ancienne contrainte de vérification du statut.
-- On utilise le nom par défaut généré par PostgreSQL pour une contrainte inline sur la colonne 'statut'.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_statut_check;

-- 2. Ajout de la nouvelle contrainte incluant le statut 'à indexer'.
ALTER TABLE documents ADD CONSTRAINT documents_statut_check
    CHECK (statut IN ('disponible', 'prêt', 'archivé', 'à indexer'));
