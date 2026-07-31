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
  getMyTasks: async () => {
    const response = await api.get('/requests/my-tasks');
    return response.data;
  },
  assignRequest: async (requestId, assigneeId) => {
    const response = await api.patch(`/requests/${requestId}/assign`, { assignee_id: assigneeId });
    return response.data;
  },
  getArchivists: async () => {
    const response = await api.get('/users/archivists');
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
