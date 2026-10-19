-- ============================================================================
-- 023_request_quick.sql — Demander un document sans en connaître les références
-- ============================================================================
-- LA DEMANDE FONDATRICE : « à n'importe quel niveau, n'importe qui doit pouvoir
-- demander un document facilement ». Deux obstacles en base :
--
-- 1. QUATRE RÉFÉRENCES OBLIGATOIRES. `nom_entreprise`, `num_dossier`,
--    `num_acte` et `annee` étaient NOT NULL : pour demander un document, il
--    fallait déjà connaître son numéro de dossier ET son numéro d'acte. Le
--    collaborateur qui cherche « le contrat de bail du local de Cotonou »
--    n'avait aucun moyen de le dire. Les contraintes sont levées ; la règle
--    applicative (requestController.createRequest) exige désormais qu'une
--    demande soit IDENTIFIABLE — une description OU une référence — et non
--    qu'elle porte les quatre.
--    Les demandes existantes ont toutes leurs références : rien ne change pour
--    elles.
--
-- 2. DEUX RÔLES SANS DROIT DE DEMANDER. `archiviste` et `lecteur` ne portaient
--    pas requests.create. La permission leur est ajoutée — sur les rôles
--    SYSTÈME seulement, et seulement s'ils ne l'ont pas : un rôle personnalisé
--    reste tel que son organisation l'a composé.
--
-- Colonnes ajoutées à `requests` :
--   description       — « Que cherchez-vous ? », en langage courant ;
--   date_souhaitee    — date à laquelle le demandeur en a besoin ;
--   beneficiaire      — demande faite pour le compte de quelqu'un (nom libre :
--                       un collègue, un client, un service) ;
--   source_request_id — demande dont celle-ci est la reprise (« Redemander »).
--
-- Idempotent. Retour arrière : docs/migrations/down/023_request_quick.down.sql
-- (hors du dossier lu par migrate.js, donc jamais exécuté par erreur).
-- ============================================================================

ALTER TABLE requests ALTER COLUMN nom_entreprise DROP NOT NULL;
ALTER TABLE requests ALTER COLUMN num_dossier DROP NOT NULL;
ALTER TABLE requests ALTER COLUMN num_acte DROP NOT NULL;
ALTER TABLE requests ALTER COLUMN annee DROP NOT NULL;

ALTER TABLE requests ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS date_souhaitee DATE;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS beneficiaire VARCHAR(255);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS source_request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL;

-- Garde-fou en base de la règle « identifiable » : une demande sans
-- description ni aucune référence ne désigne rien. NOT VALID : les lignes
-- existantes ne sont pas relues (elles ont toutes leurs références, la
-- contrainte NOT NULL l'imposait) ; seules les nouvelles écritures sont
-- contrôlées.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requests_identifiable') THEN
    ALTER TABLE requests ADD CONSTRAINT requests_identifiable CHECK (
      COALESCE(NULLIF(btrim(description), ''), NULLIF(btrim(nom_entreprise), ''),
               NULLIF(btrim(num_dossier), ''), NULLIF(btrim(num_acte), '')) IS NOT NULL
    ) NOT VALID;
  END IF;
END $$;

-- Les champs système de la définition de formulaire (016) restaient marqués
-- obligatoires parce que leur colonne était NOT NULL. Ils le restent pour les
-- organisations qui l'ont voulu — ce réglage n'est pas modifié ici : le
-- formulaire COMPLET continue de les exiger, seule la demande rapide s'en
-- passe.

-- Droit de demander pour tous les rôles système.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'roles') THEN
    UPDATE roles
       SET permissions = array_append(permissions, 'requests.create')
     WHERE is_system
       AND key IN ('archiviste', 'lecteur')
       AND NOT ('requests.create' = ANY(permissions))
       AND NOT ('*' = ANY(permissions));
  END IF;
END $$;
