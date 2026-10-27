-- ============================================================================
-- 037_horodatage_formats.sql — horodatage par un tiers et formats pérennes
-- (loi n° 2017-20 portant Code du numérique en République du Bénin).
-- ============================================================================
--
-- 1. HORODATAGE (art. 299-300). Un horodatage électronique est recevable
--    comme preuve ; QUALIFIÉ, il est présumé exact. DocuFlow fait horodater
--    par une autorité d'horodatage (protocole RFC 3161) l'empreinte de ses
--    pièces probantes : sceaux du journal chaîné, procès-verbaux
--    d'élimination, bordereaux de versement transmis. Le jeton signé par
--    l'autorité est conservé tel quel ; il se vérifie hors de DocuFlow
--    (openssl ts -verify). La qualité « qualifié » dépend du prestataire
--    choisi, pas de DocuFlow.
--
-- 2. FORMATS (art. 302 : « formats appropriés à la conservation et à la
--    migration »). Chaque fichier reçoit son format identifié par sa
--    signature binaire (pas par son extension), une appréciation de sa
--    pérennité (pérenne, à surveiller, à risque) et, pour un PDF, sa
--    conformité PDF/A déclarée. Une copie de conservation PDF/A s'ajoute
--    comme nouvelle version, l'original restant intact (art. 301 : forme
--    d'origine, ou forme dont on démontre qu'elle n'altère pas le contenu) ;
--    elle désigne sa source.
--
-- Idempotent. Retour arrière : docs/migrations/down/037_horodatage_formats.down.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS horodatages (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    objet_type VARCHAR(20) NOT NULL CHECK (objet_type IN ('sceau', 'pv_elimination', 'versement')),
    objet_id INTEGER NOT NULL,
    empreinte CHAR(64) NOT NULL,                   -- SHA-256 horodaté
    tsa_url TEXT NOT NULL,
    statut VARCHAR(10) NOT NULL CHECK (statut IN ('obtenu', 'echec')),
    jeton BYTEA,                                   -- TimeStampResp DER, tel que reçu
    genere_at TIMESTAMPTZ,                         -- genTime du jeton
    numero_serie TEXT,
    autorite TEXT,                                 -- nom de l'autorité, si le jeton le porte
    erreur TEXT,
    tentatives INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, objet_type, objet_id, empreinte)
);
CREATE INDEX IF NOT EXISTS idx_horodatages_objet ON horodatages(tenant_id, objet_type, objet_id);

-- Un jeton obtenu ne se modifie plus (seule la suppression de l'organisation l'emporte).
CREATE OR REPLACE FUNCTION horodatages_inalterables() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('docuflow.audit_override', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF OLD.statut = 'obtenu' THEN
    RAISE EXCEPTION 'HORODATAGE_OBTENU: un jeton d''horodatage obtenu ne se modifie plus (% refusé)', TG_OP
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS trg_horodatages_inalterables ON horodatages;
CREATE TRIGGER trg_horodatages_inalterables BEFORE UPDATE OR DELETE ON horodatages
  FOR EACH ROW EXECUTE FUNCTION horodatages_inalterables();

ALTER TABLE document_files ADD COLUMN IF NOT EXISTS format_nom VARCHAR(60);
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS format_version VARCHAR(20);
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS format_risque VARCHAR(12);
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS pdfa VARCHAR(10);
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS format_identifie_at TIMESTAMPTZ;
ALTER TABLE document_files ADD COLUMN IF NOT EXISTS copie_de_file_id INTEGER REFERENCES document_files(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_files_format_risque_check') THEN
    ALTER TABLE document_files ADD CONSTRAINT document_files_format_risque_check
      CHECK (format_risque IS NULL OR format_risque IN ('perenne', 'surveiller', 'risque'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_document_files_format ON document_files(format_risque) WHERE format_risque IS NOT NULL;
