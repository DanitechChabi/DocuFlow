import api from './api';

export const uploadService = {
  // Upload fichiers pour une demande
  uploadRequestFiles: async (requestId, files) => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    const response = await api.post(`/upload/request/${requestId}`, formData);
    return response.data;
  },

  // Récupérer les fichiers d'une demande
  getRequestFiles: async (requestId) => {
    const response = await api.get(`/upload/request/${requestId}`);
    return response.data;
  },

  // Supprimer un fichier d'une demande
  deleteRequestFile: async (fileId) => {
    const response = await api.delete(`/upload/request/file/${fileId}`);
    return response.data;
  },

  // Upload d'un fichier pour la messagerie (avant envoi du message)
  uploadMessageFile: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/upload/message', formData);
    return response.data;
  },

  // Lier des fichiers à un message après envoi
  linkMessageFiles: async (messageId, storedNames) => {
    const response = await api.post(`/upload/message/${messageId}/link`, { stored_names: storedNames });
    return response.data;
  },

  // Récupérer les fichiers d'un message
  getMessageFiles: async (messageId) => {
    const response = await api.get(`/upload/message/${messageId}`);
    return response.data;
  }
};
