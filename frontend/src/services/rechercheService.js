import api from './api';

/** Recherche avancée, recherches enregistrées, échéancier, paquet d'archive (migration 035). */
const telecharger = (blob, nom) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const rechercheService = {
  rechercher: async (criteres, { page = 1, tri } = {}) => (await api.post('/documents/recherche', { criteres, page, tri })).data,
  referentiel: async () => (await api.get('/recherche/referentiel')).data,
  recherches: async () => (await api.get('/recherches')).data,
  enregistrer: async (r) => (r.id ? api.patch(`/recherches/${r.id}`, r) : api.post('/recherches', r)).then((x) => x.data),
  supprimer: async (id) => (await api.delete(`/recherches/${id}`)).data,
  echeancier: async (vue = 'a_venir') => (await api.get('/echeances', { params: { vue } })).data,
  echeancesDocument: async (id) => (await api.get(`/documents/${id}/echeances`)).data,
  creerEcheance: async (id, e) => (await api.post(`/documents/${id}/echeances`, e)).data,
  traiterEcheance: async (id, commentaire) => (await api.post(`/echeances/${id}/traitement`, { commentaire })).data,
  annulerEcheance: async (id) => (await api.post(`/echeances/${id}/annulation`)).data,
  reporterEcheance: async (id, au) => (await api.post(`/echeances/${id}/report`, { au })).data,
  supprimerEcheance: async (id) => (await api.delete(`/echeances/${id}`)).data,
  /** Paquet d'archive (ZIP) d'un document ou d'une sélection. */
  paquet: async (ids, { versions = 'courante' } = {}) => {
    const r = ids.length === 1
      ? await api.get(`/documents/${ids[0]}/paquet`, { params: { versions }, responseType: 'blob' })
      : await api.post('/documents/paquet', { ids, versions }, { responseType: 'blob' });
    const nom = /filename="([^"]+)"/.exec(r.headers['content-disposition'] || '')?.[1] || 'paquet-archive.zip';
    telecharger(r.data, nom);
  },
};

/** Message d'erreur d'une réponse binaire (blob JSON). */
export const messageBlob = async (err, defaut) => {
  try { return JSON.parse(await err.response.data.text()).message || defaut; } catch { return err.response?.data?.message || defaut; }
};
