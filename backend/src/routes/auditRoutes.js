const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Authentification requise
router.use(authMiddleware);

// Seuls les admins et superadmins peuvent voir les logs d'audit
router.use(roleMiddleware(['admin', 'superadmin']));

router.get('/', auditController.getAuditLogs);

module.exports = router;
