-- ============================================================================
-- 039_copies_certifiees.sql — registre des copies certifiées conformes.
-- ============================================================================
--
-- Décret n° 2007-532, art. 36 : les services d'archives délivrent des copies
-- certifiées conformes des documents qu'ils conservent. Code du numérique
-- (loi n° 2017-20), art. 272 : la copie d'un écrit électronique a la valeur
-- de l'original lorsqu'elle en garantit l'intégrité.
--
-- Chaque copie délivrée reçoit un numéro annuel (CCC-2026-00001) et entre au
-- registre avec l'empreinte de l'original reproduit, l'empreinte du PDF remis
-- et le PDF lui-même : une copie présentée plus tard se vérifie octet pour
-- octet. Le registre est inaltérable (ni modification, ni suppression).
-- L'empreinte du PDF remis peut être horodatée par l'autorité tierce (037).
-- ============================================================================

CREATE TABLE IF NOT EXISTS copies_certifiees (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    numero VARCHAR(32) NOT NULL,
    document_id INTEGER NOT NULL,                 -- sans clé étrangère : le registre survit à l'élimination
    document_reference TEXT,
    file_id INTEGER,
    version INTEGER,
    nom_fichier TEXT,
    empreinte_original CHAR(64) NOT NULL,         -- SHA-256 de la version reproduite (vérifiée à la délivrance)
    empreinte_copie CHAR(64) NOT NULL,            -- SHA-256 du PDF remis
    pages INTEGER NOT NULL,
    pdf BYTEA NOT NULL,
    destinataire TEXT NOT NULL,
    motif TEXT,
    request_id INTEGER,
    autorisation_communication TEXT,              -- document non encore communicable : décision qui l'autorise
    lieu TEXT,
    delivre_par INTEGER,
    delivre_par_nom TEXT NOT NULL,
    qualite_signataire TEXT NOT NULL,
    delivre_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_copies_certifiees_document ON copies_certifiees(tenant_id, document_id);

CREATE TABLE IF NOT EXISTS copies_certifiees_compteurs (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    annee INTEGER NOT NULL,
    dernier INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, annee)
);

CREATE OR REPLACE FUNCTION copies_certifiees_inalterables() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('docuflow.audit_override', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'COPIE_CERTIFIEE: le registre des copies certifiées est inaltérable (% refusé)', TG_OP USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_copies_certifiees_inalterables ON copies_certifiees;
CREATE TRIGGER trg_copies_certifiees_inalterables BEFORE UPDATE OR DELETE ON copies_certifiees
  FOR EACH ROW EXECUTE FUNCTION copies_certifiees_inalterables();

-- Horodatage du PDF remis.
ALTER TABLE horodatages DROP CONSTRAINT IF EXISTS horodatages_objet_type_check;
ALTER TABLE horodatages ADD CONSTRAINT horodatages_objet_type_check
  CHECK (objet_type IN ('sceau', 'pv_elimination', 'versement', 'copie_certifiee'));
