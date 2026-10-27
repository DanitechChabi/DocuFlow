-- ============================================================================
-- 038_archives_physiques.sql — archives papier : emplacements, cotes,
-- récolement, nature des prêts (décret n° 2007-532 du 2 novembre 2007).
-- ============================================================================
--
-- 1. EMPLACEMENTS. Arborescence des locaux de conservation (art. 42 : dépôts
--    de pré-archivage) : dépôt → magasin → travée (épi) → tablette → boîte.
--    Chaque niveau porte un code court ; la COTE TOPOGRAPHIQUE d'une boîte est
--    la suite des codes (D1-M2-T03-E4-B0127). Une capacité en mètres
--    linéaires (ml) peut être donnée à un magasin ou une travée.
--
-- 2. DOCUMENTS PAPIER. Un document de la GED dit son support (numérique,
--    papier, hybride), la boîte qui le contient et sa cote dans la boîte : la
--    fiche dit OÙ est l'original. Un document papier peut n'avoir aucun
--    fichier (description seule).
--
-- 3. RÉCOLEMENT. Campagne de vérification d'un périmètre (un magasin, une
--    travée) : chaque boîte, chaque document attendu est constaté présent,
--    absent, déplacé, abîmé ou en prêt ; la clôture fige le procès-verbal de
--    récolement (son empreinte est conservée).
--
-- 4. PRÊTS (art. 35). « Le prêt à domicile des documents d'archives
--    originaux est interdit. Les prêts hors des dépôts […] sont toujours faits
--    sous forme de copie » ; le service versant peut, pendant la DUA, en
--    obtenir communication. Le prêt dit désormais sa NATURE (original, copie,
--    consultation sur place) et, s'il est connu, le document et la boîte
--    concernés. Un original versé aux archives publiques ne sort pas.
--
-- Idempotent. Retour arrière : docs/migrations/down/038_archives_physiques.down.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS emplacements (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES emplacements(id) ON DELETE RESTRICT,
    type VARCHAR(10) NOT NULL CHECK (type IN ('depot', 'magasin', 'travee', 'tablette', 'boite')),
    code VARCHAR(20) NOT NULL,
    libelle VARCHAR(150),
    capacite_ml NUMERIC(8, 2) CHECK (capacite_ml IS NULL OR capacite_ml >= 0),
    observations TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emplacements_code ON emplacements(tenant_id, COALESCE(parent_id, 0), lower(code));
CREATE INDEX IF NOT EXISTS idx_emplacements_parent ON emplacements(tenant_id, parent_id);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS support VARCHAR(10) NOT NULL DEFAULT 'numerique';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS emplacement_id INTEGER REFERENCES emplacements(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS cote_physique VARCHAR(60);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_support_check') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_support_check CHECK (support IN ('numerique', 'papier', 'hybride'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_documents_emplacement ON documents(emplacement_id) WHERE emplacement_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recolements (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    intitule VARCHAR(200) NOT NULL,
    emplacement_id INTEGER REFERENCES emplacements(id) ON DELETE SET NULL,   -- périmètre
    perimetre_libelle TEXT,                                                    -- cote du périmètre, figée
    statut VARCHAR(10) NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'clos')),
    ouvert_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ouvert_par_nom VARCHAR(150),
    ouvert_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    clos_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
    clos_par_nom VARCHAR(150),
    clos_at TIMESTAMPTZ,
    observations TEXT,
    empreinte CHAR(64)
);
CREATE INDEX IF NOT EXISTS idx_recolements_tenant ON recolements(tenant_id, ouvert_at DESC);

CREATE TABLE IF NOT EXISTS recolement_lignes (
    id SERIAL PRIMARY KEY,
    recolement_id INTEGER NOT NULL REFERENCES recolements(id) ON DELETE CASCADE,
    emplacement_id INTEGER REFERENCES emplacements(id) ON DELETE SET NULL,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    cote TEXT,                         -- figée à l'ouverture
    libelle TEXT,                      -- intitulé de la boîte ou du document, figé
    resultat VARCHAR(10) CHECK (resultat IS NULL OR resultat IN ('present', 'absent', 'deplace', 'abime', 'en_pret')),
    observation TEXT,
    constate_par_nom VARCHAR(150),
    constate_at TIMESTAMPTZ,
    ordre INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_recolement_lignes ON recolement_lignes(recolement_id, ordre);

-- Un récolement clos (et ses lignes) ne se modifie plus.
CREATE OR REPLACE FUNCTION recolements_inalterables() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  fige BOOLEAN;
BEGIN
  IF coalesce(current_setting('docuflow.audit_override', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME = 'recolements' THEN
    fige := OLD.statut = 'clos';
    IF fige AND TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'emplacement_id' - 'ouvert_par' - 'clos_par')
                                    = (to_jsonb(OLD) - 'emplacement_id' - 'ouvert_par' - 'clos_par') THEN
      RETURN NEW;
    END IF;
  ELSE
    SELECT r.statut = 'clos' INTO fige FROM recolements r WHERE r.id = OLD.recolement_id;
    IF coalesce(fige, false) AND TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'emplacement_id' - 'document_id')
                                                    = (to_jsonb(OLD) - 'emplacement_id' - 'document_id') THEN
      RETURN NEW;
    END IF;
  END IF;
  IF coalesce(fige, false) THEN
    RAISE EXCEPTION 'RECOLEMENT_CLOS: un récolement clos ne se modifie plus (% refusé)', TG_OP USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS trg_recolements_inalterables ON recolements;
CREATE TRIGGER trg_recolements_inalterables BEFORE UPDATE OR DELETE ON recolements
  FOR EACH ROW EXECUTE FUNCTION recolements_inalterables();
DROP TRIGGER IF EXISTS trg_recolement_lignes_inalterables ON recolement_lignes;
CREATE TRIGGER trg_recolement_lignes_inalterables BEFORE UPDATE OR DELETE ON recolement_lignes
  FOR EACH ROW EXECUTE FUNCTION recolements_inalterables();

ALTER TABLE request_loans ADD COLUMN IF NOT EXISTS nature VARCHAR(12) NOT NULL DEFAULT 'original';
ALTER TABLE request_loans ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE request_loans ADD COLUMN IF NOT EXISTS emplacement_id INTEGER REFERENCES emplacements(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_loans_nature_check') THEN
    ALTER TABLE request_loans ADD CONSTRAINT request_loans_nature_check CHECK (nature IN ('original', 'copie', 'consultation'));
  END IF;
END $$;
