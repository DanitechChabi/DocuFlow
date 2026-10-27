-- Retour arrière de 036_archives_benin.sql (à appliquer à la main).
-- Les bordereaux d'élimination « transmis » ou « visés » repassent « validés ».
SET LOCAL docuflow.audit_override = 'on';
UPDATE bordereaux_elimination SET statut = 'valide' WHERE statut IN ('transmis', 'vise');
ALTER TABLE bordereaux_elimination DROP CONSTRAINT IF EXISTS bordereaux_elimination_statut_check;
ALTER TABLE bordereaux_elimination ADD CONSTRAINT bordereaux_elimination_statut_check
  CHECK (statut IN ('brouillon', 'propose', 'valide', 'rejete', 'execute', 'annule'));
ALTER TABLE bordereaux_elimination DROP CONSTRAINT IF EXISTS bordereaux_elimination_visa_decision_check;
ALTER TABLE bordereaux_elimination DROP CONSTRAINT IF EXISTS bordereaux_elimination_mode_destruction_check;
ALTER TABLE bordereaux_elimination
  DROP COLUMN IF EXISTS visa_requis, DROP COLUMN IF EXISTS transmis_par, DROP COLUMN IF EXISTS transmis_par_nom,
  DROP COLUMN IF EXISTS transmis_at, DROP COLUMN IF EXISTS visa_autorite, DROP COLUMN IF EXISTS visa_numero,
  DROP COLUMN IF EXISTS visa_date, DROP COLUMN IF EXISTS visa_decision, DROP COLUMN IF EXISTS visa_observations,
  DROP COLUMN IF EXISTS visa_piece_document_id, DROP COLUMN IF EXISTS visa_saisi_par, DROP COLUMN IF EXISTS visa_saisi_par_nom,
  DROP COLUMN IF EXISTS visa_saisi_at, DROP COLUMN IF EXISTS mode_destruction, DROP COLUMN IF EXISTS prestataire,
  DROP COLUMN IF EXISTS controle_par;
ALTER TABLE bordereau_documents DROP COLUMN IF EXISTS exclu_visa;

ALTER TABLE documents DROP COLUMN IF EXISTS verse_versement_id, DROP COLUMN IF EXISTS verse_at;
DROP TABLE IF EXISTS versement_documents;
DROP TABLE IF EXISTS versements_compteurs;
DROP TABLE IF EXISTS bordereaux_versement;
DROP FUNCTION IF EXISTS versements_inalterables();

ALTER TABLE metadata_schemas DROP CONSTRAINT IF EXISTS metadata_schemas_communicabilite_check;
ALTER TABLE metadata_schemas DROP COLUMN IF EXISTS communicabilite;
ALTER TABLE document_partages DROP COLUMN IF EXISTS autorisation_communication;
UPDATE roles SET permissions = array_remove(permissions, 'archives.communicate');
