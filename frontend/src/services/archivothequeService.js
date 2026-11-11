import api from './api';
import { urlApi } from './collaborationService';

/** Archivothèque virtuelle (migration 045) : gestion par le personnel, vitrine publique. */
export const archivothequeService = {
  lister: async () => (await api.get('/archives/archivotheque')).data,
  pourDocument: async (documentId) => (await api.get(`/documents/${documentId}/archivotheque`)).data.piece,
  proposer: async (documentId, corps) => (await api.post(`/documents/${documentId}/archivotheque`, corps)).data,
  autoriser: async (id) => (await api.post(`/archives/archivotheque/${id}/autorisation`)).data,
  retirer: async (id, motif) => (await api.post(`/archives/archivotheque/${id}/retrait`, { motif })).data,
  // Vitrine publique : fetch nu (l'instance axios authentifiée déconnecte sur un 401).
  vitrine: async (slug) => {
    const r = await fetch(`${urlApi()}/archivotheque/${encodeURIComponent(slug)}`);
    if (!r.ok) throw new Error(r.status === 404 ? 'introuvable' : 'indisponible');
    return r.json();
  },
  urlFichier: (slug, id, lecture = false) => `${urlApi()}/archivotheque/${encodeURIComponent(slug)}/pieces/${id}/fichier${lecture ? '?lecture=1' : ''}`,
};

export const STATUTS_PIECE = {
  proposee: ['À autoriser', 'bg-amber-50 text-amber-700'], publiee: ['En ligne', 'bg-emerald-50 text-emerald-700'], retiree: ['Retirée', 'bg-slate-100 text-slate-500'],
};
