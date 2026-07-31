import axios from 'axios';

// URL de l'API : surchargeable en déploiement via VITE_API_URL (ex. https://api.example.com/api)
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:30001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
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

export default api;
