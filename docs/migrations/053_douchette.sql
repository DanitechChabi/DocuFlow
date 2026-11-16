-- 053 — Étiquettes à code-barres et douchette (édition AFGC).
-- Chaque dossier entré porte une étiquette (code « D0001234 » : son n° dans
-- dossiers_entres). Sorti à la douchette, le prêt garde le dossier scanné :
-- au retour, scanner l'étiquette retrouve le prêt sans chercher.
ALTER TABLE request_loans ADD COLUMN IF NOT EXISTS dossier_entre_id INTEGER REFERENCES dossiers_entres(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_request_loans_dossier_entre ON request_loans (dossier_entre_id) WHERE dossier_entre_id IS NOT NULL;
