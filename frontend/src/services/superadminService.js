import api from './api';

export const superadminService = {
  // Stats globales
  getStats: async () => {
    const res = await api.get('/superadmin/stats');
    return res.data;
  },

  // Utilisateurs (tous tenants)
  getAllUsers: async () => {
    const res = await api.get('/superadmin/users');
    return res.data;
  },

  getSuperAdmins: async () => {
    const res = await api.get('/superadmin/users/superadmins');
    return res.data;
  },

  createUser: async (data) => {
    const res = await api.post('/superadmin/users', data);
    return res.data;
  },

  updateUser: async (id, data) => {
    const res = await api.patch(`/superadmin/users/${id}`, data);
    return res.data;
  },

  deleteUser: async (id) => {
    const res = await api.delete(`/superadmin/users/${id}`);
    return res.data;
  },

  resetPassword: async (id, newPassword) => {
    const res = await api.post(`/superadmin/users/${id}/reset-password`, { new_password: newPassword });
    return res.data;
  },

  // Demandes (tous tenants)
  getAllRequests: async (params = {}) => {
    const res = await api.get('/superadmin/requests', { params });
    return res.data;
  },

  archiveRequest: async (id) => {
    const res = await api.patch(`/superadmin/requests/${id}/archive`);
    return res.data;
  },

  unarchiveRequest: async (id) => {
    const res = await api.patch(`/superadmin/requests/${id}/unarchive`);
    return res.data;
  },

  deleteRequest: async (id) => {
    const res = await api.delete(`/superadmin/requests/${id}`);
    return res.data;
  },

  // Entreprises — suppression définitive.
  // `confirm` doit reprendre le nom exact de l'entreprise : le backend refuse
  // sinon (garde-fou contre le clic sur la mauvaise carte).
  deleteTenant: async (id, confirm) => {
    const res = await api.delete(`/superadmin/tenants/${id}`, { data: { confirm } });
    return res.data;
  },

  // Journal d'audit global (toutes entreprises)
  getAuditLogs: async (params = {}) => {
    const res = await api.get('/superadmin/audit', { params });
    return res.data;
  },

  // Purge du journal. `confirm` doit valoir exactement « VIDER LE JOURNAL ».
  // Options : { tenant_id } pour une seule entreprise, { before } (ISO 8601)
  // pour ne purger que les entrées antérieures à une date.
  purgeAuditLogs: async ({ confirm, tenant_id, before } = {}) => {
    const res = await api.delete('/superadmin/audit', { data: { confirm, tenant_id, before } });
    return res.data;
  },

  // Licences de bureau — inventaire et administration.
  //
  // Réservé au propriétaire de la plateforme (platformOwnerMiddleware). Ne pas
  // confondre avec services/licenseService.js, qui parle au poste local via
  // /license au singulier : ces routes-là n'existent qu'en mode bureau.
  //
  // La table renvoyée n'accepte ni pagination, ni tri, ni filtre côté serveur —
  // ne pas passer de `params`, ils seraient ignorés en silence et donneraient
  // l'illusion d'un filtrage.
  getLicenses: async () => {
    const res = await api.get('/superadmin/licenses');
    return res.data;
  },

  // { months, customer_email, customer_company, notes, tenant_id }.
  // `months` est borné à [0, 36] par le backend ; 0 émet une clé sans échéance
  // (statut « pending »), ce qui est le cas d'une clé d'essai à prolonger plus tard.
  createLicense: async (data) => {
    const res = await api.post('/superadmin/licenses', data);
    return res.data;
  },

  // { status, notes, months }. `months` CUMULE sur le reliquat (extend_license
  // part de GREATEST(now(), valid_until)) au lieu de l'écraser. `status`
  // n'accepte que active | revoked | pending : « expired » est calculé à partir
  // de la date et le poser à la main créerait une licence expirée à échéance
  // future, que la péremption automatique ne corrigerait jamais.
  updateLicense: async (id, data) => {
    const res = await api.patch(`/superadmin/licenses/${id}`, data);
    return res.data;
  },

  // Délie le poste : machine_id et machine_label repassent à NULL. Aucun corps.
  // La réponse porte un `warning` à afficher — l'ancien poste reste utilisable
  // jusqu'à la péremption de son artefact hors ligne.
  resetLicenseMachine: async (id) => {
    const res = await api.post(`/superadmin/licenses/${id}/reset-machine`);
    return res.data;
  },
};
