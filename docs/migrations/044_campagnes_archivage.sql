-- ============================================================================
-- 044_campagnes_archivage.sql — campagnes d'archivage périodiques.
-- ============================================================================
--
-- Sans rendez-vous, l'archivage n'a lieu « ni à la clôture des dossiers, ni
-- suivant une périodicité définie » : chacun garde ses documents sur son
-- poste. Une campagne revient donc à date fixe (chaque mois, trimestre,
-- semestre ou année, selon le réglage `archivage_campagne`) : chaque agent
-- est invité à verser les documents de ses dossiers clos, et les
-- gestionnaires des archives reçoivent le bilan de ce qui reste à faire.
--
-- Une ligne par organisation et par période (2026-T4, 2026-11, 2026-S2,
-- 2026). Le bilan est figé au lancement : il sert à comparer les campagnes
-- entre elles. Une campagne relancée à la main garde sa ligne ; seuls le
-- compteur de rappels et le bilan changent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS campagnes_archivage (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    periode VARCHAR(12) NOT NULL,
    periodicite VARCHAR(14) NOT NULL,
    lancee_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lancee_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    lancee_par_nom VARCHAR(150),
    rappels INTEGER NOT NULL DEFAULT 0,
    dernier_rappel_at TIMESTAMPTZ,
    bilan JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (tenant_id, periode)
);
CREATE INDEX IF NOT EXISTS idx_campagnes_archivage_tenant ON campagnes_archivage(tenant_id, lancee_at DESC);
