import axios from 'axios';

// URL de l'API : surchargeable en déploiement via VITE_API_URL (ex. https://api.example.com/api)
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:30001/api';

const api = axios.create({
  baseURL: API_URL,
  // Pas de Content-Type global : axios pose `application/json` automatiquement
  // pour les objets, et laisse le navigateur générer `multipart/form-data; boundary=...`
  // pour les FormData (poser le header à la main sans boundary casse multer/busboy).
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Auto-logout sur 401 (token expiré ou invalide), signalement sur 402 (licence)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    if (status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }

    // 402 — licence bureau absente ou expirée (licenseMiddleware).
    //
    // ON SIGNALE, ON NE REDIRIGE PAS. Un `window.location.href` ici arracherait
    // l'utilisateur à son écran — formulaire en cours de saisie compris — sur un
    // simple appel de fond, par exemple le compteur de notifications qui tourne
    // en arrière-plan. C'est LicenseContext qui décide de la suite : lui seul
    // sait si l'on est en mode bureau, et il a accès au routeur.
    //
    // La session n'est PAS effacée, contrairement au 401 : la licence est un
    // problème d'abonnement du poste, pas d'identité de l'utilisateur. Le
    // déconnecter l'obligerait à retaper son mot de passe après renouvellement.
    if (status === 402 && error.response?.data?.code === 'LICENSE_REQUIRED') {
      window.dispatchEvent(new CustomEvent('docuflow:license-required', {
        detail: error.response.data,
      }));
    }

    return Promise.reject(error);
  }
);

export default api;

// Google OAuth Client ID (accessible dans les composants via import.meta.env)
// Configuré dans Vercel : VITE_GOOGLE_CLIENT_ID
