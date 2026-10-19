import api from './api';

/**
 * Émis à chaque ouverture ou fermeture de session. Les fournisseurs montés
 * AVANT la connexion (PermissionsProvider : rôle, permissions, progression de
 * la visite guidée) s'en servent pour se recharger — sans lui, ils gardaient
 * l'état « hors session » jusqu'au prochain rechargement de la page : menu
 * complet affiché à tort, visite d'accueil jamais lancée.
 */
export const AUTH_CHANGED_EVENT = 'docuflow:auth-changed';
const signalerSession = () => {
  try { window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT)); } catch { /* hors navigateur */ }
};

export const authService = {
  login: async (username, password, tenantSlug) => {
    const response = await api.post('/auth/login', { username, password, tenant_slug: tenantSlug });
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      signalerSession();
    }
    return response.data;
  },
  signalerSession,
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
    signalerSession();
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
