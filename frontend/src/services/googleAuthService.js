import api from './api';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

/**
 * Service d'authentification Google.
 * Utilise Google Identity Services (GIS) pour l'authentification côté client.
 */
export const googleAuthService = {
  /** Le Client ID Google est-il configuré ? */
  isConfigured: () => !!GOOGLE_CLIENT_ID,

  /** Charger le script Google Identity Services */
  loadScript: () => {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) {
        resolve(window.google.accounts.id);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve(window.google?.accounts?.id);
      script.onerror = () => reject(new Error('Impossible de charger Google Identity Services'));
      document.head.appendChild(script);
    });
  },

  /** Envoyer le credential Google au backend */
  loginWithCredential: async (credential) => {
    const response = await api.post('/auth/google', { credential });
    const data = response.data;
    if (data.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
    }
    return data;
  },

  /** Initialiser le bouton Google dans un conteneur DOM */
  renderButton: (container, options = {}) => {
    if (!window.google?.accounts?.id || !GOOGLE_CLIENT_ID) return;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: options.onSuccess || (() => {}),
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    window.google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width: container?.offsetWidth || 300,
      ...options.buttonConfig,
    });
  },

  /** Déconnexion Google (réinitialiser l'état) */
  revoke: () => {
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  },
};
