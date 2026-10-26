import api from './api';

/** Conformité : alertes d'incohérence entre documents, fournisseurs, analyse (migration 030). */
export const conformiteService = {
  tableauDeBord: async () => (await api.get('/compliance/dashboard')).data,
  alertes: async (filtres = {}) => (await api.get('/compliance/alerts', { params: filtres })).data,
  traiterAlerte: async (id, statut, note) => (await api.patch(`/compliance/alerts/${id}`, { statut, note })).data,
  recalculer: async ({ analyser = false } = {}) => (await api.post('/compliance/recalculate', { analyser })).data,
  fournisseurs: async () => (await api.get('/suppliers')).data,
  documentsFournisseur: async (cle) => (await api.get(`/suppliers/${encodeURIComponent(cle)}`)).data,
  /** Export CSV : téléchargé par le navigateur (jeton porté par l'appel API). */
  exporterFournisseurs: async () => {
    const r = await api.get('/suppliers', { params: { format: 'csv' }, responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fournisseurs-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  analyseDocument: async (id) => (await api.get(`/documents/${id}/analysis`)).data,
  relancerAnalyse: async (id) => (await api.post(`/documents/${id}/analysis`)).data,
};

export const SEVERITES = {
  critique: { libelle: 'Critique', classe: 'bg-red-100 text-red-700 border-red-200', point: 'bg-red-500' },
  haute: { libelle: 'Haute', classe: 'bg-orange-100 text-orange-700 border-orange-200', point: 'bg-orange-500' },
  moyenne: { libelle: 'Moyenne', classe: 'bg-amber-100 text-amber-700 border-amber-200', point: 'bg-amber-400' },
  faible: { libelle: 'Faible', classe: 'bg-slate-100 text-slate-600 border-slate-200', point: 'bg-slate-400' },
};

export const NATURES = { facture: 'Facture', devis: 'Devis', attestation: 'Attestation', autre: 'Autre' };

export const STATUTS_ALERTE = {
  ouverte: 'Ouverte', traitee: 'Traitée', ignoree: 'Ignorée', resolue: 'Résolue',
};

/** Montant lisible avec sa devise (FCFA par défaut). */
export const montant = (n, devise) => (n === null || n === undefined || n === ''
  ? '—'
  : `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${devise === 'EUR' ? '€' : devise === 'USD' ? '$' : 'FCFA'}`);
