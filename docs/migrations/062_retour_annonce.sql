-- 062 — L'agent annonce qu'il a rapporté le dossier ; l'archive confirme le
-- retour (seule l'archive enregistre un retour).
ALTER TABLE request_loans ADD COLUMN IF NOT EXISTS rapporte_annonce_at TIMESTAMPTZ;
