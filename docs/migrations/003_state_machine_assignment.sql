-- ============================================================================
-- Migration 003 : Machine à états + attribution des tâches
-- 1. Attribution des demandes à un archiviste (assignee_id)
-- 2. Table request_history : étapes horodatées de chaque demande
--    (source de vérité des transitions de la machine à états → SLA & reporting)
-- 3. Ajout de tenant_id aux tables de fichiers (multi-tenant)
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

-- 3. Ajouter tenant_id aux tables de fichiers pour le multi-tenant
ALTER TABLE request_files ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE request_files ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1;
ALTER TABLE message_attachments ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_request_files_tenant ON request_files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_tenant ON message_attachments(tenant_id);
