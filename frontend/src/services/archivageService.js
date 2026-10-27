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
  // Bordereaux de versement (décret n° 2007-532, art. 42-47 — migration 036).
  versements: async () => (await api.get('/archives/versements')).data,
  versement: async (id) => (await api.get(`/archives/versements/${id}`)).data,
  creerVersement: async (corps) => (await api.post('/archives/versements', corps)).data,
  ajouterVersement: async (id, ids) => (await api.post(`/archives/versements/${id}/documents`, { document_ids: ids })).data,
  retirerVersement: async (id, documentId) => (await api.delete(`/archives/versements/${id}/documents/${documentId}`)).data,
  actionVersement: async (id, action, corps = {}) => (await api.post(`/archives/versements/${id}/${action}`, corps)).data,
  // Horodatage RFC 3161, formats, sauvegarde (migration 037).
  horodatages: async (params = {}) => (await api.get('/archives/horodatages', { params })).data,
  horodaterMaintenant: async () => (await api.post('/archives/horodatages')).data,
  jetonHorodatage: async (h) => {
    const r = await api.get(`/archives/horodatages/${h.id}/jeton`, { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url; a.download = `horodatage-${h.objet_type}-${h.objet_id}.tsr`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  formats: async () => (await api.get('/archives/formats')).data,
  copiePdfa: async (documentId, fileId) => (await api.post(`/documents/${documentId}/fichiers/${fileId}/pdfa`)).data,
  sauvegarde: async () => (await api.get('/archives/sauvegarde')).data,
  reglerSauvegarde: async (corps) => (await api.put('/archives/sauvegarde', corps)).data,
  sauvegarder: async () => (await api.post('/archives/sauvegarde', {}, { timeout: 30 * 60 * 1000 })).data,
  paquetVersement: async (id) => {
    const r = await api.get(`/archives/versements/${id}/paquet`, { responseType: 'blob' });
    const nom = /filename="([^"]+)"/.exec(r.headers['content-disposition'] || '')?.[1] || 'versement.zip';
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export const SORTS = { conservation: 'Conservation définitive', elimination: 'Élimination', tri: 'Tri' };
export const POINTS = { date_document: 'Date du document', creation: 'Entrée dans la GED', archivage: 'Archivage' };
export const STATUTS_BORDEREAU = {
  brouillon: ['Brouillon', 'bg-slate-100 text-slate-600'], propose: ['Proposé', 'bg-blue-50 text-blue-700'],
  valide: ['Validé', 'bg-emerald-50 text-emerald-700'], transmis: ["Transmis pour visa", 'bg-amber-50 text-amber-700'],
  vise: ['Visé', 'bg-emerald-100 text-emerald-800'], rejete: ['Rejeté', 'bg-red-50 text-red-700'],
  execute: ['Exécuté', 'bg-slate-800 text-white'], annule: ['Annulé', 'bg-slate-100 text-slate-400'],
};
export const dateFr = (v) => (v ? new Date(String(v).length === 10 ? `${v}T00:00:00` : v).toLocaleDateString('fr-FR') : '—');
export const taille = (o) => (!o ? '0 o' : o < 1048576 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1048576).toFixed(1)} Mo`);
export const STATUTS_VERSEMENT = {
  brouillon: ['Brouillon', 'bg-slate-100 text-slate-600'], transmis: ['Transmis', 'bg-amber-50 text-amber-700'],
  pris_en_charge: ['Pris en charge', 'bg-emerald-100 text-emerald-800'], annule: ['Annulé', 'bg-slate-100 text-slate-400'],
};
export const DESTINATIONS = { pre_archivage: 'Dépôt de pré-archivage', archives_publiques: 'Archives publiques' };
export const DECISIONS_VISA = { accorde: 'Visa accordé', partiel: 'Visa partiel', refuse: 'Visa refusé' };
export const MODES_DESTRUCTION = { sur_place: 'Destruction sur place', prestataire: 'Entreprise spécialisée' };
export const COMMUNICABILITE = {
  '': 'Règle générale : 30 ans après le document, une fois versé aux archives publiques (art. 32)',
  general: 'Règle générale : 30 ans après le document, une fois versé aux archives publiques (art. 32)',
  libre: 'Communicable immédiatement',
  etat_civil: "100 ans après l'acte (état civil, minutes notariales, enregistrement)",
  medical: '100 ans après la naissance (renseignements médicaux)',
  personnel: '90 ans après la naissance (dossiers de personnel)',
  judiciaire: 'Instruction judiciaire : 60 ans après la clôture',
  statistique: 'Statistiques individuelles : 60 ans',
  surete: "Sûreté de l'État, militaire, diplomatique : 50 ans",
};
export const RISQUES_FORMAT = {
  perenne: ['Pérenne', 'bg-emerald-50 text-emerald-700'],
  surveiller: ['À surveiller', 'bg-amber-50 text-amber-700'],
  risque: ['À risque', 'bg-red-50 text-red-700'],
};
export const OBJETS_HORODATES = { sceau: 'Sceau du journal', pv_elimination: "Procès-verbal d'élimination", versement: 'Bordereau de versement' };
