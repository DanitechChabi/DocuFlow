import api from './api';

/** Archives papier (migration 038) : emplacements, localisation, récolement. */
export const physiqueService = {
  emplacements: async () => (await api.get('/archives/emplacements')).data,
  creer: async (corps) => (await api.post('/archives/emplacements', corps)).data,
  modifier: async (id, corps) => (await api.patch(`/archives/emplacements/${id}`, corps)).data,
  supprimer: async (id) => (await api.delete(`/archives/emplacements/${id}`)).data,
  contenu: async (id) => (await api.get(`/archives/emplacements/${id}/documents`)).data,
  localisation: async (documentId) => (await api.get(`/documents/${documentId}/localisation`)).data,
  placer: async (documentId, corps) => (await api.put(`/documents/${documentId}/localisation`, corps)).data,
  recolements: async () => (await api.get('/archives/recolements')).data,
  ouvrir: async (corps) => (await api.post('/archives/recolements', corps)).data,
  recolement: async (id) => (await api.get(`/archives/recolements/${id}`)).data,
  constater: async (id, constats) => (await api.post(`/archives/recolements/${id}/constats`, { constats })).data,
  clore: async (id, observations) => (await api.post(`/archives/recolements/${id}/cloture`, { observations })).data,
  pv: async (id) => (await api.get(`/archives/recolements/${id}/pv`)).data,
};

export const TYPES_EMPLACEMENT = { depot: 'Dépôt', magasin: 'Magasin', travee: 'Travée', tablette: 'Tablette', boite: 'Boîte' };
export const ENFANT_DE = { depot: 'magasin', magasin: 'travee', travee: 'tablette', tablette: 'boite' };
export const SUPPORTS = { numerique: 'Numérique', papier: 'Papier', hybride: 'Hybride (papier et numérique)' };
export const RESULTATS = {
  present: ['Présent', 'bg-emerald-50 text-emerald-700'], absent: ['Absent', 'bg-red-50 text-red-700'],
  deplace: ['Déplacé', 'bg-amber-50 text-amber-700'], abime: ['Abîmé', 'bg-orange-50 text-orange-700'],
  en_pret: ['En prêt', 'bg-blue-50 text-blue-700'],
};
export const NATURES_PRET = { original: "Original", copie: 'Copie', consultation: 'Consultation sur place' };
