import api from './api';

export const sectionService = {
  getSections: async () => {
    const response = await api.get('/sections');
    return response.data;
  },
  createSection: async (name) => {
    const response = await api.post('/sections', { name });
    return response.data;
  },
  deleteSection: async (id) => {
    const response = await api.delete(`/sections/${id}`);
    return response.data;
  },
};
