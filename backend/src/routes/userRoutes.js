const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

// Authentification requise pour toutes les routes
router.use(authMiddleware);

// Routes profil — accessibles à tout utilisateur connecté
router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.put('/profile/password', userController.changePassword);

// Archivistes (attribution des demandes) — le personnel habilité à traiter
router.get('/archivists', requirePermission('requests.process'), userController.getArchivists);

// Gestion des comptes — les permissions users.* remplacent l'ancien verrou
// « superadmin seul » : l'administrateur d'entreprise accède enfin à la gestion
// des utilisateurs de SON organisation (le propriétaire de plateforme garde ses
// routes /api/superadmin pour tout voir).
router.use(requirePermission('users.view'));

router.get('/', userController.getAllUsers);
router.post('/', requirePermission('users.create'), userController.createUser);
router.patch('/:id/role', requirePermission('users.edit'), userController.updateUserRole);
router.delete('/:id', requirePermission('users.disable'), userController.deleteUser);

module.exports = router;
