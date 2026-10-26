import api from './api';

/** Collaboration documentaire (migration 033). */
export const collaborationService = {
  etat: async (id) => (await api.get(`/documents/${id}/collaboration`)).data,
  favori: async (id, actif) => (actif ? api.put(`/documents/${id}/favori`) : api.delete(`/documents/${id}/favori`)).then((r) => r.data),
  suivi: async (id, actif) => (actif ? api.put(`/documents/${id}/suivi`) : api.delete(`/documents/${id}/suivi`)).then((r) => r.data),
  favoris: async () => (await api.get('/collaboration/favoris')).data,
  suivis: async () => (await api.get('/collaboration/suivis')).data,
  commentaires: async (id) => (await api.get(`/documents/${id}/commentaires`)).data,
  mentionnables: async (id, q) => (await api.get(`/documents/${id}/commentaires/mentionnables`, { params: { q } })).data,
  commenter: async (id, contenu, parentId = null) => (await api.post(`/documents/${id}/commentaires`, { contenu, parent_id: parentId })).data,
  modifierCommentaire: async (id, cid, contenu) => (await api.patch(`/documents/${id}/commentaires/${cid}`, { contenu })).data,
  supprimerCommentaire: async (id, cid) => (await api.delete(`/documents/${id}/commentaires/${cid}`)).data,
  partages: async (id) => (await api.get(`/documents/${id}/partages`)).data,
  creerPartage: async (id, options) => (await api.post(`/documents/${id}/partages`, options)).data,
  revoquerPartage: async (id, pid) => (await api.delete(`/documents/${id}/partages/${pid}`)).data,
  restaurerVersion: async (id, fileId) => (await api.post(`/documents/${id}/files/${fileId}/restaurer`)).data,
};

/** Adresse de l'API, pour la page publique (qui n'utilise pas l'instance authentifiée). */
export const urlApi = () => api.defaults.baseURL || '/api';
