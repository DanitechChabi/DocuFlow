const db = require('../config/db');

/**
 * Service pour la gestion des groupes et des appartenances utilisateurs.
 * Gère le CRUD pour les tables 'groups' et 'user_group_memberships'.
 */
const groupService = {
  // --- Gestion des Groupes (CRUD) ---

  /**
   * Crée un nouveau groupe pour une organisation.
   * @param {number} tenantId - ID de l'organisation (tenant).
   * @param {Object} groupData - Données du groupe { name, description, external_id }.
   * @returns {Promise<Object>} Le groupe créé.
   */
  createGroup: async (tenantId, groupData) => {
    const { name, description, external_id } = groupData;
    const query = `
      INSERT INTO groups (tenant_id, name, description, external_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const values = [tenantId, name, description, external_id];
    const { rows } = await db.query(query, values);
    return rows[0];
  },

  /**
   * Récupère tous les groupes appartenant à une organisation.
   * @param {number} tenantId - ID de l'organisation.
   * @returns {Promise<Array>} Liste des groupes.
   */
  getGroups: async (tenantId) => {
    const query = `SELECT * FROM groups WHERE tenant_id = $1 ORDER BY name ASC;`;
    const { rows } = await db.query(query, [tenantId]);
    return rows;
  },

  /**
   * Récupère un groupe spécifique par son ID, en vérifiant l'appartenance au tenant.
   * @param {number} tenantId - ID de l'organisation.
   * @param {number} groupId - ID du groupe.
   * @returns {Promise<Object|null>} Le groupe ou null si non trouvé.
   */
  getGroupById: async (tenantId, groupId) => {
    const query = `SELECT * FROM groups WHERE id = $1 AND tenant_id = $2;`;
    const { rows } = await db.query(query, [groupId, tenantId]);
    return rows[0] || null;
  },

  /**
   * Met à jour les informations d'un groupe.
   * @param {number} tenantId - ID de l'organisation.
   * @param {number} groupId - ID du groupe à modifier.
   * @param {Object} groupData - Données à mettre à jour { name, description, external_id }.
   * @returns {Promise<Object|null>} Le groupe mis à jour ou null.
   */
  updateGroup: async (tenantId, groupId, groupData) => {
    const { name, description, external_id } = groupData;
    const query = `
      UPDATE groups
      SET name = $1, description = $2, external_id = $3
      WHERE id = $4 AND tenant_id = $5
      RETURNING *;
    `;
    const values = [name, description, external_id, groupId, tenantId];
    const { rows } = await db.query(query, values);
    return rows[0] || null;
  },

  /**
   * Supprime un groupe et ses appartenances (via ON DELETE CASCADE).
   * @param {number} tenantId - ID de l'organisation.
   * @param {number} groupId - ID du groupe à supprimer.
   * @returns {Promise<boolean>} True si le groupe a été supprimé.
   */
  deleteGroup: async (tenantId, groupId) => {
    const query = `DELETE FROM groups WHERE id = $1 AND tenant_id = $2 RETURNING id;`;
    const { rows } = await db.query(query, [groupId, tenantId]);
    return rows.length > 0;
  },

  // --- Gestion des Appartenances (Memberships) ---

  /**
   * Ajoute un utilisateur à un groupe.
   *
   * Le tenant de l'APPELANT fait foi, et pas seulement celui de l'utilisateur :
   * l'ancienne vérification contrôlait que l'utilisateur et le groupe étaient du
   * même tenant, mais jamais que c'était celui de l'administrateur qui appelle —
   * l'admin d'une organisation pouvait donc manipuler les groupes d'une AUTRE.
   *
   * @param {number} tenantId - Tenant de l'appelant (périmètre autorisé).
   * @param {number} userId - ID de l'utilisateur.
   * @param {number} groupId - ID du groupe.
   * @returns {Promise<Object>} Le résultat de l'opération.
   */
  addUserToGroup: async (tenantId, userId, groupId) => {
    // Les deux doivent être du tenant de l'appelant : une seule requête, la
    // clause WHERE porte sur lui directement.
    const checkQuery = `
      SELECT 1
      FROM users u, groups g
      WHERE u.id = $1 AND g.id = $2
        AND u.tenant_id = $3 AND g.tenant_id = $3;
    `;
    const { rows: checkRows } = await db.query(checkQuery, [userId, groupId, tenantId]);

    if (checkRows.length === 0) {
      // Message volontairement indistinct (« utilisateur ou groupe ») : préciser
      // lequel des deux est hors périmètre renseignerait un appelant indélicat
      // sur l'existence d'identifiants chez d'autres organisations.
      throw new Error('Utilisateur ou groupe introuvable dans votre organisation');
    }

    const query = `
      INSERT INTO user_group_memberships (user_id, group_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, group_id) DO NOTHING
      RETURNING *;
    `;
    const { rows } = await db.query(query, [userId, groupId]);
    return rows[0] || { success: true, message: 'User already member of group' };
  },

  /**
   * Retire un utilisateur d'un groupe — borné au tenant de l'appelant.
   *
   * L'ancienne version n'avait AUCUN contrôle : le DELETE ne portait que sur le
   * couple (user_id, group_id), et la route est ouverte à tout administrateur
   * authentifié. Un admin pouvait donc retirer des membres des groupes d'une
   * autre organisation.
   *
   * @param {number} tenantId - Tenant de l'appelant (périmètre autorisé).
   * @param {number} userId - ID de l'utilisateur.
   * @param {number} groupId - ID du groupe.
   * @returns {Promise<boolean>} True si l'appartenance a été supprimée.
   */
  removeUserFromGroup: async (tenantId, userId, groupId) => {
    const query = `
      DELETE FROM user_group_memberships ugm
      WHERE ugm.user_id = $1
        AND ugm.group_id = $2
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = $1 AND u.tenant_id = $3)
        AND EXISTS (SELECT 1 FROM groups g WHERE g.id = $2 AND g.tenant_id = $3)
      RETURNING id;
    `;
    const { rows } = await db.query(query, [userId, groupId, tenantId]);
    return rows.length > 0;
  },

  /**
   * Liste les utilisateurs membres d'un groupe — bornée au tenant de l'appelant.
   *
   * DEUX défauts corrigés ici, dont un de fuite :
   *   1. `SELECT u.*` exposait TOUTES les colonnes de `users`, y compris
   *      `password_hash` — des empreintes bcrypt sortaient par l'API à tout
   *      utilisateur authentifié, la route étant déclarée avant le roleMiddleware.
   *      Les colonnes sont désormais explicites : un oubli de table future ne
   *      re-divulguera rien.
   *   2. Aucun filtre de tenant : l'adhésion d'un groupe d'une AUTRE
   *      organisation était lisible (e-mails, rôles, sections).
   *
   * @param {number} tenantId - Tenant de l'appelant.
   * @param {number} groupId - ID du groupe.
   * @returns {Promise<Array>} Membres du groupe appartenant au tenant.
   */
  getUsersInGroup: async (tenantId, groupId) => {
    const query = `
      SELECT u.id, u.username, u.full_name, u.email, u.role, u.section, u.created_at
      FROM users u
      JOIN user_group_memberships ugm ON u.id = ugm.user_id
      JOIN groups g ON g.id = ugm.group_id
      WHERE ugm.group_id = $1
        AND g.tenant_id = $2
        AND u.tenant_id = $2;
    `;
    const { rows } = await db.query(query, [groupId, tenantId]);
    return rows;
  },

  /**
   * Liste les groupes d'un utilisateur — bornée au tenant de l'appelant.
   *
   * L'ancienne version listait les groupes de n'importe quel utilisateur de
   * n'importe quelle organisation (route ouverte à tout utilisateur authentifié).
   *
   * @param {number} tenantId - Tenant de l'appelant.
   * @param {number} userId - ID de l'utilisateur.
   * @returns {Promise<Array>} Groupes de l'utilisateur appartenant au tenant.
   */
  getUserGroups: async (tenantId, userId) => {
    const query = `
      SELECT g.*
      FROM groups g
      JOIN user_group_memberships ugm ON g.id = ugm.group_id
      WHERE ugm.user_id = $1
        AND g.tenant_id = $2
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = $1 AND u.tenant_id = $2);
    `;
    const { rows } = await db.query(query, [userId, tenantId]);
    return rows;
  },
};

module.exports = groupService;
