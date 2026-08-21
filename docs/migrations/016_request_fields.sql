-- ============================================================================
-- 016_request_fields.sql — Champs de demande configurables par organisation
-- ============================================================================
-- Objectif : permettre à un administrateur d'AJOUTER, RENOMMER, RÉORDONNER et
-- SUPPRIMER les champs du formulaire de demande, sans redéploiement.
--
-- Constat corrigé ici : `requests` porte 18 colonnes figées. Ajouter « Numéro de
-- TVA » ou « Personne à contacter » pour une organisation exigeait une migration,
-- donc une intervention sur la base de production — ce qu'aucun administrateur
-- ne peut faire lui-même. Les listes de choix sont déjà configurables depuis les
-- réglages (groupe « requests » du catalogue) ; ce qui manquait, c'est la
-- possibilité de définir de NOUVEAUX champs.
--
-- ---------------------------------------------------------------------------
-- POURQUOI DEUX TABLES ET NON UNE COLONNE JSONB SUR `requests`
-- ---------------------------------------------------------------------------
-- Un simple `custom_fields JSONB` aurait suffi à stocker les valeurs, mais il
-- n'aurait rien décrit : ni libellé, ni type, ni ordre, ni caractère
-- obligatoire. L'interface aurait dû deviner comment présenter chaque clé, et
-- deux organisations utilisant la même clé pour des choses différentes se
-- seraient mélangées. Le couple définitions / valeurs reprend donc exactement le
-- schéma éprouvé de `metadata_fields` / `metadata_values` (migration 010), dont
-- l'éditeur de schéma frontend est déjà écrit.
--
-- `metadata_values` n'a pas pu être réutilisée telle quelle : sa colonne
-- `document_id INTEGER NOT NULL REFERENCES documents(id)` la lie aux documents.
-- Une demande n'est pas un document — elle en précède un.
--
-- ---------------------------------------------------------------------------
-- POURQUOI LES QUATRE CHAMPS SYSTÈME RESTENT DES COLONNES
-- ---------------------------------------------------------------------------
-- `nom_entreprise`, `num_dossier`, `num_acte` et `type_document` ne sont PAS
-- déplacés dans les nouvelles tables, et ne peuvent pas l'être :
--   * `num_dossier` + `num_acte` forment la clé de rapprochement avec le
--     référentiel documentaire (findMatchingDocument) ;
--   * `nom_entreprise` alimente les notifications et les e-mails ;
--   * `type_document` est lu par documentIndexService à l'indexation.
-- Une quinzaine de requêtes SQL les nomment directement. Les rendre
-- supprimables casserait ces lectures en silence. Ils sont donc déclarés ici
-- avec `is_system = TRUE` : masquables et renommables, jamais supprimables. La
-- contrainte est posée en base (trigger), pas seulement dans l'interface : un
-- appel direct à l'API doit se heurter au même refus.
--
-- Idempotent : peut être exécuté sur base neuve ou existante, plusieurs fois.
-- Prérequis : 001 (tenants), 013 (provision_tenant_defaults).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Définitions des champs de demande (par organisation)
-- ----------------------------------------------------------------------------
-- Les types reprennent ceux de `metadata_fields` afin que l'éditeur de schéma
-- frontend puisse servir aux deux. `user` désigne un compte de l'organisation ;
-- `document` une référence à un document déjà indexé.
CREATE TABLE IF NOT EXISTS request_field_definitions (
    id              SERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- `name` est la clé technique : elle part dans les exports et les URL, et ne
    -- doit donc plus changer une fois des valeurs enregistrées. `label` est ce
    -- que lit l'utilisateur et peut être reformulé librement. Confondre les deux
    -- rendrait tout renommage destructeur.
    name            VARCHAR(100) NOT NULL,
    label           VARCHAR(150) NOT NULL,
    description     TEXT,

    field_type      VARCHAR(30) NOT NULL DEFAULT 'text'
                    CHECK (field_type IN ('text','textarea','number','date','boolean','select','multiselect','user','document')),
    required        BOOLEAN DEFAULT FALSE,
    display_order   INTEGER DEFAULT 0,

    -- Pour select / multiselect : [{value,label}]. Même forme que
    -- metadata_fields.options_json et que les réglages du groupe « requests »,
    -- pour que la normalisation de helpers/requestOptions.js s'y applique.
    options_json    JSONB DEFAULT '[]'::jsonb,
    -- Quand les choix viennent d'un réglage de l'organisation (groupe
    -- « requests » du catalogue), on stocke la CLÉ du réglage et non les choix
    -- eux-mêmes : les recopier ici créerait une seconde source de vérité, et la
    -- liste du formulaire cesserait de suivre celle que l'administrateur modifie.
    options_setting VARCHAR(100),
    default_value   TEXT,

    -- Contraintes de saisie, laissées à NULL quand elles n'ont pas de sens pour
    -- le type. Vérifiées par l'application : les exprimer en CHECK exigerait une
    -- contrainte par champ, impossible sur une table de définitions.
    min_length      INTEGER,
    max_length      INTEGER,
    pattern         TEXT,            -- expression régulière de validation
    placeholder     VARCHAR(200),

    -- Un champ système correspond à une colonne de `requests` lue par du code.
    -- Il peut être masqué du formulaire ou renommé, jamais supprimé.
    is_system       BOOLEAN DEFAULT FALSE,
    -- La colonne de `requests` alimentée par ce champ. NULL pour un champ ajouté
    -- par l'administrateur, dont la valeur va dans request_field_values.
    system_column   VARCHAR(50),
    is_visible      BOOLEAN DEFAULT TRUE,

    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_request_fields_tenant ON request_field_definitions(tenant_id, display_order);

-- Un champ système SANS colonne cible serait un champ que rien ne remplit et que
-- personne ne peut supprimer : une impasse. Un champ ordinaire AVEC colonne
-- cible écrirait dans `requests` sans que le code l'ait prévu.
DO $$
BEGIN
    ALTER TABLE request_field_definitions
      ADD CONSTRAINT request_fields_system_column_coherent
      CHECK ((is_system AND system_column IS NOT NULL) OR (NOT is_system AND system_column IS NULL));
EXCEPTION WHEN duplicate_object THEN
    NULL;  -- déjà posée par une exécution antérieure
END $$;

-- ----------------------------------------------------------------------------
-- 2. Valeurs des champs personnalisés (par demande)
-- ----------------------------------------------------------------------------
-- Ne contient QUE les champs non système : les quatre autres restent dans leurs
-- colonnes. Stocker les deux ici dupliquerait la vérité et laisserait les deux
-- copies diverger au premier UPDATE oublié.
CREATE TABLE IF NOT EXISTS request_field_values (
    id          SERIAL PRIMARY KEY,
    request_id  INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    field_id    INTEGER NOT NULL REFERENCES request_field_definitions(id) ON DELETE CASCADE,

    -- JSONB et non TEXT : un champ `multiselect` porte un tableau, un `boolean`
    -- un booléen. Sérialiser en texte obligerait chaque lecture à savoir de quel
    -- type il s'agit pour désérialiser correctement.
    value_json  JSONB,

    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Une demande ne peut porter qu'une valeur par champ ; l'unicité permet
    -- surtout l'écriture idempotente (ON CONFLICT DO UPDATE) à la modification.
    UNIQUE (request_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_request_field_values_request ON request_field_values(request_id);
CREATE INDEX IF NOT EXISTS idx_request_field_values_field ON request_field_values(field_id);

-- ----------------------------------------------------------------------------
-- 3. Garde-fou : un champ système ne se supprime pas
-- ----------------------------------------------------------------------------
-- Posé en base et non dans le contrôleur : la suppression peut venir d'un appel
-- direct à l'API, d'un script de reprise ou d'une console SQL. Le CASCADE depuis
-- `tenants` reste possible — supprimer une organisation doit rester faisable, et
-- ses champs disparaissent alors légitimement.
CREATE OR REPLACE FUNCTION prevent_system_request_field_deletion()
RETURNS TRIGGER AS $$
BEGIN
    -- Si l'organisation elle-même s'en va, la suppression est légitime : on ne
    -- la bloque pas, sinon aucun tenant ne pourrait plus être supprimé.
    IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
        RAISE EXCEPTION 'Le champ « % » est un champ système : il peut être masqué (is_visible = FALSE) mais pas supprimé.', OLD.label;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_request_field_no_system_delete ON request_field_definitions;
CREATE TRIGGER trg_request_field_no_system_delete
    BEFORE DELETE ON request_field_definitions
    FOR EACH ROW WHEN (OLD.is_system)
    EXECUTE FUNCTION prevent_system_request_field_deletion();

-- Un champ système ne doit pas non plus changer de nature : basculer `is_system`
-- à FALSE contournerait le garde-fou ci-dessus en une seule requête.
CREATE OR REPLACE FUNCTION prevent_system_request_field_downgrade()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_system AND NOT NEW.is_system THEN
        RAISE EXCEPTION 'Le champ « % » ne peut pas cesser d''être un champ système.', OLD.label;
    END IF;
    IF OLD.is_system AND NEW.system_column IS DISTINCT FROM OLD.system_column THEN
        RAISE EXCEPTION 'La colonne cible du champ système « % » ne peut pas être modifiée.', OLD.label;
    END IF;
    -- `name` est la clé technique présente dans les exports : la changer après
    -- coup rendrait illisibles les valeurs déjà enregistrées ailleurs.
    IF OLD.is_system AND NEW.name IS DISTINCT FROM OLD.name THEN
        RAISE EXCEPTION 'Le nom technique du champ système « % » est figé ; son libellé, lui, est modifiable.', OLD.label;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_request_field_no_system_downgrade ON request_field_definitions;
CREATE TRIGGER trg_request_field_no_system_downgrade
    BEFORE UPDATE ON request_field_definitions
    FOR EACH ROW EXECUTE FUNCTION prevent_system_request_field_downgrade();

-- ----------------------------------------------------------------------------
-- 4. Provisionnement des champs par défaut d'une organisation
-- ----------------------------------------------------------------------------
-- Les sept champs actuels du formulaire sont déclarés tels qu'ils existent
-- AUJOURD'HUI, afin que rien ne change à l'écran après cette migration : le
-- formulaire lira ces définitions et retrouvera exactement les champs qu'il
-- affichait en dur. Une migration qui modifie l'apparence au moment où elle
-- passe est une migration dont on ne sait plus distinguer les effets.
--
-- Les listes de choix (type de document, motif, priorité) ne sont PAS recopiées
-- dans options_json : elles vivent déjà dans les réglages du groupe
-- « requests », et les dupliquer créerait deux sources de vérité. Le champ porte
-- `options_setting` pour désigner le réglage à lire.
--
-- Le ADD COLUMN ci-dessous ne sert qu'aux bases où une version antérieure de
-- cette migration a créé la table sans cette colonne : le CREATE TABLE plus haut
-- est ignoré si la table existe, et la colonne manquerait alors aux INSERT.
ALTER TABLE request_field_definitions
  ADD COLUMN IF NOT EXISTS options_setting VARCHAR(100);

COMMENT ON COLUMN request_field_definitions.options_setting IS
  'Clé de réglage fournissant les choix (ex. request_document_types). Prioritaire sur options_json, qui sert aux champs ajoutés à la main.';

CREATE OR REPLACE FUNCTION provision_request_fields(p_tenant_id INTEGER)
RETURNS void AS $$
BEGIN
    INSERT INTO request_field_definitions
      (tenant_id, name, label, description, field_type, required, display_order,
       is_system, system_column, options_setting, placeholder)
    VALUES
      -- Les quatre premiers sont les champs système : colonnes de `requests`
      -- lues par le rapprochement documentaire, les notifications et l'indexation.
      (p_tenant_id, 'nom_entreprise', 'Nom de l''entreprise',
       'Raison sociale figurant sur le dossier.',            'text',   TRUE,  1, TRUE,  'nom_entreprise', NULL, 'Ex. SOBEMAP SA'),
      (p_tenant_id, 'num_dossier',    'Numéro de dossier',
       'Identifiant du dossier au greffe.',                  'text',   TRUE,  2, TRUE,  'num_dossier',    NULL, 'Ex. RCCM/BJ/2024/1234'),
      (p_tenant_id, 'num_acte',       'Numéro d''acte',
       'Numéro de l''acte recherché dans le dossier.',       'text',   TRUE,  3, TRUE,  'num_acte',       NULL, 'Ex. A-2024-089'),
      (p_tenant_id, 'type_document',  'Type de document',
       'Nature du document demandé.',                        'select', FALSE, 4, TRUE,  'type_document',  'request_document_types', NULL),
      -- Les trois suivants sont aussi des colonnes, mais aucune lecture de code
      -- ne les traite comme clé : ils restent système par prudence (la colonne
      -- `motif` est NOT NULL et `annee` alimente les regroupements par millésime).
      (p_tenant_id, 'annee',          'Année',
       'Millésime de l''acte.',                              'number', TRUE,  5, TRUE,  'annee',          NULL, NULL),
      (p_tenant_id, 'motif',          'Motif de la demande',
       'Raison pour laquelle le document est demandé.',      'select', TRUE,  6, TRUE,  'motif',          'request_motifs', NULL),
      (p_tenant_id, 'priorite',       'Priorité',
       'Degré d''urgence du traitement.',                    'select', TRUE,  7, TRUE,  'priorite',       'request_priorities', NULL)
    ON CONFLICT (tenant_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 5. Rattachement au provisionnement existant
-- ----------------------------------------------------------------------------
-- `provision_tenant_defaults` est appelée à l'inscription
-- (authController.registerCompany). Plutôt que de recopier son corps — ce qui
-- ferait diverger les deux versions dès la prochaine migration —, on l'enveloppe :
-- l'ancienne fonction est renommée, et la nouvelle l'appelle puis ajoute les
-- champs de demande.
--
-- Le renommage n'a lieu QUE si l'enveloppe n'existe pas déjà, sans quoi une
-- seconde exécution envelopperait l'enveloppe et provoquerait une récursion.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'provision_tenant_defaults_base'
    ) THEN
        ALTER FUNCTION provision_tenant_defaults(INTEGER, TEXT)
          RENAME TO provision_tenant_defaults_base;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION provision_tenant_defaults(p_tenant_id INTEGER, p_company_name TEXT DEFAULT NULL)
RETURNS void AS $$
BEGIN
    PERFORM provision_tenant_defaults_base(p_tenant_id, p_company_name);
    PERFORM provision_request_fields(p_tenant_id);
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 6. Rattrapage des organisations existantes
-- ----------------------------------------------------------------------------
-- Seuls les champs de demande sont provisionnés ici : rejouer tout
-- `provision_tenant_defaults` serait inutile (la 013 l'a déjà fait) et
-- rallongerait la migration sur une base peuplée.
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id FROM tenants ORDER BY id LOOP
        PERFORM provision_request_fields(t.id);
    END LOOP;
END $$;

-- ============================================================================
-- ROLLBACK (à exécuter manuellement en cas de retour arrière)
-- ============================================================================
-- Rétablir d'abord la fonction d'origine, sinon elle appellerait une fonction
-- de provisionnement de champs supprimée :
--
-- DROP FUNCTION IF EXISTS provision_tenant_defaults(INTEGER, TEXT);
-- ALTER FUNCTION provision_tenant_defaults_base(INTEGER, TEXT)
--   RENAME TO provision_tenant_defaults;
-- DROP FUNCTION IF EXISTS provision_request_fields(INTEGER);
--
-- Puis les tables. Le trigger tombe avec la table qui le porte :
--
-- DROP TABLE IF EXISTS request_field_values;
-- DROP TABLE IF EXISTS request_field_definitions;
-- DROP FUNCTION IF EXISTS prevent_system_request_field_deletion();
-- DROP FUNCTION IF EXISTS prevent_system_request_field_downgrade();
--
-- Les valeurs des champs personnalisés sont perdues à ce retour arrière : elles
-- n'ont pas de colonne d'accueil dans `requests`. À exporter avant, si besoin.
-- ============================================================================
-- Fin de la migration
-- ============================================================================
