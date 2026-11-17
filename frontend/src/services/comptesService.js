import api from './api';

// Gestion des comptes (054) : liste, rôle et département, désactivation, mot de passe provisoire.
export const comptesService = {
  lister: async () => (await api.get('/comptes')).data,
  modifier: async (id, corps) => (await api.patch(`/comptes/${id}`, corps)).data,
  desactiver: async (id) => (await api.post(`/comptes/${id}/desactivation`)).data,
  reactiver: async (id) => (await api.post(`/comptes/${id}/reactivation`)).data,
  motDePasse: async (id) => (await api.post(`/comptes/${id}/mot-de-passe`)).data,
};
