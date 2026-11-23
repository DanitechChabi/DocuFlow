import axios from 'axios';

// URL de l'API : surchargeable en déploiement via VITE_API_URL (ex. https://api.example.com/api)
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:30001/api';

const api = axios.create({
  baseURL: API_URL,
  // Le serveur en ligne peut mettre ~50 s à se réveiller : au-delà de 90 s, on
  // prévient plutôt que de laisser tourner indéfiniment.
  timeout: 90000,
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
    // Pas de réponse du serveur : on dit pourquoi, simplement. Les écrans
    // affichent error.response.data.message : on le remplit pour eux.
    if (!error.response && !axios.isCancel(error)) {
      const horsLigne = typeof navigator !== 'undefined' && navigator.onLine === false;
      const message = horsLigne
        ? 'Pas de connexion Internet. Vérifiez le réseau puis réessayez.'
        : error.code === 'ECONNABORTED'
          ? 'Le serveur met trop de temps à répondre. Réessayez dans un instant.'
          : 'Le serveur ne répond pas. Il redémarre peut-être : réessayez dans une minute.';
      error.response = { status: 0, data: { message, code: horsLigne ? 'HORS_LIGNE' : 'SERVEUR_INJOIGNABLE' }, headers: {} };
      error.message = message;
      return Promise.reject(error);
    }
    const status = error.response?.status;
    const data = error.response?.data;
    // Réponse sans message lisible (page d'erreur du proxy, fichier binaire…).
    if (status >= 500 && !(data && typeof data === 'object' && data.message)) {
      const message = status === 502 || status === 503 || status === 504
        ? 'Le serveur démarre ou est momentanément indisponible. Réessayez dans une minute.'
        : 'Une erreur inattendue s\'est produite sur le serveur. Réessayez ; si elle se répète, prévenez l\'administrateur.';
      error.response.data = { ...(data && typeof data === 'object' ? data : {}), message };
    }

    if (status === 401 && window.location.pathname !== '/login') {
      try {
        sessionStorage.setItem('raison-deconnexion', data?.message || 'Votre session a expiré : reconnectez-vous.');
        // Revenir là où l'on était, une fois reconnecté.
        sessionStorage.setItem('apres-connexion', window.location.pathname + window.location.search);
      } catch { /* sans gravité */ }
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }

    // Mot de passe provisoire (061) : la page pour le changer, et rien d'autre.
    if (status === 403 && data?.code === 'MDP_A_CHANGER' && window.location.pathname !== '/mot-de-passe') {
      try {
        const u = JSON.parse(localStorage.getItem('user') || 'null');
        if (u) localStorage.setItem('user', JSON.stringify({ ...u, mdp_a_changer: true }));
      } catch { /* sans gravité */ }
      window.location.href = '/mot-de-passe';
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
