import api from './api';

export const requestService = {
  createRequest: async (requestData) => {
    const response = await api.post('/requests', requestData);
    return response.data;
  },
  getMyRequests: async () => {
    const response = await api.get('/requests/my-requests');
    return response.data;
  },
  getAllRequests: async () => {
    const response = await api.get('/requests/all');
    return response.data;
  },
  verifyMfile: async (requestId) => {
    const response = await api.get(`/requests/${requestId}/verify-mfile`);
    return response.data;
  },
  updateStatus: async (requestId, statusData) => {
    const response = await api.patch(`/requests/${requestId}/status`, statusData);
    return response.data;
  },
  getStats: async () => {
    const response = await api.get('/requests/stats');
    return response.data;
  },
  getAuditLogs: async () => {
    const response = await api.get('/requests/history');
    return response.data;
  }
};
