import api from './api';

// Entrée des dossiers aux archives (migration 049).
export const entreeService = {
  importer: async (corps) => (await api.post('/entrees/import', corps)).data,
  semaines: async (annee) => (await api.get('/entrees/semaines', { params: { annee } })).data,
  semaine: async (debut) => (await api.get(`/entrees/semaines/${debut}`)).data,
  rechercher: async (params) => (await api.get('/entrees/recherche', { params })).data,
  filtres: async () => (await api.get('/entrees/filtres')).data,
};
