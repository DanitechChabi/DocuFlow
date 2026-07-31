-- ============================================================================
-- Initialisation de la base de données DocuFlow
-- Version multi-entreprise (tenants)
-- Auteur : CHABI BOUKO Daniel
-- ============================================================================

-- 0. Table des entreprises (tenants)
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    email_domain VARCHAR(255),
    contact_email VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 1. Table des Utilisateurs
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    username VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    section VARCHAR(50),
    role VARCHAR(20) DEFAULT 'demandeur', -- 'superadmin', 'admin', 'archiviste', 'demandeur'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, username),
    UNIQUE(tenant_id, email)
);

-- 2. Table des Documents (Indexation mirror de mfile)
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    reference_mfile VARCHAR(100) NOT NULL,
    num_dossier VARCHAR(50) NOT NULL,
    num_acte VARCHAR(50) NOT NULL,
    nom_entreprise VARCHAR(255) NOT NULL,
    annee INTEGER NOT NULL,
    est_numerise BOOLEAN DEFAULT FALSE,
    chemin_acces_numerique TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, reference_mfile)
);

-- 3. Table des Demandes
CREATE TABLE IF NOT EXISTS requests (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    id_user INTEGER REFERENCES users(id),
    nom_entreprise VARCHAR(255) NOT NULL,
    num_dossier VARCHAR(50) NOT NULL,
    num_acte VARCHAR(50) NOT NULL,
    annee INTEGER NOT NULL,
    type_document VARCHAR(100),
    motif VARCHAR(100) NOT NULL,
    priorite VARCHAR(20) DEFAULT 'normale',
    statut VARCHAR(30) DEFAULT 'en attente', -- 'en attente', 'transmis', 'a traiter', 'livré', 'rejete'
    notes_internes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_livraison TIMESTAMP,
    CONSTRAINT fk_user FOREIGN KEY(id_user) REFERENCES users(id)
);

-- 4. Table des Sections
CREATE TABLE IF NOT EXISTS sections (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, name)
);

-- 5. Table des Messages
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    sender_id INTEGER REFERENCES users(id),
    receiver_id INTEGER REFERENCES users(id),
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Table des Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    user_id INTEGER REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Table d'Audit
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    id_user INTEGER REFERENCES users(id),
    request_id INTEGER REFERENCES requests(id),
    action TEXT NOT NULL,
    ip_address VARCHAR(45),
    user_name VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Table de l'historique des demandes
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

-- 9. Table des Paramètres (Branding) - par entreprise
CREATE TABLE IF NOT EXISTS settings (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    key VARCHAR(255) NOT NULL,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, key)
);

-- ============================================================================
-- Index
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_requests_tenant ON requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_requests_tenant_status ON requests(tenant_id, statut);
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(id_user);
CREATE INDEX IF NOT EXISTS idx_sections_tenant ON sections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_participants ON messages(tenant_id, sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(tenant_id, user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_settings_tenant ON settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- ============================================================================
-- Tenant par défaut
-- ============================================================================
INSERT INTO tenants (name, slug, status)
VALUES ('AFGC', 'afgc', 'active')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- Insertion d'un super-administrateur par défaut
-- NOTE: En production, changez le mot de passe immédiatement après installation
-- ============================================================================
-- INSERT INTO users (tenant_id, username, password_hash, full_name, email, section, role)
-- VALUES (1, 'admin', '$2a$10$...', 'Super Admin', 'admin@afgc.com', 'Informatique', 'superadmin');
