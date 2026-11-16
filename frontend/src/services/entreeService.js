import api from './api';

// Entrée des dossiers aux archives (migration 049).
export const entreeService = {
  importer: async (corps) => (await api.post('/entrees/import', corps)).data,
  semaines: async (annee) => (await api.get('/entrees/semaines', { params: { annee } })).data,
  semaine: async (debut) => (await api.get(`/entrees/semaines/${debut}`)).data,
  rechercher: async (params) => (await api.get('/entrees/recherche', { params })).data,
  filtres: async () => (await api.get('/entrees/filtres')).data,
  // Douchette (053) : lire un code, sortir, rentrer.
  douchette: async (code) => (await api.get('/entrees/douchette', { params: { code } })).data,
  sortieDouchette: async (corps) => (await api.post('/entrees/douchette/sortie', corps)).data,
  retourDouchette: async (corps) => (await api.post('/entrees/douchette/retour', corps)).data,
  // Plan de rangement (052) : les armoires.
  rangements: async () => (await api.get('/entrees/rangements')).data,
  creerRangement: async (corps) => (await api.post('/entrees/rangements', corps)).data,
  modifierRangement: async (id, corps) => (await api.put(`/entrees/rangements/${id}`, corps)).data,
  supprimerRangement: async (id) => (await api.delete(`/entrees/rangements/${id}`)).data,
  planRangement: async () => (await api.get('/entrees/rangements/plan')).data,
  installerPlan: async () => (await api.post('/entrees/rangements/plan')).data,
  fichiers: async () => (await api.get('/entrees/fichiers')).data,
  supprimerFichier: async (corps) => (await api.delete('/entrees/fichiers', { data: corps })).data,
  // Présence d'un dossier demandé aux archives (050) : ouverte aux demandeurs.
  presence: async (dossier) => (await api.get('/entrees/presence', { params: dossier })).data,
  presences: async (dossiers) => (await api.post('/entrees/presences', { dossiers })).data,
};
