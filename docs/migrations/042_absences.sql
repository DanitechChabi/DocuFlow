-- ============================================================================
-- 042_absences.sql — absence et suppléance.
-- ============================================================================
--
-- Un agent en congé ou en mission ne doit pas bloquer un visa ni laisser un
-- courrier sans suite. Il déclare son absence (du… au…) et son suppléant :
-- pendant cette période, les nouvelles tâches de validation et les nouveaux
-- courriers qui lui reviennent vont au suppléant, « pour le compte de »
-- l'absent, et la trace le dit. Une ligne par personne : l'absence en cours
-- ou à venir ; elle s'efface d'elle-même une fois la date de fin passée
-- (elle n'est plus prise en compte).
-- ============================================================================

CREATE TABLE IF NOT EXISTS absences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    du DATE NOT NULL,
    au DATE NOT NULL,
    suppleant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    motif TEXT,
    declare_par INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (au >= du),
    CHECK (suppleant_id <> user_id)
);
CREATE INDEX IF NOT EXISTS idx_absences_tenant ON absences(tenant_id, du, au);

-- Lettre de réponse rédigée dans DocuFlow (courrier départ) : le texte est
-- gardé pour être repris, le PDF produit vit dans la GED (courriers.document_id).
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS lettre TEXT;
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS lettre_signataire TEXT;
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS lettre_qualite TEXT;
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS lettre_lieu TEXT;
