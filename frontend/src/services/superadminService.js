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
};
