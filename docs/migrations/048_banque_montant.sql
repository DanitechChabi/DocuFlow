-- 048 — Banque et montant d'une demande (édition AFGC).
-- Garanties bancaires : le nom de la banque fait partie de ce qui identifie le
-- dossier ; prêts : le montant, facultatif, aide à le retrouver.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS banque VARCHAR(150);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS montant NUMERIC(18, 2);
