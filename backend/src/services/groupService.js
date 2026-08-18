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
   * Ajoute un utilisateur à un groupe après vérification de l'appartenance au même tenant.
   * @param {number} userId - ID de l'utilisateur.
   * @param {number} groupId - ID du groupe.
   * @returns {Promise<Object>} Le résultat de l'opération.
   */
  addUserToGroup: async (userId, groupId) => {
    // Vérification de sécurité : l'utilisateur et le groupe doivent appartenir au même tenant
    const checkQuery = `
      SELECT u.tenant_id as user_tenant, g.tenant_id as group_tenant
      FROM users u, groups g
      WHERE u.id = $1 AND g.id = $2;
    `;
    const { rows: checkRows } = await db.query(checkQuery, [userId, groupId]);

    if (checkRows.length === 0) {
      throw new Error('User or group not found');
    }

    if (checkRows[0].user_tenant !== checkRows[0].group_tenant) {
      throw new Error('User and group must belong to the same organization');
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
   * Retire un utilisateur d'un groupe.
   * @param {number} userId - ID de l'utilisateur.
   * @param {number} groupId - ID du groupe.
   * @returns {Promise<boolean>} True si l'appartenance a été supprimée.
   */
  removeUserFromGroup: async (userId, groupId) => {
    const query = `DELETE FROM user_group_memberships WHERE user_id = $1 AND group_id = $2 RETURNING id;`;
    const { rows } = await db.query(query, [userId, groupId]);
    return rows.length > 0;
  },

  /**
   * Liste tous les utilisateurs membres d'un groupe donné.
   * @param {number} groupId - ID du groupe.
   * @returns {Promise<Array>} Liste des utilisateurs.
   */
  getUsersInGroup: async (groupId) => {
    const query = `
      SELECT u.*
      FROM users u
      JOIN user_group_memberships ugm ON u.id = ugm.user_id
      WHERE ugm.group_id = $1;
    `;
    const { rows } = await db.query(query, [groupId]);
    return rows;
  },

  /**
   * Liste tous les groupes auxquels un utilisateur appartient.
   * @param {number} userId - ID de l'utilisateur.
   * @returns {Promise<Array>} Liste des groupes.
   */
  getUserGroups: async (userId) => {
    const query = `
      SELECT g.*
      FROM groups g
      JOIN user_group_memberships ugm ON g.id = ugm.group_id
      WHERE ugm.user_id = $1;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows;
  },
};

module.exports = groupService;
