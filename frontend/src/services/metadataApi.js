import api from './api';

export const metadataApi = {
  // --- Gestion des schémas et champs ---
  getSchemas: async () => {
    const response = await api.get('/metadata/schemas');
    return response.data;
  },
  createSchema: async (schemaData) => {
    const response = await api.post('/metadata/schemas', schemaData);
    return response.data;
  },
  getSchemaById: async (id) => {
    const response = await api.get(`/metadata/schemas/${id}`);
    return response.data;
  },
  updateSchema: async (id, schemaData) => {
    const response = await api.put(`/metadata/schemas/${id}`, schemaData);
    return response.data;
  },
  deleteSchema: async (id) => {
    const response = await api.delete(`/metadata/schemas/${id}`);
    return response.data;
  },
  createField: async (schemaId, fieldData) => {
    const response = await api.post(`/metadata/schemas/${schemaId}/fields`, fieldData);
    return response.data;
  },
  updateField: async (id, fieldData) => {
    const response = await api.put(`/metadata/fields/${id}`, fieldData);
    return response.data;
  },
  deleteField: async (id) => {
    const response = await api.delete(`/metadata/fields/${id}`);
    return response.data;
  },

  // --- Gestion des valeurs ---
  getDocumentMetadata: async (documentId) => {
    const response = await api.get(`/metadata/documents/${documentId}`);
    return response.data;
  },
  setDocumentMetadata: async (documentId, metadata) => {
    const response = await api.put(`/metadata/documents/${documentId}`, metadata);
    return response.data;
  },
  updateMetadataValue: async (documentId, fieldId, value) => {
    const response = await api.put(`/metadata/documents/${documentId}/values/${fieldId}`, { value });
    return response.data;
  },
  deleteMetadataValue: async (documentId, fieldId) => {
    const response = await api.delete(`/metadata/documents/${documentId}/values/${fieldId}`);
    return response.data;
  },
};
