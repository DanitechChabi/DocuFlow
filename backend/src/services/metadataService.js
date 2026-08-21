/**
 * metadataService — Gestion des schémas de métadonnées typées et des valeurs associées aux documents.
 */
const db = require('../config/db');

/**
 * Normalise options_json (stocké en [{value,label}]) vers une liste de chaînes
 * exploitable par l'éditeur front (MetadataSchemaEditor).
 * @param {any} optionsJson
 * @returns {string[]}
 */
function optionsToStrings(optionsJson) {
  if (!Array.isArray(optionsJson)) return [];
  return optionsJson
    .map((opt) => {
      if (opt === null || opt === undefined) return null;
      if (typeof opt === 'string') return opt;
      if (typeof opt === 'object') return opt.label || opt.value || null;
      return String(opt);
    })
    .filter(Boolean);
}

/**
 * Convertit une liste d'options (chaînes ou objets) vers la forme canonique
 * [{value, label}] attendue par la colonne options_json.
 *
 * `previous` est la valeur actuellement en base pour ce champ. Elle est
 * indispensable : l'éditeur ne manipule que des libellés (voir
 * optionsToStrings), donc sans elle on re-déduit chaque `value` en slugifiant le
 * libellé — ce qui ne redonne l'original que si l'un est exactement le slug de
 * l'autre. Une option { value: 'en_cours', label: 'En cours de validation' }
 * devenait ainsi 'en_cours_de_validation' au premier enregistrement du schéma,
 * y compris lors d'un simple réordonnancement par glisser-déposer. Les
 * `metadata_values` des documents stockent la *valeur* : elles ne correspondaient
 * alors plus à aucune option, et la métadonnée cessait de s'afficher.
 *
 * @param {any} options
 * @param {Array<{value: string, label: string}>} [previous] options déjà en base
 * @returns {Array<{value: string, label: string}>}
 */
function optionsToCanonical(options, previous = []) {
  if (!Array.isArray(options)) return [];
  // Index libellé → valeur existante, pour retrouver la valeur d'origine d'un
  // libellé inchangé.
  const valueByLabel = new Map();
  if (Array.isArray(previous)) {
    for (const opt of previous) {
      if (opt && typeof opt === 'object' && opt.label && opt.value) {
        valueByLabel.set(String(opt.label), String(opt.value));
      }
    }
  }
  // Deux libellés distincts peuvent produire le même slug (« Validé », « valide »,
  // « VALIDE ») : sans suffixe de désambiguïsation, les options devenaient
  // indiscernables par leur valeur et un select affichait la mauvaise entrée pour
  // la valeur stockée. On garantit donc l'unicité des `value`.
  const usedValues = new Set();
  const uniqueValue = (candidate) => {
    let value = candidate;
    let i = 2;
    while (usedValues.has(value)) value = `${candidate}_${i++}`;
    usedValues.add(value);
    return value;
  };
  return options
    .map((opt) => {
      if (typeof opt === 'string') {
        const label = opt.trim();
        if (!label) return null;
        return { value: uniqueValue(valueByLabel.get(label) || slugify(label)), label };
      }
      if (opt && typeof opt === 'object') {
        const label = String(opt.label || opt.value || '').trim();
        if (!label) return null;
        // Une valeur explicitement fournie par l'appelant reste prioritaire.
        const base = opt.value ? String(opt.value) : (valueByLabel.get(label) || slugify(label));
        return { value: uniqueValue(base), label };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Génère un identifiant technique stable (snake_case ASCII) depuis un libellé.
 * @param {string} label
 * @returns {string}
 */
function slugify(label) {
  const base = String(label || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // retire les diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
  return base || 'champ';
}

/**
 * Renvoie un `name` unique dans le périmètre du schéma (contrainte UNIQUE (schema_id, name)).
 * @param {string} label
 * @param {Set<string>} taken - noms déjà utilisés dans ce schéma
 * @returns {string}
 */
function uniqueFieldName(label, taken) {
  const base = slugify(label);
  let candidate = base;
  let i = 2;
  while (taken.has(candidate)) {
    candidate = `${base}_${i++}`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Ajoute la projection `options` (chaînes) sur une ligne metadata_fields.
 */
function decorateField(row) {
  return { ...row, options: optionsToStrings(row.options_json) };
}

/**
 * Valide qu'une valeur correspond au type défini pour un champ.
 * @param {object} field - L'objet field de la table metadata_fields
 * @param {any} value - La valeur à valider
 * @throws {Error} Si la valeur est invalide pour le type
 */
function validateValue(field, value) {
  if (value === null || value === undefined) {
    if (field.required) {
      throw new Error(`Le champ ${field.label} est obligatoire.`);
    }
    return;
  }

  switch (field.type) {
    case 'text':
      if (typeof value !== 'string') {
        throw new Error(`Le champ ${field.label} doit être du texte.`);
      }
      break;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        throw new Error(`Le champ ${field.label} doit être un nombre.`);
      }
      break;

    case 'date':
      if (isNaN(Date.parse(value))) {
        throw new Error(`Le champ ${field.label} doit être une date valide.`);
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new Error(`Le champ ${field.label} doit être un booléen.`);
      }
      break;

    case 'select':
      const options = field.options_json || [];
      const validValues = options.map(opt => opt.value);
      if (!validValues.includes(value)) {
        throw new Error(`La valeur ${value} n'est pas valide pour le champ ${field.label}.`);
      }
      break;

    case 'multiselect':
      if (!Array.isArray(value)) {
        throw new Error(`Le champ ${field.label} doit être une liste de valeurs.`);
      }
      const multiOptions = field.options_json || [];
      const multiValidValues = multiOptions.map(opt => opt.value);
      for (const val of value) {
        if (!multiValidValues.includes(val)) {
          throw new Error(`La valeur ${val} n'est pas valide pour le champ ${field.label}.`);
        }
      }
      break;

    case 'user':
      if (!Number.isInteger(value)) {
        throw new Error(`Le champ ${field.label} doit être un identifiant utilisateur (entier).`);
      }
      break;

    case 'document':
      if (!Number.isInteger(value)) {
        throw new Error(`Le champ ${field.label} doit être un identifiant document (entier).`);
      }
      break;

    default:
      // Type inconnu, on laisse passer ou on logge un warning
      break;
  }
}

// ============================================================================
// SCHEMAS
// ============================================================================

async function createSchema(tenantId, { name, description, isDefault = false }) {
  const result = await db.query(
    `INSERT INTO metadata_schemas (tenant_id, name, description, is_default)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [tenantId, name, description, isDefault]
  );
  return result.rows[0];
}

async function getSchemas(tenantId) {
  const result = await db.query(
    'SELECT * FROM metadata_schemas WHERE tenant_id = $1 ORDER BY is_default DESC, name ASC',
    [tenantId]
  );
  const schemas = result.rows;
  if (schemas.length === 0) return [];

  // Charge les champs de tous les schémas en une requête (évite le N+1) : le front
  // (MetadataSchemaEditor) consomme directement `schema.fields`.
  const fieldsRes = await db.query(
    `SELECT * FROM metadata_fields
     WHERE schema_id = ANY($1)
     ORDER BY display_order ASC, id ASC`,
    [schemas.map((s) => s.id)]
  );

  const bySchema = new Map(schemas.map((s) => [s.id, []]));
  fieldsRes.rows.forEach((row) => {
    const bucket = bySchema.get(row.schema_id);
    if (bucket) bucket.push(decorateField(row));
  });

  return schemas.map((s) => ({ ...s, fields: bySchema.get(s.id) || [] }));
}

async function getSchemaById(tenantId, schemaId) {
  const schemaRes = await db.query(
    'SELECT * FROM metadata_schemas WHERE id = $1 AND tenant_id = $2',
    [schemaId, tenantId]
  );
  const schema = schemaRes.rows[0];
  if (!schema) return null;

  const fieldsRes = await db.query(
    'SELECT * FROM metadata_fields WHERE schema_id = $1 ORDER BY display_order ASC',
    [schemaId]
  );

  return {
    ...schema,
    fields: fieldsRes.rows.map(decorateField)
  };
}

async function updateSchema(tenantId, schemaId, { name, description, isDefault }) {
  const result = await db.query(
    `UPDATE metadata_schemas
     SET name = COALESCE($2, name),
         description = COALESCE($3, description),
         is_default = COALESCE($4, is_default),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND tenant_id = $5
     RETURNING *`,
    [schemaId, name, description, isDefault, tenantId]
  );
  return result.rows[0];
}

async function deleteSchema(tenantId, schemaId) {
  const result = await db.query(
    'DELETE FROM metadata_schemas WHERE id = $1 AND tenant_id = $2 RETURNING id',
    [schemaId, tenantId]
  );
  return result.rowCount > 0;
}

// ============================================================================
// FIELDS
// ============================================================================

async function createField(tenantId, schemaId, fieldData) {
  // Vérifier que le schéma appartient au tenant
  const schemaRes = await db.query(
    'SELECT id FROM metadata_schemas WHERE id = $1 AND tenant_id = $2',
    [schemaId, tenantId]
  );
  if (schemaRes.rowCount === 0) {
    throw new Error('Schéma non trouvé ou accès refusé.');
  }

  const { name, label, type, required, displayOrder, options, optionsJson, defaultValueJson, searchable } = fieldData;
  if (!label) {
    throw new Error('Le libellé du champ est obligatoire.');
  }

  // `name` est NOT NULL + UNIQUE (schema_id, name) : on le dérive du libellé
  // quand le client ne le fournit pas (cas de l'éditeur visuel).
  const takenRes = await db.query(
    'SELECT name FROM metadata_fields WHERE schema_id = $1',
    [schemaId]
  );
  const taken = new Set(takenRes.rows.map((r) => r.name));
  const fieldName = name && !taken.has(name) ? name : uniqueFieldName(name || label, taken);

  const canonicalOptions = optionsJson !== undefined
    ? optionsJson
    : optionsToCanonical(options);

  const result = await db.query(
    `INSERT INTO metadata_fields (schema_id, name, label, type, required, display_order, options_json, default_value_json, searchable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      schemaId,
      fieldName,
      label,
      type || 'text',
      required || false,
      displayOrder || 0,
      JSON.stringify(canonicalOptions),
      defaultValueJson !== undefined && defaultValueJson !== null ? JSON.stringify(defaultValueJson) : null,
      searchable !== undefined ? searchable : true,
    ]
  );
  return decorateField(result.rows[0]);
}

async function updateField(tenantId, fieldId, fieldData) {
  // Vérifier l'appartenance au tenant via le schéma, et récupérer les options
  // déjà en base : elles servent à préserver les `value` des options dont le
  // libellé n'a pas changé (voir optionsToCanonical).
  const fieldRes = await db.query(
    `SELECT f.id, f.options_json FROM metadata_fields f
     JOIN metadata_schemas s ON f.schema_id = s.id
     WHERE f.id = $1 AND s.tenant_id = $2`,
    [fieldId, tenantId]
  );
  if (fieldRes.rowCount === 0) {
    throw new Error('Champ non trouvé ou accès refusé.');
  }
  const previousOptions = fieldRes.rows[0].options_json || [];

  const { label, type, required, displayOrder, options, optionsJson, defaultValueJson, searchable } = fieldData;

  const canonicalOptions = optionsJson !== undefined
    ? optionsJson
    : (options !== undefined ? optionsToCanonical(options, previousOptions) : undefined);

  const result = await db.query(
    `UPDATE metadata_fields
     SET label = COALESCE($2, label),
         type = COALESCE($3, type),
         required = COALESCE($4, required),
         display_order = COALESCE($5, display_order),
         options_json = COALESCE($6, options_json),
         default_value_json = COALESCE($7, default_value_json),
         searchable = COALESCE($8, searchable)
     WHERE id = $1
     RETURNING *`,
    [
      fieldId,
      label,
      type,
      required,
      displayOrder,
      canonicalOptions !== undefined ? JSON.stringify(canonicalOptions) : null,
      defaultValueJson !== undefined && defaultValueJson !== null ? JSON.stringify(defaultValueJson) : null,
      searchable,
    ]
  );
  return result.rows[0] ? decorateField(result.rows[0]) : undefined;
}

async function deleteField(tenantId, fieldId) {
  const result = await db.query(
    `DELETE FROM metadata_fields
     WHERE id = $1 AND schema_id IN (SELECT id FROM metadata_schemas WHERE tenant_id = $2)
     RETURNING id`,
    [fieldId, tenantId]
  );
  return result.rowCount > 0;
}

// ============================================================================
// VALUES
// ============================================================================

/**
 * Définit ou met à jour les métadonnées d'un document.
 * @param {number} tenantId
 * @param {number} documentId
 * @param {Array<{fieldId: number, value: any}>} values
 * @param {object} [client] - Optionnel pour transaction
 */
async function setDocumentMetadata(tenantId, documentId, values, client = null) {
  const run = client || db;

  // On récupère tous les champs concernés pour validation
  const fieldIds = values.map(v => v.fieldId);
  const fieldsRes = await run.query(
    `SELECT f.id, f.label, f.type, f.required, f.options_json
     FROM metadata_fields f
     JOIN metadata_schemas s ON f.schema_id = s.id
     WHERE f.id = ANY($1) AND s.tenant_id = $2`,
    [fieldIds, tenantId]
  );

  const fieldsMap = {};
  fieldsRes.rows.forEach(f => { fieldsMap[f.id] = f; });

  if (fieldsRes.rowCount !== fieldIds.length) {
    throw new Error('Certains champs spécifiés sont invalides ou ne sont pas associés à votre organisation.');
  }

  for (const entry of values) {
    const field = fieldsMap[entry.fieldId];
    validateValue(field, entry.value);
  }

  // Mise à jour / Insertion
  for (const entry of values) {
    await run.query(
      `INSERT INTO metadata_values (document_id, field_id, value_json, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (document_id, field_id)
       DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = CURRENT_TIMESTAMP`,
      [documentId, entry.fieldId, JSON.stringify(entry.value)]
    );
  }
}

async function getDocumentMetadata(tenantId, documentId) {
  const result = await db.query(
    `SELECT v.id as value_id, f.id as field_id, f.name, f.label, f.type, f.required,
            f.options_json, v.value_json
     FROM metadata_values v
     JOIN metadata_fields f ON v.field_id = f.id
     JOIN metadata_schemas s ON f.schema_id = s.id
     WHERE v.document_id = $1 AND s.tenant_id = $2
     ORDER BY f.display_order ASC`,
    [documentId, tenantId]
  );

  return result.rows.map(row => ({
    ...row,
    options: optionsToStrings(row.options_json),
    value: row.value_json // JSONB is automatically parsed by pg
  }));
}

async function updateMetadataValue(tenantId, documentId, fieldId, value, client = null) {
  const run = client || db;

  const fieldRes = await run.query(
    `SELECT f.id, f.label, f.type, f.required, f.options_json
     FROM metadata_fields f
     JOIN metadata_schemas s ON f.schema_id = s.id
     WHERE f.id = $1 AND s.tenant_id = $2`,
    [fieldId, tenantId]
  );
  const field = fieldRes.rows[0];
  if (!field) {
    throw new Error('Champ non trouvé ou accès refusé.');
  }

  validateValue(field, value);

  const result = await run.query(
    `UPDATE metadata_values
     SET value_json = $1, updated_at = CURRENT_TIMESTAMP
     WHERE document_id = $2 AND field_id = $3
     RETURNING *`,
    [JSON.stringify(value), documentId, fieldId]
  );

  if (result.rowCount === 0) {
    // Si n'existe pas, on le crée
    const insertRes = await run.query(
      `INSERT INTO metadata_values (document_id, field_id, value_json)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [documentId, fieldId, JSON.stringify(value)]
    );
    return insertRes.rows[0];
  }

  return result.rows[0];
}

async function deleteMetadataValue(tenantId, documentId, fieldId, client = null) {
  const run = client || db;
  const result = await run.query(
    `DELETE FROM metadata_values
     WHERE document_id = $1 AND field_id = $2
     AND field_id IN (
       SELECT f.id FROM metadata_fields f
       JOIN metadata_schemas s ON f.schema_id = s.id
       WHERE s.tenant_id = $3
     )
     RETURNING id`,
    [documentId, fieldId, tenantId]
  );
  return result.rowCount > 0;
}

/**
 * Synchronise l'intégralité des champs d'un schéma depuis l'éditeur visuel :
 * création des nouveaux champs, mise à jour des existants, suppression des retirés,
 * et réécriture de `display_order` selon l'ordre du tableau (glisser-déposer).
 *
 * Un champ est considéré comme « existant » uniquement si son id est réellement
 * présent en base pour ce schéma — l'éditeur attribue aux nouveaux champs un id
 * temporaire côté client, qui ne doit jamais être interprété comme une clé SQL.
 *
 * @param {number} tenantId
 * @param {number} schemaId
 * @param {Array<{id?: any, label: string, type: string, required?: boolean, options?: any[]}>} fields
 * @returns {Promise<Array>} Les champs du schéma après synchronisation
 */
async function syncSchemaFields(tenantId, schemaId, fields) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Security check: Verify the schema belongs to the tenant
    const schemaCheck = await client.query(
      'SELECT id FROM metadata_schemas WHERE id = $1 AND tenant_id = $2',
      [schemaId, tenantId]
    );
    if (schemaCheck.rowCount === 0) {
      throw new Error('Schéma non trouvé ou accès refusé.');
    }

    // 1. État courant en base (source de vérité pour distinguer création / mise à jour)
    const currentFieldsRes = await client.query(
      'SELECT id, name, options_json FROM metadata_fields WHERE schema_id = $1',
      [schemaId]
    );
    const currentById = new Map(currentFieldsRes.rows.map((r) => [String(r.id), r]));

    // Un id fourni n'est retenu que s'il correspond à une ligne existante du schéma.
    const keptIds = new Set();
    for (const field of fields) {
      if (field.id !== undefined && field.id !== null && currentById.has(String(field.id))) {
        keptIds.add(String(field.id));
      }
    }

    // 2. Suppression des champs retirés de l'éditeur (les valeurs associées
    //    partent en cascade via metadata_values.field_id ON DELETE CASCADE).
    const idsToDelete = currentFieldsRes.rows
      .map((r) => r.id)
      .filter((id) => !keptIds.has(String(id)));
    if (idsToDelete.length > 0) {
      await client.query(
        'DELETE FROM metadata_fields WHERE id = ANY($1::int[]) AND schema_id = $2',
        [idsToDelete, schemaId]
      );
    }

    // Noms techniques encore occupés après suppression (contrainte UNIQUE (schema_id, name))
    const takenNames = new Set(
      currentFieldsRes.rows
        .filter((r) => keptIds.has(String(r.id)))
        .map((r) => r.name)
    );

    // 3. Mise à jour ou création, display_order = position dans le tableau
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const displayOrder = i;
      const label = String(field.label || '').trim();
      if (!label) {
        throw new Error(`Le champ en position ${i + 1} n'a pas de libellé.`);
      }
      const type = field.type || 'text';
      const required = field.required === true;
      const isExisting = field.id !== undefined && field.id !== null && keptIds.has(String(field.id));
      // Les options déjà en base pour ce champ : sans elles, les `value` des
      // options seraient re-slugifiées depuis les libellés à chaque
      // enregistrement — y compris lors d'un simple réordonnancement — et les
      // `metadata_values` des documents ne correspondraient plus à aucune option.
      const previousOptions = isExisting ? (currentById.get(String(field.id))?.options_json || []) : [];
      const options = JSON.stringify(optionsToCanonical(field.options, previousOptions));

      if (isExisting) {
        await client.query(
          `UPDATE metadata_fields
           SET label = $2, type = $3, required = $4, display_order = $5, options_json = $6
           WHERE id = $1 AND schema_id = $7`,
          [Number(field.id), label, type, required, displayOrder, options, schemaId]
        );
      } else {
        await client.query(
          `INSERT INTO metadata_fields (schema_id, name, label, type, required, display_order, options_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [schemaId, uniqueFieldName(label, takenNames), label, type, required, displayOrder, options]
        );
      }
    }

    await client.query('COMMIT');

    // 4. Renvoie l'état consolidé (ids réels + ordre) pour que le front se resynchronise
    const finalRes = await client.query(
      'SELECT * FROM metadata_fields WHERE schema_id = $1 ORDER BY display_order ASC, id ASC',
      [schemaId]
    );
    return finalRes.rows.map(decorateField);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  // Schémas
  createSchema,
  getSchemas,
  getSchemaById,
  updateSchema,
  deleteSchema,
  // Champs
  createField,
  updateField,
  deleteField,
  syncSchemaFields,
  // Valeurs
  setDocumentMetadata,
  getDocumentMetadata,
  updateMetadataValue,
  deleteMetadataValue,
  // Utilitaires exposés pour les autres services / tests
  validateValue,
  slugify,
  // Exporté pour requestFieldService, qui applique la même règle de préservation
  // des `value` par libellé. Le dupliquer aurait dupliqué le piège documenté
  // ci-dessus : deux copies de cette fonction, et la première corrigée seule
  // laisserait l'autre re-slugifier les valeurs au moindre réordonnancement.
  optionsToCanonical,
  optionsToStrings,
};
