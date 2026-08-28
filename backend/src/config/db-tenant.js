/**
 * Helper tenant-aware pour les requêtes SQL.
 * Centralise l'ajout du filtre tenant_id dans toutes les requêtes.
 * Si la colonne tenant_id n'existe pas encore (pré-migration),
 * la requête est exécutée sans filtre (mode mono-tenant).
 */
const db = require('./db');

/**
 * Exécute une requête SELECT/UPDATE/DELETE avec filtrage automatique par tenant.
 * Ajoute AND tenant_id = $N juste avant ORDER BY / LIMIT / fin de la requête.
 *
 * @param {number} tenantId - ID du tenant (ignoré si colonne absente)
 * @param {string} text    - Requête SQL
 * @param {array}  params  - Paramètres de la requête
 */
async function query(tenantId, text, params = []) {
  const safeTenantId = tenantId || 1;
  const idx = params.length + 1;
  const condition = `tenant_id = $${idx}`;

  // Construire la requête scope en fonction de la présence d'une clause WHERE
  // Injecte la condition UNIFORME AVANT la première clause de terminaison (ORDER BY / LIMIT / GROUP BY / HAVING)
  const buildScoped = () => {
    // Chercher la première occurrence de n'importe quelle clause de terminaison
    const terminatorRegex = /\s+(ORDER\s+BY|LIMIT|GROUP\s+BY|HAVING)\s/i;
    const terminatorMatch = text.match(terminatorRegex);

    if (/WHERE/i.test(text)) {
      if (terminatorMatch) {
        const insertPos = terminatorMatch.index;
        const before = text.slice(0, insertPos);
        const after = text.slice(insertPos); // starts with whitespace + keyword
        const s = `${before} AND ${condition}${after}`;
        return { text: s, params: [...params, safeTenantId] };
      }
      return { text: text + ` AND ${condition}`, params: [...params, safeTenantId] };
    }

    if (terminatorMatch) {
      const insertPos = terminatorMatch.index;
      const before = text.slice(0, insertPos);
      const after = text.slice(insertPos);
      const s = `${before} WHERE ${condition}${after}`;
      return { text: s, params: [...params, safeTenantId] };
    }
    return { text: text + ` WHERE ${condition}`, params: [...params, safeTenantId] };
  };

  const scoped = buildScoped();

  try {
    return await db.query(scoped.text, scoped.params);
  } catch (err) {
    // Si colonne tenant_id absente → exécuter sans filtre (mode mono-tenant)
    if (err.code === '42703') {
      console.warn(`[db-tenant] Colonne tenant_id absente, fallback mono-tenant pour : ${text.slice(0, 60)}...`);
      return db.query(text, params);
    }
    throw err;
  }
}

/**
 * Insère une ligne avec tenant_id automatiquement.
 * Si la colonne n'existe pas, insère sans tenant_id.
 *
 * @param {number} tenantId
 * @param {string} table    - Nom de la table
 * @param {string[]} columns - Noms des colonnes (sans tenant_id)
 * @param {array}  values   - Valeurs correspondantes
 * @param {string} returning - Clause RETURNING (défaut '*')
 */
async function insert(tenantId, table, columns, values, returning = '*') {
  const safeTenantId = tenantId || 1;
  const allCols  = [...columns, 'tenant_id'];
  const allVals  = [...values, safeTenantId];
  const placeholders = allVals.map((_, i) => `$${i + 1}`);

  const sql = `INSERT INTO ${table} (${allCols.join(', ')})
               VALUES (${placeholders.join(', ')})
               RETURNING ${returning}`;

  try {
    return await db.query(sql, allVals);
  } catch (err) {
    // Si colonne tenant_id absente → insérer sans tenant_id
    if (err.code === '42703') {
      console.warn(`[db-tenant] Colonne tenant_id absente, fallback mono-tenant pour INSERT INTO ${table}`);
      const plainCols = columns.join(', ');
      const plainPH = columns.map((_, i) => `$${i + 1}`).join(', ');
      return db.query(
        `INSERT INTO ${table} (${plainCols}) VALUES (${plainPH}) RETURNING ${returning}`,
        values
      );
    }
    throw err;
  }
}

/**
 * Met à jour une ligne, TOUJOURS bornée au tenant.
 *
 * Cette fonction manquait alors que deux appels `tenantDb.update(...)` existaient
 * déjà dans documentController (auto-étiquetage après extraction de texte) :
 * `update` étant `undefined`, l'appel lançait « tenantDb.update is not a function ».
 * En téléversement en masse, l'exception était rattrapée par le try du fichier
 * courant, qui comptait donc en ÉCHEC un document pourtant créé et son fichier
 * pourtant enregistré ; en mode simple, elle remontait au catch général et
 * rendait un 500 « Erreur lors de la création du document » sur une création
 * réussie. Dans les deux cas le compte rendu contredisait l'état de la base.
 *
 * Ne se déclenchait que sur les fichiers dont le texte est réellement extrait —
 * aujourd'hui les .txt et assimilés, `pdf-parse` et `mammoth` n'étant pas
 * installés — d'où un défaut intermittent, apparemment lié au type de fichier.
 *
 * @param {number} tenantId
 * @param {string} table
 * @param {string[]} columns  - Colonnes à écrire
 * @param {array}  values     - Valeurs correspondantes
 * @param {string} whereCol   - Colonne de sélection (ex. 'id')
 * @param {*}      whereVal   - Valeur de sélection
 * @param {string} returning
 */
async function update(tenantId, table, columns, values, whereCol, whereVal, returning = '*') {
  const safeTenantId = tenantId || 1;
  const sets = columns.map((col, i) => `${col} = $${i + 1}`);
  const iWhere = values.length + 1;
  const iTenant = values.length + 2;

  // Le filtre tenant est dans la clause WHERE, pas ajouté après coup : une mise à
  // jour qui viserait l'identifiant d'une autre organisation ne doit toucher
  // aucune ligne, plutôt que de réussir hors de son périmètre.
  const sql = `UPDATE ${table} SET ${sets.join(', ')}
               WHERE ${whereCol} = $${iWhere} AND tenant_id = $${iTenant}
               RETURNING ${returning}`;

  try {
    return await db.query(sql, [...values, whereVal, safeTenantId]);
  } catch (err) {
    if (err.code === '42703') {
      console.warn(`[db-tenant] Colonne tenant_id absente, fallback mono-tenant pour UPDATE ${table}`);
      return db.query(
        `UPDATE ${table} SET ${sets.join(', ')} WHERE ${whereCol} = $${iWhere} RETURNING ${returning}`,
        [...values, whereVal]
      );
    }
    throw err;
  }
}

module.exports = { query, insert, update, db };
