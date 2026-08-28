-- 021_request_documents.sql — le lien demandes ↔ documents, enfin une relation.
--
-- AVANT : une seule colonne `requests.document_id`, unidirectionnelle,
-- 1 demande → 0..1 document, sans réciproque — depuis un document, remonter à
-- la demande qui l'a produit était impossible ; les pièces jointes d'une
-- demande livrée devenaient des « versions » d'un unique document ; et une
-- demande ne pouvait pas référencer un document EXISTANT du référentiel sans
-- écraser le lien principal.
--
-- APRÈS : une table de jointure typée (N↔N), une réciproque directe pour le
-- document PRODUIT, et le backfill des liens existants — rien n'est perdu.
--
-- Idempotent : rejouable sur une base neuve ou déjà migrée.

-- 1. La jointure typée.
--    link_type :
--      'produit'   — le document est le LIVRABLE de la demande (indexation) ;
--      'piece'     — une pièce jointe de la demande versée au référentiel ;
--      'reference' — la demande s'appuie sur ce document existant.
CREATE TABLE IF NOT EXISTS request_documents (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    link_type VARCHAR(20) NOT NULL DEFAULT 'reference'
        CHECK (link_type IN ('produit', 'piece', 'reference')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (request_id, document_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_request_documents_request ON request_documents(request_id);
CREATE INDEX IF NOT EXISTS idx_request_documents_document ON request_documents(document_id);

-- 2. La réciproque directe : le document SAIT quelle demande l'a produit.
--    requests.document_id reste le lien principal (le livrable) — cette
--    colonne le rend lisible depuis la fiche document sans passer par la
--    jointure, et le backfill peuple les deux sens.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_request ON documents(request_id) WHERE request_id IS NOT NULL;

-- 3. Backfill : chaque lien existant (requests.document_id) devient une ligne
--    'produit' dans la jointure ET la réciproque documents.request_id.
--    Idempotent (ON CONFLICT DO NOTHING), et sans perte : l'ancienne colonne
--    n'est PAS supprimée — le code la lit encore pendant la transition.
INSERT INTO request_documents (request_id, document_id, link_type)
SELECT r.id, r.document_id, 'produit'
  FROM requests r
 WHERE r.document_id IS NOT NULL
ON CONFLICT (request_id, document_id, link_type) DO NOTHING;

UPDATE documents d
   SET request_id = r.id
  FROM requests r
 WHERE r.document_id = d.id
   AND d.request_id IS NULL;
