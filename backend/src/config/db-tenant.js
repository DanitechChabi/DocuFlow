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
  const buildScoped = () => {
    if (/WHERE/i.test(text)) {
      let s = text
        .replace(/\s+ORDER\s+BY\s/i, ` AND ${condition} ORDER BY `)
        .replace(/\s+LIMIT\s/i, ` AND ${condition} LIMIT `)
        .replace(/\s+GROUP\s+BY\s/i, ` AND ${condition} GROUP BY `)
        .replace(/\s+HAVING\s/i, ` AND ${condition} HAVING `);
      if (s === text) s = text + ` AND ${condition}`;
      return { text: s, params: [...params, safeTenantId] };
    }

    let s = text
      .replace(/\s+ORDER\s+BY\s/i, ` WHERE ${condition} ORDER BY `)
      .replace(/\s+LIMIT\s/i, ` WHERE ${condition} LIMIT `)
      .replace(/\s+GROUP\s+BY\s/i, ` WHERE ${condition} GROUP BY `);
    if (s === text) s = text + ` WHERE ${condition}`;
    return { text: s, params: [...params, safeTenantId] };
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

module.exports = { query, insert, db };
