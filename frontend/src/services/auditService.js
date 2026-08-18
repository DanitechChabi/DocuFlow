import api from './api';

/**
 * AuditService — Service pour la récupération des logs d'audit.
 * Seuls les utilisateurs avec le rôle 'admin' ou 'superadmin' peuvent accéder à ces données.
 */
export const auditService = {
  /**
   * Récupère la liste des logs d'audit pour l'organisation de l'utilisateur.
   * @returns {Promise<Array>} Liste des entrées d'audit.
   */
  async getAuditLogs() {
    const response = await api.get('/audit');
    return response.data;
  },
};
