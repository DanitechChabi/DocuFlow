import api from './api';

export const tenantService = {
  getAllTenants: async () => {
    const response = await api.get('/tenants');
    return response.data;
  },

  getTenant: async (id) => {
    const response = await api.get(`/tenants/${id}`);
    return response.data;
  },

  createTenant: async (data) => {
    const response = await api.post('/tenants', data);
    return response.data;
  },

  updateTenantStatus: async (id, status) => {
    const response = await api.patch(`/tenants/${id}/status`, { status });
    return response.data;
  },

  deleteTenant: async (id) => {
    const response = await api.delete(`/tenants/${id}`);
    return response.data;
  }
};
