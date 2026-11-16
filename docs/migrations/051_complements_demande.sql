-- 051 — Demande de compléments.
-- L'archive renvoie une demande insuffisante à son auteur (statut
-- « a completer ») avec ce qui manque ; il la complète et la renvoie
-- (retour à « en attente »). Le dernier échange est gardé sur la demande ;
-- tout l'historique est dans request_history.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS complement_message TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS complement_champs TEXT[];
ALTER TABLE requests ADD COLUMN IF NOT EXISTS complement_demande_at TIMESTAMP;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS complement_demande_par VARCHAR(255);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS complement_fourni_at TIMESTAMP;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS complement_reponse TEXT;
