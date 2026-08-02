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
};
