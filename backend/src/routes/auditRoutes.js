const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

// Authentification requise
router.use(authMiddleware);

// Journaux d'audit : permission audit.view (administrateur, super administrateur
// et responsable — la supervision des demandes inclut la traçabilité).
router.use(requirePermission('audit.view'));

router.get('/', auditController.getAuditLogs);

module.exports = router;
