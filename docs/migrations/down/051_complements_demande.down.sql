UPDATE requests SET statut = 'en attente' WHERE statut = 'a completer';
ALTER TABLE requests DROP COLUMN IF EXISTS complement_message, DROP COLUMN IF EXISTS complement_champs,
  DROP COLUMN IF EXISTS complement_demande_at, DROP COLUMN IF EXISTS complement_demande_par,
  DROP COLUMN IF EXISTS complement_fourni_at, DROP COLUMN IF EXISTS complement_reponse;
