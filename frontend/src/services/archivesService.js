import api from './api';

/** Archivage : preuve et intégrité (migration 031). */
export const archivesService = {
  // Volet d'un document
  etatDocument: async (id) => (await api.get(`/documents/${id}/integrite`)).data,
  verifierDocument: async (id) => (await api.post(`/documents/${id}/integrite/verifier`)).data,
  emettreCertificat: async (id) => (await api.post(`/documents/${id}/certificat`)).data,
  poserGel: async (id, { motif, reference }) => (await api.post(`/documents/${id}/gel`, { motif, reference })).data,
  leverGel: async (id, motif) => (await api.post(`/documents/${id}/gel/levee`, { motif })).data,
  // Page Archivage
  rapport: async () => (await api.get('/archives/integrite')).data,
  anomalies: async () => (await api.get('/archives/integrite/anomalies')).data,
  doublons: async () => (await api.get('/archives/integrite/doublons')).data,
  verifierLot: async (lot = 25) => (await api.post('/archives/integrite/verifier', { lot })).data,
  verifierJournal: async () => (await api.get('/archives/journal/verification')).data,
  sceaux: async () => (await api.get('/archives/journal/sceaux')).data,
  sceller: async () => (await api.post('/archives/journal/sceaux')).data,
  gels: async (statut = 'actifs') => (await api.get('/archives/gels', { params: { statut } })).data,
  verifierCertificat: async (numero, empreinte) => (await api.get(`/archives/certificats/${encodeURIComponent(numero)}`, { params: empreinte ? { empreinte } : {} })).data,
  /** Relevé des sceaux en CSV, à conserver HORS de DocuFlow. */
  exporterSceaux: async () => {
    const r = await api.get('/archives/journal/sceaux', { params: { format: 'csv' }, responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sceaux-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export const STATUTS_INTEGRITE = {
  intacte: { libelle: 'Intacte', classe: 'bg-emerald-50 text-emerald-700 border-emerald-200', point: 'bg-emerald-500' },
  alteree: { libelle: 'Altérée', classe: 'bg-red-50 text-red-700 border-red-200', point: 'bg-red-500' },
  introuvable: { libelle: 'Introuvable', classe: 'bg-orange-50 text-orange-700 border-orange-200', point: 'bg-orange-500' },
  attente: { libelle: 'Contrôle en attente', classe: 'bg-slate-50 text-slate-600 border-slate-200', point: 'bg-slate-400' },
};

/** Empreinte lisible : groupes de 4, tronquée au milieu si demandé. */
export const empreinteCourte = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-8)}` : '—');
export const empreinteGroupee = (h) => (h ? h.match(/.{1,4}/g).join(' ') : '—');

export const dateHeure = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const dateCourte = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');
