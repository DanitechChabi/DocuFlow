import api from './api';

/** Outils de gestion des documents (migration 044) et campagnes d'archivage. */
export const outilsService = {
  referentiel: async () => (await api.get('/archives/outils')).data,
  lancerCampagne: async () => (await api.post('/archives/campagnes')).data,
};
