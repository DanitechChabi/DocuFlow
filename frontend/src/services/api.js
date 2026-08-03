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

// Auto-logout sur 401 (token expiré ou invalide)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
