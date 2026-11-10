import api from './api';

/** Courrier — bureau d'ordre (migration 041). */
export const courrierService = {
  lister: async (params) => (await api.get('/courriers', { params })).data,
  synthese: async () => (await api.get('/courriers/synthese')).data,
  agents: async () => (await api.get('/courriers/agents')).data,
  correspondants: async (q) => (await api.get('/courriers/correspondants', { params: { q } })).data,
  enregistrer: async (corps) => (await api.post('/courriers', corps)).data,
  lire: async (id) => (await api.get(`/courriers/${id}`)).data,
  modifier: async (id, corps) => (await api.patch(`/courriers/${id}`, corps)).data,
  affecter: async (id, corps) => (await api.post(`/courriers/${id}/affectation`, corps)).data,
  prendreEnCharge: async (id) => (await api.post(`/courriers/${id}/prise-en-charge`)).data,
  annoter: async (id, note) => (await api.post(`/courriers/${id}/notes`, { note })).data,
  clore: async (id, corps) => (await api.post(`/courriers/${id}/cloture`, corps)).data,
  repondre: async (id, corps = {}) => (await api.post(`/courriers/${id}/reponse`, corps)).data,
  expedier: async (id, corps = {}) => (await api.post(`/courriers/${id}/expedition`, corps)).data,
  accuseReception: async (id, numero) => {
    const r = await api.get(`/courriers/${id}/accuse-reception`, { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `accuse-reception-${numero}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
};

export const SENS = { arrivee: 'Arrivée', depart: 'Départ', interne: 'Interne' };
export const STATUTS = {
  enregistre: ['À affecter', 'bg-amber-50 text-amber-700 border-amber-200'],
  affecte: ['Affecté', 'bg-blue-50 text-blue-700 border-blue-200'],
  en_traitement: ['En traitement', 'bg-indigo-50 text-indigo-700 border-indigo-200'],
  brouillon: ['À expédier', 'bg-amber-50 text-amber-700 border-amber-200'],
  expedie: ['Expédié', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
  clos: ['Clos', 'bg-slate-100 text-slate-600 border-slate-200'],
};
export const MOTIFS = { repondu: 'Répondu', information: 'Pour information', sans_suite: 'Sans suite', expedie: 'Expédié' };
export const CANAUX = { papier: 'Remis en main propre', poste: 'Poste', porteur: 'Porteur', email: 'E-mail', portail: 'Portail', autre: 'Autre' };
export const NATURES = { lettre: 'Lettre', note: 'Note de service', demande: 'Demande', reclamation: 'Réclamation', invitation: 'Invitation', facture: 'Facture', rapport: 'Rapport', autre: 'Autre' };
export const EVENEMENTS = {
  ENREGISTRE: 'Enregistré au registre', AFFECTE: 'Affecté', REAFFECTE: 'Réaffecté', PRIS_EN_CHARGE: 'Pris en charge', NOTE: 'Note',
  REPONSE_PREPAREE: 'Réponse préparée', EXPEDIE: 'Expédié', CLOS: 'Clos', MODIFIE: 'Fiche corrigée', ACCUSE_RECEPTION: 'Accusé de réception délivré',
};
export const INSTRUCTIONS = ['Pour attribution', 'Pour étude et avis', 'Pour suite à donner', 'Pour projet de réponse', "M'en parler", 'Pour information', 'Pour classement'];
export const dateFr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
