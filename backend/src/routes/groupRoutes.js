const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Authentification requise pour toutes les routes
router.use(authMiddleware);

// Routes accessibles à tout utilisateur connecté
router.get('/', groupController.getGroups);
router.get('/:id', groupController.getGroupById);
router.get('/:id/members', groupController.getUsersInGroup);
router.get('/users/:userId/groups', groupController.getUserGroups);

// Routes admin — réservées aux administrateurs et superadmins
router.use(roleMiddleware(['admin', 'superadmin']));

router.post('/', groupController.createGroup);
router.put('/:id', groupController.updateGroup);
router.delete('/:id', groupController.deleteGroup);
router.post('/:id/members', groupController.addUserToGroup);
router.delete('/:id/members/:userId', groupController.removeUserFromGroup);

module.exports = router;
