/**
 * auditService — Gestion des logs d'audit pour le traçage des actions utilisateurs.
 */
const { query, insert } = require('../config/db-tenant');

/**
 * Enregistre une action dans la table audit_logs.
 *
 * @param {object} params - Paramètres de l'audit
 * @param {number} params.tenantId    - ID de l'entreprise
 * @param {number} [params.userId]    - ID de l'utilisateur ayant effectué l'action
 * @param {number} [params.requestId] - ID de la demande associée (si applicable)
 * @param {string} params.action      - Description de l'action effectuée
 * @param {string} [params.ipAddress]  - Adresse IP de l'utilisateur
 * @param {string} [params.userName]  - Nom de l'utilisateur (pour historique lisible)
 * @returns {Promise<object|null>} La ligne insérée ou null en cas d'erreur
 */
async function logAction({ tenantId, userId, requestId, action, ipAddress, userName }) {
  const columns = ['id_user', 'request_id', 'action', 'ip_address', 'user_name'];
  const values = [userId || null, requestId || null, action, ipAddress || null, userName || null];

  try {
    const result = await insert(tenantId, 'audit_logs', columns, values);
    return result.rows[0];
  } catch (err) {
    console.error('[auditService] Erreur lors de l\'enregistrement du log d\'audit:', err.message);
    // On ne rejette pas l'erreur pour éviter de bloquer l'action métier principale
    // si l'audit échoue, mais on logue l'erreur dans la console.
    return null;
  }
}

/**
 * Uniformise une ligne d'audit vers le contrat lu par le frontend
 * (actor_name, occurred_at, details), quel que soit l'état de migration.
 *
 * La table `audit_logs` porte deux générations de colonnes : les historiques
 * (id_user, user_name, timestamp) et celles de la GED (actor_id, actor_username,
 * occurred_at, details_json), ajoutées par la migration 012. La normalisation est
 * faite ici, en JS, et non en SQL : sur une base où 012 n'est pas encore passée,
 * un SELECT nommant `occurred_at` échouerait avec « column does not exist » et
 * rendrait le journal totalement inaccessible.
 *
 * @param {object} row - Ligne brute issue de audit_logs
 * @returns {object} Ligne enrichie des trois champs canoniques
 */
function normalizeLog(row) {
  return {
    ...row,
    actor_name: row.actor_username || row.user_name || null,
    occurred_at: row.occurred_at || row.timestamp || null,
    // `??` et non `||` : un détail vide légitime ({} ou '') ne doit pas être
    // remplacé silencieusement par l'autre colonne.
    details: row.details ?? row.details_json ?? null,
  };
}

/**
 * Complète `actor_name` pour les lignes n'ayant qu'un identifiant d'auteur.
 *
 * Le nom n'est pas résolu par un JOIN dans la requête principale : `users` porte
 * aussi une colonne `tenant_id`, et le filtre ajouté automatiquement par
 * db-tenant n'est pas qualifié — le JOIN rendrait donc `tenant_id` ambigu et
 * ferait échouer la requête. Une seconde requête ciblée est à la fois sûre et
 * bornée (un appel, quel que soit le nombre de lignes).
 *
 * @param {number} tenantId - ID du tenant pour le scope
 * @param {array} rows - Lignes déjà normalisées
 * @returns {Promise<array>} Les mêmes lignes, noms d'auteurs complétés
 */
async function resolveActorNames(tenantId, rows) {
  const missing = [...new Set(
    rows.filter((r) => !r.actor_name).map((r) => r.actor_id || r.id_user).filter(Boolean)
  )];
  if (missing.length === 0) return rows;

  try {
    const result = await query(tenantId, 'SELECT id, full_name FROM users WHERE id = ANY($1)', [missing]);
    const names = new Map(result.rows.map((u) => [u.id, u.full_name]));
    return rows.map((r) => (
      r.actor_name ? r : { ...r, actor_name: names.get(r.actor_id || r.id_user) || null }
    ));
  } catch (err) {
    // L'absence de nom lisible ne doit pas priver l'administrateur de son
    // journal : on renvoie les lignes telles quelles.
    console.error('[auditService] Résolution des noms d\'auteurs impossible:', err.message);
    return rows;
  }
}

/**
 * Récupère les logs d'audit avec filtres et pagination.
 *
 * @param {number} tenantId - ID du tenant pour le scope
 * @param {object} filters - Filtres (userId, action)
 * @param {object} options - Pagination (limit, offset)
 * @returns {Promise<array>} Liste des logs au contrat normalisé
 */
async function getLogs(tenantId, { userId, action } = {}, { limit = 50, offset = 0 } = {}) {
  let sql = 'SELECT * FROM audit_logs';
  const params = [];
  const whereClauses = [];

  if (userId) {
    params.push(userId);
    whereClauses.push(`id_user = $${params.length}`);
  }

  if (action) {
    params.push(`%${action}%`);
    whereClauses.push(`action LIKE $${params.length}`);
  }

  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  // `limit`/`offset` viennent de la query string : parseInt seul renvoie NaN sur
  // une valeur non numérique (?limit=abc), ce qui produisait un « LIMIT NaN » et
  // une erreur de syntaxe SQL. On retombe donc sur les valeurs par défaut.
  const safeLimit = Number.isFinite(parseInt(limit, 10)) ? Math.min(Math.max(parseInt(limit, 10), 1), 500) : 50;
  const safeOffset = Number.isFinite(parseInt(offset, 10)) ? Math.max(parseInt(offset, 10), 0) : 0;

  // Le tri se fait sur l'identifiant : il est monotone et toujours présent,
  // contrairement aux colonnes de date qui coexistent en deux versions.
  sql += ` ORDER BY id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

  // On utilise query de db-tenant qui ajoutera automatiquement le filtre tenant_id
  const result = await query(tenantId, sql, params);
  return resolveActorNames(tenantId, result.rows.map(normalizeLog));
}

module.exports = { logAction, getLogs, normalizeLog };
