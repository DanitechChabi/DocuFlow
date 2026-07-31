const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Toutes les routes nécessitent auth + superadmin
router.use(authMiddleware);
router.use(roleMiddleware(['superadmin']));

router.get('/', tenantController.getAllTenants);
router.get('/:id', tenantController.getTenant);
router.post('/', tenantController.createTenant);
router.patch('/:id/status', tenantController.updateTenantStatus);
router.delete('/:id', tenantController.deleteTenant);

module.exports = router;
