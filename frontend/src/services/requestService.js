import api from './api';

export const requestService = {
  createRequest: async (requestData) => {
    const response = await api.post('/requests', requestData);
    return response.data;
  },
  getMyRequests: async () => {
    const response = await api.get('/requests/my-requests');
    return response.data;
  },
  getAllRequests: async () => {
    const response = await api.get('/requests/all');
    return response.data;
  },
  // --- Recherche automatique dans la GED (migration 027) ---
  /** Pendant la saisie : { probable } — rien d'autre n'est révélé. */
  gedPrecheck: async (champs) => {
    const response = await api.get('/requests/ged-precheck', { params: champs });
    return response.data;
  },
  /** Documents qui correspondent à une demande (archive, ACL appliquées). */
  getGedMatches: async (requestId) => {
    const response = await api.get(`/requests/${requestId}/ged-matches`);
    return response.data;
  },
  /** Joint la version courante d'un document à la demande et la livre. */
  transmettreDepuisGed: async (requestId, documentId) => {
    const response = await api.post(`/requests/${requestId}/deliver-from-ged`, { document_id: documentId });
    return response.data;
  },
  // --- Prêt des dossiers physiques (migration 025) ---
  /** Remise du dossier papier à l'auteur de la demande. */
  remettreDossier: async (requestId, { date_retour_prevue, observation, nature, document_id }) => {
    const response = await api.post(`/requests/${requestId}/loan`, { date_retour_prevue, observation, nature, document_id });
    return response.data;
  },
  /** Retour du dossier aux archives (et rangement). */
  retournerDossier: async (requestId, { observation }) => {
    const response = await api.patch(`/requests/${requestId}/loan/return`, { observation });
    return response.data;
  },
  /** L'agent conteste la remise (« je ne l'ai pas reçu »). */
  signalerPret: async (requestId, message) => {
    const response = await api.post(`/requests/${requestId}/loan/report`, { message });
    return response.data;
  },
  /** L'agent confirme la réception (organisations qui l'exigent). */
  confirmerPret: async (requestId) => {
    const response = await api.post(`/requests/${requestId}/loan/confirm`);
    return response.data;
  },
  /** Registre des prêts — `etat` : en_cours | en_retard | signale | retourne. */
  getRegistrePrets: async (etat) => {
    const response = await api.get('/requests/loans', { params: etat ? { etat } : {} });
    return response.data;
  },
  getMyTasks: async () => {
    const response = await api.get('/requests/my-tasks');
    return response.data;
  },
  assignRequest: async (requestId, assigneeId) => {
    const response = await api.patch(`/requests/${requestId}/assign`, { assignee_id: assigneeId });
    return response.data;
  },
  getArchivists: async () => {
    const response = await api.get('/users/archivists');
    return response.data;
  },
  /**
   * Cherche dans le référentiel documentaire un document déjà indexé portant les
   * mêmes numéros de dossier et d'acte que la demande. Permet à l'archiviste de
   * satisfaire une demande sans nouvelle numérisation.
   */
  findMatchingDocument: async (requestId) => {
    const response = await api.get(`/requests/${requestId}/matching-document`);
    return response.data;
  },
  /**
   * Listes de choix du formulaire (types de document, motifs, priorités), telles
   * que le serveur les accepte. Le formulaire les lit d'ordinaire depuis les
   * réglages déjà chargés ; cette route fait autorité en cas de doute.
   */
  getOptions: async () => {
    const response = await api.get('/requests/options');
    return response.data;
  },
  /**
   * Champs à afficher dans le formulaire, tels que l'organisation les a définis
   * (migration 016). Lisible par tous les rôles : un demandeur ne peut pas
   * remplir un formulaire dont il ignore les champs.
   *
   * Renvoie `{ available: false, fields: [] }` si la migration n'est pas passée
   * sur la base — le formulaire retombe alors sur ses champs d'origine.
   */
  getFormFields: async () => {
    const response = await api.get('/requests/fields/form');
    return response.data;
  },
  /** Toutes les définitions, masquées comprises — vue de l'administrateur. */
  getFieldDefinitions: async () => {
    const response = await api.get('/requests/fields');
    return response.data;
  },
  /**
   * Enregistre l'intégralité des champs dans l'ordre du tableau. Synchronisation
   * globale et non champ par champ : `display_order` n'a de sens que rapporté à
   * l'ensemble.
   */
  syncFieldDefinitions: async (fields) => {
    const response = await api.put('/requests/fields', { fields });
    return response.data;
  },
  /** Réaffiche ou masque un champ (seule issue pour un champ système masqué). */
  setFieldVisibility: async (fieldId, isVisible) => {
    const response = await api.patch(`/requests/fields/${fieldId}/visibility`, { is_visible: isVisible });
    return response.data;
  },
  /** Réinstalle les champs d'origine sur une organisation qui n'en a aucun. */
  provisionFields: async () => {
    const response = await api.post('/requests/fields/provision');
    return response.data;
  },
  updateStatus: async (requestId, statusData) => {
    const response = await api.patch(`/requests/${requestId}/status`, statusData);
    return response.data;
  },
  getStats: async () => {
    const response = await api.get('/requests/stats');
    return response.data;
  },
  getAuditLogs: async () => {
    const response = await api.get('/requests/history');
    return response.data;
  }
};
