const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Toutes les routes de demandes nécessitent une authentification
router.use(authMiddleware);

const ADMIN_ROLES = ['superadmin', 'admin', 'archiviste'];

// Créer une demande (Tous)
router.post('/', requestController.createRequest);

// Voir mes demandes (Tous)
router.get('/my-requests', requestController.getUserRequests);

// Routes réservées aux Archivistes et Admins
router.get('/my-tasks', roleMiddleware(ADMIN_ROLES), requestController.getMyTasks);
router.get('/stats', roleMiddleware(ADMIN_ROLES), requestController.getStats);
router.get('/history', roleMiddleware(ADMIN_ROLES), requestController.getAuditLogs);
router.get('/all', roleMiddleware(ADMIN_ROLES), requestController.getAllRequests);
router.get('/:id/verify-mfile', roleMiddleware(ADMIN_ROLES), requestController.verifyMfile);
router.patch('/:id/status', roleMiddleware(ADMIN_ROLES), requestController.updateRequestStatus);
router.patch('/:id/assign', roleMiddleware(ADMIN_ROLES), requestController.assignRequest);

module.exports = router;
