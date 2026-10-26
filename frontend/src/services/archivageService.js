import api from './api';

/** Archivage réglementaire (migration 032) : DUA, sort final, éliminations. */
export const archivageService = {
  definirDua: async (classeId, regle) => (await api.put(`/archives/classes/${classeId}/dua`, regle)).data,
  sortFinal: async (params = {}) => (await api.get('/archives/sort-final', { params })).data,
  decider: async (ids, decision, note) => (await api.post('/archives/sort-final/decisions', { document_ids: ids, decision, note })).data,
  echeanceDocument: async (id) => (await api.get(`/documents/${id}/dua`)).data,
  bordereaux: async (statut) => (await api.get('/archives/bordereaux', { params: statut ? { statut } : {} })).data,
  bordereau: async (id) => (await api.get(`/archives/bordereaux/${id}`)).data,
  creer: async (corps) => (await api.post('/archives/bordereaux', corps)).data,
  retirer: async (id, documentId) => (await api.delete(`/archives/bordereaux/${id}/documents/${documentId}`)).data,
  action: async (id, action, corps = {}) => (await api.post(`/archives/bordereaux/${id}/${action}`, corps)).data,
  pv: async (id) => (await api.get(`/archives/bordereaux/${id}/pv`)).data,
};

export const SORTS = { conservation: 'Conservation définitive', elimination: 'Élimination', tri: 'Tri' };
export const POINTS = { date_document: 'Date du document', creation: 'Entrée dans la GED', archivage: 'Archivage' };
export const STATUTS_BORDEREAU = {
  brouillon: ['Brouillon', 'bg-slate-100 text-slate-600'], propose: ['Proposé', 'bg-blue-50 text-blue-700'],
  valide: ['Validé', 'bg-emerald-50 text-emerald-700'], rejete: ['Rejeté', 'bg-red-50 text-red-700'],
  execute: ['Exécuté', 'bg-slate-800 text-white'], annule: ['Annulé', 'bg-slate-100 text-slate-400'],
};
export const dateFr = (v) => (v ? new Date(String(v).length === 10 ? `${v}T00:00:00` : v).toLocaleDateString('fr-FR') : '—');
export const taille = (o) => (!o ? '0 o' : o < 1048576 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1048576).toFixed(1)} Mo`);
