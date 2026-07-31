-- ============================================================================
-- Migration 003 : Machine à états + attribution des tâches
-- 1. Attribution des demandes à un archiviste (assignee_id)
-- 2. Table request_history : étapes horodatées de chaque demande
--    (source de vérité des transitions de la machine à états → SLA & reporting)
-- ============================================================================

-- 1. Attribution
ALTER TABLE requests ADD COLUMN IF NOT EXISTS assignee_id INTEGER REFERENCES users(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_requests_assignee ON requests(assignee_id, statut);

-- 2. Historique structuré des états (chaque transition : précédent → nouveau)
CREATE TABLE IF NOT EXISTS request_history (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    request_id INTEGER REFERENCES requests(id),
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    previous_status VARCHAR(30),
    new_status VARCHAR(30),
    comment TEXT,
    user_name VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_request_history_request ON request_history(request_id);
