const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const authMiddleware = require('../middlewares/authMiddleware');

router.use(authMiddleware);

// Envoyer un message
router.post('/', messageController.sendMessage);

// Liste des conversations (utilisateurs avec qui j'ai échangé)
router.get('/conversations', messageController.getConversations);

// Messages d'une conversation spécifique
router.get('/conversations/:userId', messageController.getConversation);

// Marquer une conversation comme lue
router.patch('/conversations/:userId/read', messageController.markConversationAsRead);

// Nombre de messages non lus
router.get('/unread-count', messageController.getUnreadCount);

// Liste des utilisateurs (pour nouveau message)
router.get('/users', messageController.getUsers);

module.exports = router;
