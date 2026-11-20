-- 059 — Reprise du registre papier des sorties : les dossiers sortis avant
-- l'application entrent dans « Dossiers sortis » avec leurs vraies dates.
-- L'emprunteur n'a souvent pas de compte (« DE », « DCI », « Mme Sylvia ») :
-- son nom est gardé tel qu'il est écrit au registre. Une empreinte par ligne
-- évite les doublons quand on réimporte un registre complété.
ALTER TABLE request_loans ADD COLUMN IF NOT EXISTS emprunteur_nom VARCHAR(255);
ALTER TABLE request_loans ADD COLUMN IF NOT EXISTS reprise_empreinte VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_request_loans_reprise
    ON request_loans (tenant_id, reprise_empreinte) WHERE reprise_empreinte IS NOT NULL;
