import api from './api';

export const requestDetailsService = {
  getDetails: async (id) => {
    const response = await api.get(`/request-details/${id}`);
    return response.data;
  },
};
