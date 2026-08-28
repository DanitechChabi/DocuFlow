const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

// Authentification requise pour toutes les routes
router.use(authMiddleware);

// Lecture des groupes : permission groups.view (le gestionnaire de groupes du
// portail d'administration ; plus jamais « tout utilisateur connecté »).
router.get('/', requirePermission('groups.view'), groupController.getGroups);
router.get('/:id', requirePermission('groups.view'), groupController.getGroupById);
router.get('/:id/members', requirePermission('groups.view'), groupController.getUsersInGroup);
router.get('/users/:userId/groups', requirePermission('groups.view'), groupController.getUserGroups);

// Gestion des groupes : permission groups.manage.
router.use(requirePermission('groups.manage'));

router.post('/', groupController.createGroup);
router.put('/:id', groupController.updateGroup);
router.delete('/:id', groupController.deleteGroup);
router.post('/:id/members', groupController.addUserToGroup);
router.delete('/:id/members/:userId', groupController.removeUserFromGroup);

module.exports = router;
