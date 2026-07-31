import api from './api';

export const messageService = {
  sendMessage: async (receiver_id, content, files = []) => {
    const response = await api.post('/messages', { receiver_id, content, files });
    return response.data;
  },

  getConversations: async () => {
    const response = await api.get('/messages/conversations');
    return response.data;
  },

  getConversation: async (userId) => {
    const response = await api.get(`/messages/conversations/${userId}`);
    return response.data;
  },

  markConversationAsRead: async (userId) => {
    const response = await api.patch(`/messages/conversations/${userId}/read`);
    return response.data;
  },

  getUnreadCount: async () => {
    const response = await api.get('/messages/unread-count');
    return response.data;
  },

  getUsers: async () => {
    const response = await api.get('/messages/users');
    return response.data;
  }
};
