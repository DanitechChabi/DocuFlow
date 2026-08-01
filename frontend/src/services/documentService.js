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
    const response = await api.post(`/documents/${id}/files`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
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
};
