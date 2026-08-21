/**
 * requestFieldService — champs du formulaire de demande, définis par organisation.
 *
 * CE QUE CE SERVICE REND POSSIBLE
 *
 * `requests` porte des colonnes figées. Ajouter « Numéro de TVA » ou « Personne
 * à contacter » pour une organisation exigeait une migration, donc une
 * intervention sur la base de production — hors de portée d'un administrateur.
 * Les définitions vivent désormais dans `request_field_definitions` (migration
 * 016) et les valeurs des champs ajoutés dans `request_field_values`.
 *
 * DEUX FAMILLES DE CHAMPS, ET LA FRONTIÈRE ENTRE ELLES
 *
 * Un champ SYSTÈME (`is_system`) désigne une colonne de `requests` que du code
 * lit nommément : `num_dossier` et `num_acte` forment la clé de rapprochement
 * documentaire, `nom_entreprise` alimente les e-mails, `type_document` est lu à
 * l'indexation. Il est renommable et masquable, jamais supprimable — la
 * contrainte est posée en base par trigger, pour qu'un appel direct à l'API
 * rencontre le même refus que l'interface.
 *
 * Un champ ORDINAIRE est créé par l'administrateur ; sa valeur va dans
 * `request_field_values`, en JSONB.
 *
 * POURQUOI LES CHOIX NE SONT PAS RECOPIÉS ICI
 *
 * Les listes de « type de document », « motif » et « priorité » vivent déjà dans
 * les réglages (groupe « requests » du catalogue), où l'administrateur les
 * modifie. Un champ qui les consomme porte `options_setting` — la CLÉ du
 * réglage — et non une copie des choix : dupliquer la liste en ferait une
 * seconde source de vérité, et le formulaire cesserait de suivre celle que
 * l'administrateur édite.
 */
const db = require('../config/db');
const catalog = require('../config/settingsCatalog');
const settingsService = require('./settingsService');
const { normalizeOptions } = require('../helpers/requestOptions');
const { optionsToCanonical, optionsToStrings, slugify } = require('./metadataService');

/**
 * Types acceptés par la colonne `field_type`.
 *
 * Recopiés du CHECK de la migration 016 : les valider ici transforme une
 * violation de contrainte — une erreur 500 dont le message PostgreSQL ne dit
 * rien à l'administrateur — en refus lisible.
 */
const FIELD_TYPES = [
  'text', 'textarea', 'number', 'date', 'boolean',
  'select', 'multiselect', 'user', 'document',
];

/**
 * Réglages dont un champ peut tirer ses choix.
 *
 * Liste blanche DÉRIVÉE du catalogue, et non écrite à la main : tout réglage
 * `editor: 'optionlist'` est une liste de { value, label }, donc exploitable
 * comme source de choix, et un nouveau réglage de ce type le devient sans
 * qu'on ait à y penser.
 *
 * La restriction est le point important. Sans elle, `options_setting` accepterait
 * n'importe quelle clé — y compris `smtp_password` : le formulaire afficherait
 * alors le contenu d'un réglage sensible dans un menu déroulant, à tout
 * utilisateur autorisé à créer une demande.
 */
const OPTION_SETTING_KEYS = catalog.CATALOG
  .filter((d) => d.editor === 'optionlist')
  .map((d) => d.key);

/**
 * Champs système dont la colonne de `requests` est NOT NULL SANS valeur de repli
 * côté serveur.
 *
 * CE QUE CETTE LISTE EMPÊCHE
 *
 * Masquer un champ le retire du formulaire ; le rendre facultatif laisse le
 * demandeur l'ignorer. Pour ces quatre-là, la conséquence n'est pas un champ vide
 * en base : `createRequest` transmet la valeur reçue telle quelle à une colonne
 * NOT NULL, et l'insertion échoue sur une violation de contrainte — c'est-à-dire
 * une erreur 500 dont le message PostgreSQL ne dit rien au demandeur, sur TOUTES
 * les demandes de l'organisation, jusqu'à ce qu'un administrateur devine le lien
 * avec un réglage modifié la semaine précédente.
 *
 * `motif` et `priorite` sont aussi NOT NULL mais ne figurent pas ici :
 * `createRequest` leur applique un repli explicite (premier choix de la liste,
 * priorité par défaut de l'organisation), donc leur absence du corps est déjà
 * rattrapée. `type_document` est nullable.
 *
 * La contrainte porte sur `system_column` et non sur `name` : c'est la colonne
 * visée qui est NOT NULL, et `system_column` est figée par trigger (migration
 * 016) alors que le libellé, lui, se renomme librement.
 */
const COLONNES_SYSTEME_REQUISES = new Set([
  'nom_entreprise', 'num_dossier', 'num_acte', 'annee',
]);

/** Un champ dont ni le masquage ni le passage en facultatif n'est admissible. */
function estIndispensable(field) {
  return field.is_system === true && COLONNES_SYSTEME_REQUISES.has(field.system_column);
}

/** Champs de la table exposés au frontend, dans l'ordre d'affichage. */
const SELECT_COLUMNS = `
  id, tenant_id, name, label, description, field_type, required, display_order,
  options_json, options_setting, default_value, min_length, max_length, pattern,
  placeholder, is_system, system_column, is_visible, created_at, updated_at`;

/**
 * Nom technique unique dans le périmètre de l'organisation (UNIQUE (tenant_id, name)).
 * @param {string} label
 * @param {Set<string>} taken noms déjà pris
 */
function uniqueFieldName(label, taken) {
  const base = slugify(label);
  let candidate = base;
  let i = 2;
  while (taken.has(candidate)) candidate = `${base}_${i++}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Ajoute à une définition la liste de choix EFFECTIVE.
 *
 * Le frontend reçoit ainsi `options` déjà résolu, qu'il vienne d'un réglage ou
 * de `options_json`. Sans cette résolution côté serveur, chaque appelant — le
 * formulaire, la validation, un futur export — devrait savoir lequel des deux
 * fait autorité, et le premier à l'oublier proposerait une liste vide.
 *
 * @param {object} row ligne de request_field_definitions
 * @param {object} settings réglages du tenant, déjà chargés
 */
function resolveOptions(row, settings = {}) {
  // `options_setting` l'emporte : c'est la source vivante, celle que
  // l'administrateur modifie dans la console de configuration.
  if (row.options_setting && OPTION_SETTING_KEYS.includes(row.options_setting)) {
    const definition = catalog.BY_KEY.get(row.options_setting);
    return normalizeOptions(
      settings[row.options_setting],
      definition?.default,
      // Les priorités portent un ton ; sans lui, les pastilles du formulaire
      // perdraient leur couleur (voir helpers/requestOptions).
      { withTone: definition?.withTone === true }
    );
  }
  return normalizeOptions(row.options_json, []);
}

/**
 * Projection d'une définition vers la forme attendue par le frontend.
 *
 * `type` double `field_type` : l'éditeur de schéma de métadonnées, réutilisé
 * pour ces champs, lit `type`. Exposer les deux évite de dupliquer l'éditeur
 * pour une différence de nom de colonne.
 */
function decorate(row, settings = {}) {
  const options = resolveOptions(row, settings);
  return {
    ...row,
    type: row.field_type,
    options,
    // Forme « chaînes » pour l'éditeur visuel, qui ne manipule que des libellés.
    optionLabels: optionsToStrings(options),
    // Dit au panneau d'administration que ce champ ne peut ni être masqué ni
    // devenir facultatif. Calculé ici plutôt que recopié côté frontend : une
    // seconde liste divergerait de celle-ci au premier changement de schéma, et
    // l'écran offrirait un geste que le serveur refuse.
    is_required_by_schema: estIndispensable(row),
  };
}

/**
 * Définitions des champs d'une organisation.
 *
 * @param {number} tenantId
 * @param {{ visibleOnly?: boolean }} options `visibleOnly` pour le formulaire,
 *   qui ne doit pas afficher les champs masqués ; l'éditeur, lui, les montre
 *   tous — sinon un champ masqué deviendrait impossible à réafficher.
 */
async function listFields(tenantId, { visibleOnly = false } = {}) {
  const conditions = ['tenant_id = $1'];
  if (visibleOnly) conditions.push('is_visible = TRUE');

  const result = await db.query(
    `SELECT ${SELECT_COLUMNS} FROM request_field_definitions
     WHERE ${conditions.join(' AND ')}
     ORDER BY display_order ASC, id ASC`,
    [tenantId]
  );

  // Un seul chargement des réglages pour toutes les lignes : les trois champs à
  // choix pointent vers des clés du même objet, et settingsService met en cache.
  const settings = await settingsService.getAll(tenantId);
  return result.rows.map((row) => decorate(row, settings));
}

/**
 * Valide et normalise une définition reçue du client.
 *
 * @param {object} field définition brute
 * @param {number} position rang dans le tableau, pour situer l'erreur
 * @returns {object} définition normalisée
 */
function normalizeDefinition(field, position) {
  const label = String(field.label || '').trim();
  if (!label) {
    throw new Error(`Le champ en position ${position + 1} n'a pas de libellé.`);
  }
  if (label.length > 150) {
    throw new Error(`Le libellé « ${label.slice(0, 30)}… » dépasse 150 caractères.`);
  }

  // `type` ou `field_type` : l'éditeur de métadonnées envoie `type`.
  const rawType = String(field.field_type || field.type || 'text').trim();
  if (!FIELD_TYPES.includes(rawType)) {
    throw new Error(`Type de champ inconnu pour « ${label} » : « ${rawType} ».`);
  }

  const optionsSetting = String(field.options_setting || '').trim() || null;
  if (optionsSetting && !OPTION_SETTING_KEYS.includes(optionsSetting)) {
    throw new Error(
      `Le champ « ${label} » désigne un réglage qui ne fournit pas de liste de choix : « ${optionsSetting} ».`
    );
  }

  // Une expression régulière invalide serait acceptée en base — la colonne est
  // du TEXT — puis lèverait à CHAQUE validation de demande, transformant un
  // réglage mal saisi en formulaire inutilisable.
  const pattern = String(field.pattern || '').trim() || null;
  if (pattern) {
    try {
      new RegExp(pattern);
    } catch {
      throw new Error(`Le motif de validation du champ « ${label} » n'est pas une expression régulière valide.`);
    }
  }

  const toInt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : null;
  };
  const minLength = toInt(field.min_length);
  const maxLength = toInt(field.max_length);
  // Bornes croisées : min > max rendrait toute saisie refusée, y compris une
  // saisie correcte, sans que rien à l'écran n'en explique la raison.
  if (minLength !== null && maxLength !== null && minLength > maxLength) {
    throw new Error(`Les bornes du champ « ${label} » sont inversées (min ${minLength} > max ${maxLength}).`);
  }

  return {
    label,
    description: String(field.description || '').trim() || null,
    fieldType: rawType,
    required: field.required === true,
    optionsSetting,
    // Un champ à choix qui tire d'un réglage n'a pas d'options propres : les
    // stocker en double laisserait deux listes divergentes.
    options: optionsSetting ? [] : field.options,
    defaultValue: field.default_value === undefined || field.default_value === null
      ? null
      : String(field.default_value),
    minLength,
    maxLength,
    pattern,
    placeholder: String(field.placeholder || '').trim() || null,
    isVisible: field.is_visible !== false,
  };
}

/**
 * Synchronise l'intégralité des champs d'une organisation depuis l'éditeur :
 * création, mise à jour, suppression des retirés, et réécriture de
 * `display_order` selon l'ordre du tableau reçu.
 *
 * Calqué sur metadataService.syncSchemaFields, avec trois différences que la
 * nature système impose :
 *
 *   1. Un champ système ABSENT du tableau n'est PAS supprimé — le trigger de la
 *      migration 016 refuserait la requête et ferait échouer tout
 *      l'enregistrement, y compris les modifications légitimes qui
 *      l'accompagnent. On le masque (`is_visible = FALSE`) : c'est ce que
 *      l'administrateur veut dire en le retirant du formulaire, et l'opération
 *      est réversible.
 *   2. `name` n'est jamais réécrit sur un champ existant : c'est la clé
 *      technique présente dans les exports et les valeurs déjà enregistrées.
 *   3. Un id fourni n'est retenu que s'il correspond à une ligne réelle de
 *      CETTE organisation. L'éditeur attribue aux nouveaux champs un id
 *      temporaire côté client (`Date.now()`), qui ne doit jamais être
 *      interprété comme une clé SQL — sinon un second enregistrement
 *      supprimerait puis recréerait le champ, et le ON DELETE CASCADE de
 *      `request_field_values` emporterait au passage les valeurs saisies sur
 *      toutes les demandes.
 *
 * @param {number} tenantId
 * @param {Array<object>} fields définitions dans l'ordre d'affichage voulu
 * @returns {Promise<Array>} l'état consolidé après synchronisation
 */
async function syncFields(tenantId, fields) {
  if (!Array.isArray(fields)) {
    throw new Error('La liste des champs est attendue sous forme de tableau.');
  }

  // Normalisation AVANT d'ouvrir la transaction : un refus de validation ne doit
  // pas laisser une transaction ouverte à annuler.
  const normalized = fields.map((field, i) => ({
    ...normalizeDefinition(field, i),
    rawId: field.id,
    displayOrder: i + 1,
  }));

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const currentRes = await client.query(
      `SELECT id, name, label, options_json, is_system, system_column
       FROM request_field_definitions WHERE tenant_id = $1`,
      [tenantId]
    );
    const currentById = new Map(currentRes.rows.map((r) => [String(r.id), r]));

    const keptIds = new Set();
    for (const field of normalized) {
      if (field.rawId !== undefined && field.rawId !== null && currentById.has(String(field.rawId))) {
        keptIds.add(String(field.rawId));
      }
    }

    // Champs retirés de l'éditeur. Les systèmes sont masqués, les autres
    // supprimés (leurs valeurs partent en cascade).
    const retires = currentRes.rows.filter((r) => !keptIds.has(String(r.id)));

    // Un champ indispensable retiré de l'éditeur ne peut pas être masqué : sa
    // colonne est NOT NULL sans repli. Le refus porte sur l'enregistrement entier
    // — masquer les autres et laisser celui-ci visible produirait un état que
    // l'administrateur n'a pas demandé et ne verrait pas.
    const indispensableRetire = retires.find(estIndispensable);
    if (indispensableRetire) {
      throw new Error(
        `Le champ « ${indispensableRetire.label} » ne peut pas être retiré du formulaire : sa valeur est indispensable à l'enregistrement d'une demande.`
      );
    }

    const aSupprimer = retires.filter((r) => !r.is_system).map((r) => r.id);
    const aMasquer = retires.filter((r) => r.is_system).map((r) => r.id);

    if (aSupprimer.length > 0) {
      await client.query(
        'DELETE FROM request_field_definitions WHERE id = ANY($1::int[]) AND tenant_id = $2',
        [aSupprimer, tenantId]
      );
    }
    if (aMasquer.length > 0) {
      await client.query(
        `UPDATE request_field_definitions
         SET is_visible = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE id = ANY($1::int[]) AND tenant_id = $2`,
        [aMasquer, tenantId]
      );
    }

    // Noms encore occupés après suppression, pour l'unicité des créations.
    const takenNames = new Set(
      currentRes.rows
        .filter((r) => keptIds.has(String(r.id)) || r.is_system)
        .map((r) => r.name)
    );

    for (const field of normalized) {
      const existant = keptIds.has(String(field.rawId))
        ? currentById.get(String(field.rawId))
        : null;

      // Options déjà en base : indispensables pour préserver les `value` des
      // options dont le libellé n'a pas changé. Sans elles, un simple
      // réordonnancement re-slugifierait chaque valeur et les
      // `request_field_values` déjà enregistrées ne correspondraient plus à
      // aucune option — la valeur cesserait de s'afficher.
      const previousOptions = existant?.options_json || [];
      const optionsJson = JSON.stringify(
        optionsToCanonical(field.options, previousOptions)
      );

      if (existant) {
        // Un champ indispensable reste obligatoire et visible, quoi qu'en dise
        // l'éditeur : le rendre facultatif laisserait le demandeur l'ignorer, et
        // sa colonne NOT NULL refuserait l'insertion. Le refus est explicite
        // plutôt que silencieux — corriger sans le dire ferait croire le réglage
        // appliqué, et l'administrateur reviendrait constater qu'il ne l'est pas.
        if (estIndispensable(existant) && (!field.required || !field.isVisible)) {
          throw new Error(
            `Le champ « ${existant.label} » doit rester obligatoire et visible : sa valeur est indispensable à l'enregistrement d'une demande.`
          );
        }

        // `name`, `is_system` et `system_column` sont volontairement absents du
        // SET : les deux derniers sont protégés par trigger, et réécrire le
        // premier romprait le lien avec les valeurs enregistrées.
        await client.query(
          `UPDATE request_field_definitions
           SET label = $2, description = $3, field_type = $4, required = $5,
               display_order = $6, options_json = $7, options_setting = $8,
               default_value = $9, min_length = $10, max_length = $11,
               pattern = $12, placeholder = $13, is_visible = $14,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND tenant_id = $15`,
          [
            existant.id, field.label, field.description, field.fieldType,
            field.required, field.displayOrder, optionsJson, field.optionsSetting,
            field.defaultValue, field.minLength, field.maxLength,
            field.pattern, field.placeholder, field.isVisible, tenantId,
          ]
        );
      } else {
        await client.query(
          `INSERT INTO request_field_definitions
             (tenant_id, name, label, description, field_type, required, display_order,
              options_json, options_setting, default_value, min_length, max_length,
              pattern, placeholder, is_system, system_column, is_visible)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, FALSE, NULL, $15)`,
          [
            tenantId, uniqueFieldName(field.label, takenNames), field.label,
            field.description, field.fieldType, field.required, field.displayOrder,
            optionsJson, field.optionsSetting, field.defaultValue,
            field.minLength, field.maxLength, field.pattern, field.placeholder,
            field.isVisible,
          ]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Relu hors transaction : listFields consulte les réglages, qui vivent en
  // dehors de ce périmètre.
  return listFields(tenantId);
}

/**
 * Rend visible un champ système précédemment masqué.
 *
 * Existe séparément parce que masquer se fait en retirant le champ de l'éditeur,
 * mais que réafficher n'a pas d'équivalent : un champ absent de la liste ne peut
 * pas y être glissé de nouveau.
 */
async function setVisibility(tenantId, fieldId, isVisible) {
  // Refus AVANT l'UPDATE : la colonne visée est NOT NULL et n'a pas de repli, donc
  // masquer ce champ transformerait chaque création de demande en erreur 500.
  if (isVisible !== true) {
    const cible = await db.query(
      'SELECT label, is_system, system_column FROM request_field_definitions WHERE id = $1 AND tenant_id = $2',
      [fieldId, tenantId]
    );
    if (cible.rowCount === 0) return null;
    if (estIndispensable(cible.rows[0])) {
      throw new Error(
        `Le champ « ${cible.rows[0].label} » ne peut pas être masqué : sa valeur est indispensable à l'enregistrement d'une demande.`
      );
    }
  }

  const result = await db.query(
    `UPDATE request_field_definitions
     SET is_visible = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND tenant_id = $2
     RETURNING ${SELECT_COLUMNS}`,
    [fieldId, tenantId, isVisible === true]
  );
  if (result.rowCount === 0) return null;
  const settings = await settingsService.getAll(tenantId);
  return decorate(result.rows[0], settings);
}

/**
 * Provisionne les sept champs d'origine pour une organisation qui n'en a aucun.
 *
 * Les organisations créées avant la migration 016 en ont déjà (elle les
 * rattrape), mais une base restaurée depuis une sauvegarde antérieure, ou une
 * organisation créée par un chemin qui n'appelle pas `provision_tenant_defaults`,
 * se retrouverait avec un formulaire vide. On appelle la fonction SQL plutôt que
 * de recopier les sept INSERT : deux définitions du même jeu de champs
 * divergeraient à la première modification.
 */
async function provisionDefaults(tenantId) {
  await db.query('SELECT provision_request_fields($1)', [tenantId]);
  return listFields(tenantId);
}

// ============================================================================
// VALEURS
// ============================================================================

/**
 * Valide une valeur contre sa définition et la renvoie sous sa forme stockable.
 *
 * Renvoie la valeur COERCÉE et ne se contente pas de valider : `<input
 * type="number">` transmet du texte, et une case à cocher non touchée n'envoie
 * rien du tout. Stocker « 2024 » là où un nombre est attendu ferait échouer
 * ensuite toute comparaison numérique en JSONB.
 *
 * @param {object} field définition décorée (avec `options` résolues)
 * @param {*} raw valeur reçue
 * @returns {*} valeur normalisée, prête pour value_json
 * @throws {Error} message destiné à l'utilisateur
 */
function coerceValue(field, raw) {
  const libelle = field.label;
  const vide = raw === null || raw === undefined || raw === '';

  if (vide) {
    // Un booléen absent vaut « non coché » : l'exiger obligerait à cocher une
    // case pour la décocher.
    if (field.field_type === 'boolean') return false;
    if (field.required) throw new Error(`Le champ « ${libelle} » est obligatoire.`);
    return null;
  }

  switch (field.field_type) {
    case 'text':
    case 'textarea': {
      const value = String(raw);
      if (field.min_length !== null && field.min_length !== undefined && value.length < field.min_length) {
        throw new Error(`Le champ « ${libelle} » doit contenir au moins ${field.min_length} caractères.`);
      }
      if (field.max_length !== null && field.max_length !== undefined && value.length > field.max_length) {
        throw new Error(`Le champ « ${libelle} » ne peut pas dépasser ${field.max_length} caractères.`);
      }
      if (field.pattern) {
        // Le motif a été validé à l'enregistrement de la définition ; ce garde
        // couvre une valeur écrite directement en base.
        let regex = null;
        try {
          regex = new RegExp(field.pattern);
        } catch {
          regex = null;
        }
        if (regex && !regex.test(value)) {
          throw new Error(`Le champ « ${libelle} » ne respecte pas le format attendu.`);
        }
      }
      return value;
    }

    case 'number': {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new Error(`Le champ « ${libelle} » doit être un nombre.`);
      }
      return value;
    }

    case 'date': {
      const value = String(raw);
      if (Number.isNaN(Date.parse(value))) {
        throw new Error(`Le champ « ${libelle} » doit être une date valide.`);
      }
      return value;
    }

    case 'boolean':
      // 'false' est une chaîne non vide, donc vraie pour Boolean() : un champ
      // décoché transmis en texte serait enregistré comme coché.
      return raw === true || raw === 'true' || raw === 1 || raw === '1';

    case 'select': {
      const value = String(raw);
      const admises = (field.options || []).map((o) => o.value);
      if (!admises.includes(value)) {
        throw new Error(`Valeur non proposée pour « ${libelle} » : « ${value} ».`);
      }
      return value;
    }

    case 'multiselect': {
      const values = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      const admises = (field.options || []).map((o) => o.value);
      for (const value of values) {
        if (!admises.includes(value)) {
          throw new Error(`Valeur non proposée pour « ${libelle} » : « ${value} ».`);
        }
      }
      return values;
    }

    case 'user':
    case 'document': {
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Le champ « ${libelle} » attend une référence valide.`);
      }
      return value;
    }

    default:
      return raw;
  }
}

/**
 * Répartit les valeurs reçues entre colonnes de `requests` et champs
 * personnalisés, en validant chacune.
 *
 * Le contrôleur de création appelle cette fonction avant d'insérer : elle lui
 * rend d'un côté ce qui va dans les colonnes, de l'autre ce qui va dans
 * `request_field_values`. Sans cette répartition, il devrait connaître le
 * caractère système de chaque champ — une connaissance qui vit en base.
 *
 * Les valeurs des champs SYSTÈME ne sont pas revalidées ici : `type_document`,
 * `motif` et `priorite` le sont déjà par requestController contre les listes de
 * l'organisation, avec des messages propres à ces trois champs. Les valider
 * deux fois ferait diverger les deux messages au premier ajustement.
 *
 * @param {number} tenantId
 * @param {object} body corps de la requête
 * @returns {Promise<{ customValues: Array<{fieldId: number, value: *}>, missing: string[] }>}
 */
async function collectValues(tenantId, body = {}) {
  const fields = await listFields(tenantId, { visibleOnly: true });
  const customValues = [];
  const missing = [];

  for (const field of fields) {
    if (field.is_system) continue;

    // La clé technique est ce que le formulaire envoie ; `field_<id>` couvre un
    // client qui préfère l'identifiant numérique.
    const brut = Object.prototype.hasOwnProperty.call(body, field.name)
      ? body[field.name]
      : body[`field_${field.id}`];

    let value;
    try {
      value = coerceValue(field, brut);
    } catch (err) {
      missing.push(err.message);
      continue;
    }

    // Un champ laissé vide et facultatif ne produit PAS de ligne : insérer un
    // null occuperait une ligne par champ vide et par demande, et rendrait
    // indistinguables « non renseigné » et « effacé ».
    if (value === null) continue;
    customValues.push({ fieldId: field.id, value });
  }

  return { customValues, missing };
}

/**
 * Écrit les valeurs des champs personnalisés d'une demande.
 *
 * @param {number} requestId
 * @param {Array<{fieldId: number, value: *}>} values
 * @param {object} [client] client de transaction, si l'appelant en tient une
 */
async function saveValues(requestId, values, client = null) {
  if (!Array.isArray(values) || values.length === 0) return;
  const run = client || db;

  for (const entry of values) {
    await run.query(
      `INSERT INTO request_field_values (request_id, field_id, value_json, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (request_id, field_id)
       DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = CURRENT_TIMESTAMP`,
      [requestId, entry.fieldId, JSON.stringify(entry.value)]
    );
  }
}

/**
 * Valeurs des champs personnalisés d'une demande, prêtes à l'affichage.
 *
 * Le JOIN sur `tenant_id` n'est pas décoratif : `request_field_values` ne porte
 * pas de tenant, et un identifiant de demande d'une autre organisation
 * renverrait ses valeurs sans lui.
 *
 * @returns {Promise<Array<{name, label, field_type, value, display_order}>>}
 */
async function getValues(tenantId, requestId) {
  const result = await db.query(
    `SELECT d.id AS field_id, d.name, d.label, d.field_type, d.display_order,
            d.options_json, d.options_setting, d.is_visible, v.value_json
     FROM request_field_values v
     JOIN request_field_definitions d ON v.field_id = d.id
     WHERE v.request_id = $1 AND d.tenant_id = $2
     ORDER BY d.display_order ASC, d.id ASC`,
    [requestId, tenantId]
  );
  if (result.rowCount === 0) return [];

  const settings = await settingsService.getAll(tenantId);
  return result.rows.map((row) => {
    const options = resolveOptions(row, settings);
    const value = row.value_json;
    // Pour un champ à choix, on rend aussi le LIBELLÉ : la valeur stockée est
    // une clé technique (« en_cours »), et l'afficher telle quelle donnerait à
    // lire un identifiant là où l'utilisateur attend son intitulé.
    const correspondance = Array.isArray(value)
      ? options.filter((o) => value.includes(o.value)).map((o) => o.label)
      : options.find((o) => o.value === value)?.label;

    return {
      field_id: row.field_id,
      name: row.name,
      label: row.label,
      field_type: row.field_type,
      display_order: row.display_order,
      is_visible: row.is_visible,
      value,
      valueLabel: Array.isArray(correspondance)
        ? correspondance.join(', ')
        : (correspondance ?? null),
    };
  });
}

/**
 * Indique si les tables de la migration 016 existent.
 *
 * Les appelants s'en servent pour rester fonctionnels sur une base non encore
 * migrée : le formulaire retombe alors sur ses sept champs d'origine plutôt que
 * de renvoyer une erreur. Sans ce contrôle, déployer le code avant la migration
 * rendrait la création de demande impossible.
 */
async function isAvailable() {
  try {
    const res = await db.query("SELECT to_regclass('request_field_definitions') AS t");
    return res.rows[0]?.t !== null;
  } catch {
    return false;
  }
}

module.exports = {
  FIELD_TYPES,
  OPTION_SETTING_KEYS,
  listFields,
  syncFields,
  setVisibility,
  provisionDefaults,
  collectValues,
  saveValues,
  getValues,
  isAvailable,
  // Exposés pour les épreuves : la coercition est la partie où une régression
  // passe inaperçue le plus longtemps.
  coerceValue,
  normalizeDefinition,
};
