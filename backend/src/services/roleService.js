// ============================================================================
// roleService — rôles et permissions par organisation (RBAC).
//
// La base porte les rôles (migration 019) ; le catalogue des clés vit en code
// (config/permissions.js). Ce service résout « tel utilisateur de tel tenant
// détient-il telle permission », avec un cache court : les gardes
// requirePermission passent à chaque requête, une lecture SQL par requête et
// par écran serait un coût disproportionné pour une valeur qui ne change qu'à
// la modification d'un rôle.
//
// INVALIDATION : toute écriture de rôle ou de permission appelle invalidate()
// — et le contrôleur d'utilisateurs incrémente token_version, ce qui déconnecte
// les sessions déjà ouvertes (voir authMiddleware).
// ============================================================================
const db = require('../config/db');
const { estValide, filtrerValides, ROLES_SYSTEME } = require('../config/permissions');

// Cache rôle : (tenantId, roleKey) → définition. TTL court — la matrice
// d'administration modifie un rôle et veut voir l'effet immédiat.
const ROLE_TTL_MS = 30_000;
const cacheRoles = new Map();

// Cache utilisateur : userId → { role, token_version }. Permet à
// authMiddleware d'appliquer les changements de rôle SANS déconnexion (le
// rôle en base fait foi dès la prochaine fenêtre de 30 s), et de rejeter les
// jetons dont la version a été invalidée.
const USER_TTL_MS = 30_000;
const cacheUsers = new Map();

/** Vide les caches (après toute écriture). */
function invalidate() {
  cacheRoles.clear();
  cacheUsers.clear();
}

/** Invalide l'entrée utilisateur d'un seul compte (changement de rôle). */
function invalidateUser(userId) {
  cacheUsers.delete(userId);
  // Le rôle a changé : les caches de rôles restent valides (ce sont des
  // définitions), seule l'association utilisateur→rôle bouge.
}

/**
 * Définition d'un rôle pour un tenant. Null si la clé n'existe pas.
 *
 * REPLI PRÉ-MIGRATION : si la table `roles` n'existe pas encore (déploiement
 * du code avant la migration 019, base de développement vierge), les rôles
 * SYSTÈME sont servis depuis leur définition en code — identique à ce que la
 * migration provisionne. Sans ce repli, possede() échouerait fermé pour tout
 * le monde et l'application entière serait verrouillée le temps d'appliquer
 * la migration. Les rôles personnalisés, eux, exigent la table — retour null.
 *
 * @returns {Promise<{key, name, description, is_system, permissions, is_active}|null>}
 */
async function getRole(tenantId, roleKey) {
  const cle = `${tenantId}|${roleKey}`;
  const hit = cacheRoles.get(cle);
  if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit.value;

  let value;
  try {
    const { rows } = await db.query(
      'SELECT key, name, description, is_system, permissions, is_active FROM roles WHERE tenant_id = $1 AND key = $2',
      [tenantId, roleKey]
    );
    value = rows[0] || null;
  } catch (err) {
    if (err.code === '42P01') {
      const defCode = ROLES_SYSTEME.find((r) => r.key === roleKey);
      value = defCode
        ? { key: defCode.key, name: defCode.name, description: defCode.description, is_system: true, permissions: defCode.permissions, is_active: true }
        : null;
    } else {
      throw err;
    }
  }
  cacheRoles.set(cle, { value, at: Date.now() });
  return value;
}

/**
 * Rôle et version de jeton d'un utilisateur — pour authMiddleware.
 *
 * REPLI PRÉ-MIGRATION : sans la colonne token_version (42703), on relit le
 * rôle seul avec une version 0 — le jeton reste valide, le rafraîchissement
 * du rôle fonctionne dès la première fenêtre de cache.
 *
 * @returns {Promise<{role, token_version}|null>} null si le compte n'existe plus.
 */
async function getUserAuth(userId) {
  const hit = cacheUsers.get(userId);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.value;

  let value;
  try {
    const { rows } = await db.query(
      'SELECT role, token_version FROM users WHERE id = $1',
      [userId]
    );
    value = rows[0] || null;
  } catch (err) {
    if (err.code === '42703') {
      const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
      value = rows[0] ? { role: rows[0].role, token_version: 0 } : null;
    } else {
      throw err;
    }
  }
  cacheUsers.set(userId, { value, at: Date.now() });
  return value;
}

/**
 * Un utilisateur détient-il une permission ?
 *
 * ÉCHEC FERMÉ : rôle introuvable, désactivé, ou base injoignable → refus.
 * Un incident de lecture ne doit pas ouvrir l'accès que la permission devait
 * protéger (le choix inverse, fail-open, ne se justifie que pour la garde de
 * licence — voir licenseMiddleware — où c'est le client qui a payé).
 *
 * @param {number} tenantId
 * @param {string} roleKey
 * @param {string} permission clé du catalogue (le joker '*' n'est qu'une VALEUR
 *        de rôle, jamais une demande).
 * @returns {Promise<boolean>}
 */
async function possede(tenantId, roleKey, permission) {
  let role;
  try {
    role = await getRole(tenantId, roleKey);
  } catch (err) {
    console.error('[roles] Lecture du rôle impossible — accès refusé :', err.message);
    return false;
  }
  if (!role || !role.is_active) return false;
  return role.permissions.includes('*') || role.permissions.includes(permission);
}

/** Liste les rôles d'un tenant avec le nombre d'utilisateurs de chacun. */
async function listRoles(tenantId) {
  const { rows } = await db.query(
    `SELECT r.id, r.key, r.name, r.description, r.is_system, r.permissions, r.is_active,
            r.created_at, r.updated_at,
            (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = r.tenant_id AND u.role = r.key) AS users_count
       FROM roles r
      WHERE r.tenant_id = $1
      ORDER BY r.is_system DESC, r.name ASC`,
    [tenantId]
  );
  return rows;
}

/**
 * Crée un rôle personnalisé.
 * @returns {Promise<Object>} le rôle créé.
 * @throws si la clé existe déjà pour ce tenant.
 */
async function createRole(tenantId, { key, name, description, permissions }) {
  const cles = filtrerValides(permissions);
  if (!cles.length) throw Object.assign(new Error('Un rôle doit porter au moins une permission.'), { status: 400 });
  const { rows } = await db.query(
    `INSERT INTO roles (tenant_id, key, name, description, is_system, permissions)
     VALUES ($1, $2, $3, $4, FALSE, $5)
     RETURNING *`,
    [tenantId, key, name, description || null, cles]
  );
  invalidate();
  return rows[0];
}

/**
 * Met à jour un rôle (nom, description, permissions, activation).
 * Les permissions inconnues du catalogue sont ignorées ; un rôle système voit
 * sa clé immuable (les utilisateurs la portent, et le code la référence).
 *
 * @param {Object} [options.onPermissionsChange] callback si les permissions
 *        changent — le contrôleur y incrémente token_version des utilisateurs
 *        concernés, pour répercuter le changement sur les sessions ouvertes.
 */
async function updateRole(tenantId, roleKey, { name, description, permissions, is_active }, onPermissionsChange) {
  const existant = await getRole(tenantId, roleKey);
  if (!existant) return null;

  const champs = [];
  const valeurs = [];
  const pousser = (colonne, valeur) => {
    champs.push(`${colonne} = $${valeurs.length + 1}`);
    valeurs.push(valeur);
  };

  if (name !== undefined) pousser('name', name);
  if (description !== undefined) pousser('description', description);
  if (is_active !== undefined) pousser('is_active', Boolean(is_active));

  let permissionsChangent = false;
  if (permissions !== undefined) {
    const cles = filtrerValides(permissions);
    if (!cles.length) throw Object.assign(new Error('Un rôle doit porter au moins une permission.'), { status: 400 });
    permissionsChangent = JSON.stringify(cles) !== JSON.stringify(existant.permissions);
    pousser('permissions', cles);
  }

  if (!champs.length) return existant;
  pousser('updated_at', new Date());

  const { rows } = await db.query(
    `UPDATE roles SET ${champs.join(', ')} WHERE tenant_id = $${valeurs.length + 1} AND key = $${valeurs.length + 2} RETURNING *`,
    [...valeurs, tenantId, roleKey]
  );
  invalidate();
  if (permissionsChangent && onPermissionsChange) await onPermissionsChange();
  return rows[0];
}

/**
 * Supprime un rôle — seulement s'il n'est ni système ni porté par un compte.
 * @returns {Promise<boolean>}
 */
async function deleteRole(tenantId, roleKey) {
  const existant = await getRole(tenantId, roleKey);
  if (!existant) return false;
  if (existant.is_system) {
    throw Object.assign(new Error('Un rôle système ne peut pas être supprimé.'), { status: 400 });
  }
  const { rows: porteurs } = await db.query(
    'SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = $1 AND role = $2',
    [tenantId, roleKey]
  );
  if (porteurs[0].n > 0) {
    throw Object.assign(new Error(`Ce rôle est attribué à ${porteurs[0].n} compte(s) : réassignez-les d'abord.`), { status: 409 });
  }
  const { rowCount } = await db.query(
    'DELETE FROM roles WHERE tenant_id = $1 AND key = $2',
    [tenantId, roleKey]
  );
  invalidate();
  return rowCount > 0;
}

/**
 * Provisionne les rôles système d'un tenant (création d'entreprise).
 * Idempotent — les clés existantes ne sont pas touchées.
 */
async function provisionRoles(tenantId) {
  for (const role of ROLES_SYSTEME) {
    await db.query(
      `INSERT INTO roles (tenant_id, key, name, description, is_system, permissions)
       VALUES ($1, $2, $3, $4, TRUE, $5)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantId, role.key, role.name, role.description, role.permissions]
    );
  }
  invalidate();
}

/**
 * Valide qu'une clé de rôle est attribuable : connue de la table du tenant,
 * et active. Utilisé par le contrôleur d'utilisateurs au lieu des listes en dur.
 * @returns {Promise<{ok: boolean, role?: Object}>}
 */
async function roleAttribuable(tenantId, roleKey) {
  const role = await getRole(tenantId, roleKey);
  if (!role || !role.is_active) return { ok: false };
  return { ok: true, role };
}

module.exports = {
  invalidate,
  invalidateUser,
  getRole,
  getUserAuth,
  possede,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  provisionRoles,
  roleAttribuable,
  estValide,
};
