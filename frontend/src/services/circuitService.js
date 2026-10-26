import api from './api';

/** Circuits de validation (migration 034). */
export const circuitService = {
  modeles: async () => (await api.get('/circuits')).data,
  referentiel: async () => (await api.get('/circuits/referentiel')).data,
  suivi: async () => (await api.get('/circuits/suivi')).data,
  enregistrer: async (modele) => (modele.id
    ? api.put(`/circuits/${modele.id}`, modele) : api.post('/circuits', modele)).then((r) => r.data),
  supprimer: async (id) => (await api.delete(`/circuits/${id}`)).data,
  mesTaches: async (vue = 'a_traiter') => (await api.get('/taches', { params: { vue } })).data,
  compte: async () => (await api.get('/taches/compte')).data,
  decider: async (tacheId, decision, commentaire) => (await api.post(`/taches/${tacheId}/decision`, { decision, commentaire })).data,
  delegataires: async (tacheId) => (await api.get(`/taches/${tacheId}/delegataires`)).data,
  deleguer: async (tacheId, utilisateurId, commentaire) => (await api.post(`/taches/${tacheId}/delegation`, { utilisateur_id: utilisateurId, commentaire })).data,
  etatDocument: async (id) => (await api.get(`/documents/${id}/circuit`)).data,
  demarrer: async (id, circuitId) => (await api.post(`/documents/${id}/circuit`, { circuit_id: circuitId })).data,
  annuler: async (id, motif) => (await api.post(`/documents/${id}/circuit/annulation`, { motif })).data,
  reprendre: async (id, motif) => (await api.post(`/documents/${id}/circuit/reprise`, { motif })).data,
};

export const STATUT_ETAPE = {
  terminée: 'bg-emerald-500', 'en cours': 'bg-blue-500', refusée: 'bg-red-500', interrompue: 'bg-slate-400', 'à venir': 'bg-slate-200', 'non atteinte': 'bg-slate-200',
};
export const DECISION = { approuvé: 'Approuvé', refusé: 'Refusé', vu: 'Pris connaissance' };
export const quand = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
