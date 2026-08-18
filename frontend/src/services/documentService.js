import api from './api';

export const documentService = {
  // Documents
  createDocument: async (formData) => {
    const response = await api.post('/documents', formData);
    return response.data;
  },
  getDocuments: async (params = {}) => {
    const response = await api.get('/documents', { params });
    return response.data;
  },
  getDocument: async (id) => {
    const response = await api.get(`/documents/${id}`);
    return response.data;
  },
  updateDocument: async (id, data) => {
    const response = await api.patch(`/documents/${id}`, data);
    return response.data;
  },
  deleteDocument: async (id) => {
    const response = await api.delete(`/documents/${id}`);
    return response.data;
  },
  addFiles: async (id, files) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    const response = await api.post(`/documents/${id}/files`, formData);
    return response.data;
  },
  deleteFile: async (id, fileId) => {
    const response = await api.delete(`/documents/${id}/files/${fileId}`);
    return response.data;
  },
  setStatus: async (id, statut, comment) => {
    const response = await api.post(`/documents/${id}/status`, { statut, comment });
    return response.data;
  },
  indexFromRequest: async (requestId) => {
    const response = await api.post(`/documents/from-request/${requestId}`);
    return response.data;
  },

  // Dossiers
  getFolders: async () => {
    const response = await api.get('/documents/folders');
    return response.data;
  },
  createFolder: async (name, parentId) => {
    const response = await api.post('/documents/folders', { name, parent_id: parentId });
    return response.data;
  },
  renameFolder: async (id, name) => {
    const response = await api.patch(`/documents/folders/${id}`, { name });
    return response.data;
  },
  deleteFolder: async (id) => {
    const response = await api.delete(`/documents/folders/${id}`);
    return response.data;
  },

  // Lien demande ↔ document
  linkDocumentToRequest: async (requestId, documentId) => {
    const response = await api.patch(`/requests/${requestId}/document`, { document_id: documentId });
    return response.data;
  },
  unlinkDocumentFromRequest: async (requestId) => {
    const response = await api.patch(`/requests/${requestId}/document`, { document_id: null });
    return response.data;
  },

  // Partage par email
  shareDocument: async (id, emails, message) => {
    const response = await api.post(`/documents/${id}/share`, { emails, message });
    return response.data;
  },

  // M-Files Verrouillage (Check-in / Check-out)
  checkoutDocument: async (id) => {
    const response = await api.post(`/documents/${id}/checkout`);
    return response.data;
  },
  checkinDocument: async (id) => {
    const response = await api.post(`/documents/${id}/checkin`);
    return response.data;
  },

  // M-Files Vues Dynamiques
  getDynamicViews: async () => {
    const response = await api.get('/documents/dynamic-views/list');
    return response.data;
  },
  createDynamicView: async (data) => {
    const response = await api.post('/documents/dynamic-views', data);
    return response.data;
  },
  /**
   * Regroupement dynamique des documents par métadonnée (paradigme M-Files).
   * Le nom du paramètre doit rester `groupBy` : c'est celui que lit
   * documentController.getDynamicViewData, qui n'accepte qu'une liste blanche de
   * champs (type_document, annee, statut, nom_entreprise, auteur).
   *
   * Passer `viewId` rejoue une vue enregistrée : le backend en tire à la fois le
   * champ de regroupement et les filtres (`filter_json`). Dans ce cas `groupBy`
   * est ignoré, et `group_by_field` de la réponse indique le champ réellement
   * appliqué — c'est lui qui détermine sur quelle métadonnée un glisser-déposer
   * doit écrire.
   *
   * @param {string} groupBy champ de regroupement
   * @param {number|null} viewId identifiant d'une vue enregistrée
   * @returns {Promise<{group_by_field: string, groups: Array<{group_name: string, count: number, documents: Array}>}>}
   */
  getDynamicViewData: async (groupBy = 'type_document', viewId = null) => {
    const params = viewId ? { view_id: viewId } : { groupBy };
    const response = await api.get('/documents/dynamic-views/data', { params });
    // Compatibilité : l'API a d'abord renvoyé un tableau nu de groupes. Un
    // backend non redéployé continuerait de le faire ; on normalise ici plutôt
    // que dans chaque composant appelant.
    const data = response.data;
    if (Array.isArray(data)) return { group_by_field: groupBy, groups: data };
    return { group_by_field: data?.group_by_field || groupBy, groups: data?.groups || [] };
  },
  // M-Files Assemblage Automatique (Document Assembly)
  getAssemblyTemplates: async () => {
    const response = await api.get('/documents/assembly/templates');
    return response.data;
  },
  generateAssembledDocument: async (data) => {
    const response = await api.post('/documents/assembly/generate', data);
    return response.data;
  },

  // M-Files Relations
  getRelations: async (id) => {
    const response = await api.get(`/documents/${id}/relations`);
    return response.data;
  },
  createRelation: async (id, targetDocId, relationType) => {
    const response = await api.post(`/documents/${id}/relations`, { target_document_id: targetDocId, relation_type: relationType });
    return response.data;
  },
  getMetadataSchema: async () => {
    const response = await api.get('/metadata/schemas');
    // Return the default schema
    const defaultSchema = response.data.find(s => s.is_default) || response.data[0];
    return defaultSchema;
  },
  updateMetadataSchema: async (schemaId, fields) => {
    const response = await api.put(`/metadata/schemas/${schemaId}/sync`, { fields });
    return response.data;
  },
};
