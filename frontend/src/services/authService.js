import api from './api';

export const authService = {
  login: async (username, password, tenantSlug) => {
    const response = await api.post('/auth/login', { username, password, tenant_slug: tenantSlug });
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    return response.data;
  },
  register: async (userData) => {
    const response = await api.post('/auth/register', userData);
    return response.data;
  },
  registerCompany: async (data) => {
    const response = await api.post('/auth/register-company', data);
    return response.data;
  },
  getCompany: async (slug) => {
    const response = await api.get(`/auth/company/${slug}`);
    return response.data;
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },
  getCurrentUser: () => {
    try {
      const user = localStorage.getItem('user');
      return user ? JSON.parse(user) : null;
    } catch (err) {
      console.error('Failed to parse user from localStorage:', err);
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      return null;
    }
  },

  updateUser: (userData) => {
    localStorage.setItem('user', JSON.stringify(userData));
  }
};
