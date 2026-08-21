-- ============================================================================
-- 015 — Licences de bureau et paiements
--
-- OBJET
-- DocuFlow se vend en application de bureau Windows sous abonnement mensuel
-- (75 000 FCFA / mois, ou 115 € via PayPal — le XOF n'est pas une devise
-- supportée par PayPal, et le peg XOF/EUR est fixe à 655,957).
--
-- Deux tables, deux responsabilités distinctes :
--   • `licenses` — le DROIT d'usage : à qui, sur quelle machine, jusqu'à quand.
--   • `payments` — la TRACE comptable de ce qui a été encaissé.
--
-- Elles sont séparées volontairement : une licence peut être prolongée sans
-- paiement (geste commercial, vente hors ligne, période d'essai), et un
-- paiement peut échouer ou être remboursé sans que la licence existe encore.
-- Les fusionner en une table forcerait à inventer des lignes de paiement
-- fictives pour chaque geste commercial.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- Elle ne touche pas `tenants.status`. Ce CHECK n'autorise que 'active' et
-- 'suspended', il est déclaré dans trois fichiers distincts (setup_db.sql,
-- 001_multi_tenant.sql, et en ligne dans authController.registerCompany), et
-- « abonnement échu » n'est pas « suspendu par l'administrateur » : ce sont deux
-- décisions différentes, prises par deux acteurs différents, réversibles par
-- deux moyens différents. L'état d'abonnement vit donc dans `licenses.status`.
--
-- Idempotente : CREATE TABLE IF NOT EXISTS + ajout de contraintes conditionnel.
-- La réexécuter est sans effet.
--
-- PAS DE BEGIN/COMMIT DANS CE FICHIER — même raison que la 014 : PostgreSQL
-- n'imbrique pas les transactions, et un COMMIT ici referme celle de l'appelant
-- s'il en avait ouvert une. La transaction est l'affaire de l'exécuteur.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Licences
--
-- `machine_id` NULL = licence émise mais jamais activée. La première activation
-- y inscrit l'empreinte du poste (SHA-256 de l'UUID matériel + nom d'hôte) et
-- la licence devient inutilisable ailleurs : c'est ce qui rend « 1 licence =
-- 1 poste » effectif plutôt que déclaratif. Le propriétaire de la plateforme
-- peut la remettre à NULL (changement d'ordinateur) via
-- POST /api/superadmin/licenses/:id/reset-machine.
--
-- `tenant_id` est NULLABLE, contrairement à toutes les autres tables du schéma.
-- Raison : une licence est vendue AVANT que l'entreprise n'existe en base. Le
-- client paie sur la page publique, reçoit sa clé par e-mail, installe, puis
-- crée son organisation au premier lancement. Exiger le tenant à l'émission
-- rendrait la vente impossible sans pré-créer une coquille vide.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS licenses (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    license_key VARCHAR(64) UNIQUE NOT NULL,
    machine_id VARCHAR(128),
    machine_label VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'expired', 'revoked')),
    valid_until TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    customer_email VARCHAR(255),
    customer_company VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ON DELETE SET NULL et non CASCADE : supprimer une entreprise ne doit pas
-- effacer la licence qu'elle a payée. La 014 met les FK vers tenants en
-- CASCADE pour les données métier — ici c'est l'inverse qui est correct, car la
-- licence est un fait commercial qui survit à l'organisation.

CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_tenant ON licenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_licenses_machine ON licenses(machine_id);

-- ----------------------------------------------------------------------------
-- 2. Paiements
--
-- `UNIQUE (provider, provider_ref)` est la pièce maîtresse de cette table.
-- KkiaPay et PayPal réémettent leurs webhooks (retry sur timeout, sur code non-2xx,
-- et parfois sans raison). Sans cette contrainte, chaque réémission créditerait
-- un mois supplémentaire : un client paierait une fois et recevrait trois mois.
-- Le contrôleur s'appuie dessus via INSERT ... ON CONFLICT DO NOTHING et
-- n'active la licence que si la ligne vient réellement d'être créée.
--
-- `amount` et `currency` enregistrent ce qui a été RÉELLEMENT encaissé, pas le
-- tarif affiché : en cas de changement de prix, l'historique reste exact.
--
-- `raw_payload` conserve la notification brute du fournisseur. Indispensable en
-- cas de litige (« je n'ai jamais payé ce mois-ci ») et pour rejouer un webhook
-- mal traité sans redemander au fournisseur.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    license_id INTEGER REFERENCES licenses(id) ON DELETE SET NULL,
    provider VARCHAR(20) NOT NULL
        CHECK (provider IN ('kkiapay', 'paypal', 'manual')),
    provider_ref VARCHAR(255),
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL CHECK (currency IN ('XOF', 'EUR')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    months INTEGER NOT NULL DEFAULT 1 CHECK (months >= 1 AND months <= 36),
    customer_email VARCHAR(255),
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    paid_at TIMESTAMPTZ
);

-- La contrainte d'unicité est ajoutée séparément : sur une base où la table
-- existait déjà sans elle (réexécution après une version antérieure de ce
-- fichier), CREATE TABLE IF NOT EXISTS ne l'aurait jamais posée.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'payments_provider_ref_uniq'
          AND conrelid = 'payments'::regclass
    ) THEN
        ALTER TABLE payments
            ADD CONSTRAINT payments_provider_ref_uniq UNIQUE (provider, provider_ref);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_license ON payments(license_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- ----------------------------------------------------------------------------
-- 3. Prolongation d'une licence
--
-- GREATEST(now(), valid_until) : un renouvellement anticipé CUMULE au lieu
-- d'écraser. Un client dont la licence court encore 10 jours et qui repaie
-- obtient 40 jours, pas 30 — sans quoi payer en avance ferait perdre du temps
-- déjà acheté, ce qui est une raison parfaitement valable de ne jamais payer en
-- avance.
--
-- COALESCE gère la première activation (valid_until IS NULL).
-- Le statut passe à 'active' sauf si la licence a été révoquée : une
-- révocation est une décision administrative qu'un paiement ne doit pas annuler
-- silencieusement.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION extend_license(p_license_id INTEGER, p_months INTEGER)
RETURNS TIMESTAMPTZ AS $$
DECLARE
    new_until TIMESTAMPTZ;
BEGIN
    UPDATE licenses
       SET valid_until = GREATEST(now(), COALESCE(valid_until, now()))
                         + (p_months || ' months')::INTERVAL,
           status      = CASE WHEN status = 'revoked' THEN status ELSE 'active' END,
           updated_at  = now()
     WHERE id = p_license_id
    RETURNING valid_until INTO new_until;

    IF new_until IS NULL THEN
        RAISE EXCEPTION 'Licence % introuvable', p_license_id
            USING ERRCODE = 'no_data_found';
    END IF;

    RETURN new_until;
END $$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 4. Péremption automatique à la lecture
--
-- Une licence dont la date est passée reste en base avec status='active' tant
-- que personne ne la relit : aucune tâche planifiée ne tourne sur Render (plan
-- free, pas de cron). Cette fonction est appelée par le contrôleur avant chaque
-- vérification, ce qui garantit que l'état lu est l'état réel sans dépendre
-- d'un ordonnanceur.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expire_stale_licenses()
RETURNS INTEGER AS $$
DECLARE
    affected INTEGER;
BEGIN
    UPDATE licenses
       SET status = 'expired', updated_at = now()
     WHERE status = 'active'
       AND valid_until IS NOT NULL
       AND valid_until < now();
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END $$ LANGUAGE plpgsql;

-- ============================================================================
-- Vérification après application
--
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('licenses','payments');
--   -- doit renvoyer 2 lignes
--
--   SELECT conname FROM pg_constraint WHERE conname = 'payments_provider_ref_uniq';
--   -- doit renvoyer 1 ligne (idempotence des webhooks)
--
--   SELECT proname FROM pg_proc
--    WHERE proname IN ('extend_license','expire_stale_licenses');
--   -- doit renvoyer 2 lignes
-- ============================================================================
