import api from './api';

// Listes de demandes et cadre des sorties (migration 047).
export const listeService = {
  /** Cadres proposés (motifs de demande de l'organisation). */
  cadres: async () => (await api.get('/requests/cadres')).data,
  /** Dossiers déjà demandés qui correspondent à la saisie (demande en un clic). */
  dossiersConnus: async (q) => (await api.get('/requests/dossiers-connus', { params: { q } })).data,
  creer: async (corps) => (await api.post('/requests/listes', corps)).data,
  lister: async (params = {}) => (await api.get('/requests/listes', { params })).data,
  detail: async (id) => (await api.get(`/requests/listes/${id}`)).data,
  transmettre: async (id, corps = {}) => (await api.post(`/requests/listes/${id}/transmission`, corps)).data,
  retourner: async (id, corps = {}) => (await api.post(`/requests/listes/${id}/retour`, corps)).data,
  /** Registre des sorties, filtrable par état, cadre, liste et recherche. */
  sorties: async (params = {}) => (await api.get('/requests/loans', { params })).data,
};

// Demandes reçues par l'archive (téléphone) : agents, et enregistrement au nom d'un agent.
listeService.demandeurs = async () => (await api.get('/requests/demandeurs')).data;
listeService.pourAgent = async (corps) => (await api.post('/requests/pour-agent', corps)).data;
// L'archive précise la typologie d'une demande arrivée sans elle.
listeService.typologie = async (id, typeDocument) => (await api.patch(`/requests/${id}/typologie`, { type_document: typeDocument })).data;
