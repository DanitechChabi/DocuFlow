const express = require('express');
const router = express.Router();
const superadminController = require('../controllers/superadminController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Toutes les routes nécessitent auth + superadmin
router.use(authMiddleware);
router.use(roleMiddleware(['superadmin']));

// Statistiques globales (avec stats par entreprise)
router.get('/stats', superadminController.getStats);

// Gestion des demandes (tous tenants) — voir, archiver, désarchiver, supprimer
router.get('/requests', superadminController.getAllRequests);
router.patch('/requests/:id/archive', superadminController.archiveRequest);
router.patch('/requests/:id/unarchive', superadminController.unarchiveRequest);
router.delete('/requests/:id', superadminController.deleteRequest);

// Gestion globale des utilisateurs (tous tenants)
router.get('/users', superadminController.getAllUsers);
router.get('/users/superadmins', superadminController.getSuperAdmins);
router.post('/users', superadminController.createUser);
router.patch('/users/:id', superadminController.updateUser);
router.delete('/users/:id', superadminController.deleteUser);

// Réinitialisation du mot de passe
router.post('/users/:id/reset-password', superadminController.resetPassword);

module.exports = router;
