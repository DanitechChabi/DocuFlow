const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Authentification requise pour toutes les routes
router.use(authMiddleware);

// Routes profil — accessibles à tout utilisateur connecté
router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.put('/profile/password', userController.changePassword);

// Archivistes (attribution des demandes) — accessibles au personnel
router.get('/archivists', userController.getArchivists);

// Routes admin — réservées au SuperAdmin
router.use(roleMiddleware(['superadmin']));

router.get('/', userController.getAllUsers);
router.post('/', userController.createUser);
router.patch('/:id/role', userController.updateUserRole);
router.delete('/:id', userController.deleteUser);

module.exports = router;
