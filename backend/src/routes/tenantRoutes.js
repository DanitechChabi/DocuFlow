const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const platformOwnerMiddleware = require('../middlewares/platformOwnerMiddleware');

// Auth + superadmin + propriétaire de la plateforme (tenant 1).
//
// platformOwnerMiddleware manquait : le seul roleMiddleware(['superadmin'])
// ouvrait ces routes au superadmin de N'IMPORTE QUELLE entreprise, qui pouvait
// donc lister, suspendre et supprimer les entreprises CONCURRENTES — chaque
// inscription via /register-company créant un superadmin. Le registre des
// entreprises est une donnée de la plateforme, pas de ses clients.
//
// L'inscription publique passe par authRoutes (/register-company) et n'est pas
// concernée par cette restriction.
router.use(authMiddleware);
router.use(roleMiddleware(['superadmin']));
router.use(platformOwnerMiddleware);

router.get('/', tenantController.getAllTenants);
router.get('/:id', tenantController.getTenant);
router.post('/', tenantController.createTenant);
router.patch('/:id/status', tenantController.updateTenantStatus);
// Suppression : voir DELETE /api/superadmin/tenants/:id, qui exige une
// confirmation par le nom, protège le tenant 1 et journalise l'opération.
router.delete('/:id', tenantController.deleteTenant);

module.exports = router;
