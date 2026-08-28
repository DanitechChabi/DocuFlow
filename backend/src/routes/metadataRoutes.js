const express = require('express');
const router = express.Router();
const metadataController = require('../controllers/metadataController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const gedAccessMiddleware = require('../middlewares/gedAccessMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

// Middleware de base pour toutes les routes
router.use(authMiddleware);

// --- Gestion des schémas et champs : configuration documentaire (documents.edit
// — administrateur et archiviste la portent ; le réglage ged_access_role devient
// redondant, le panneau de rôles administre les accès).
const adminOrArchivist = requirePermission('documents.edit');

router.get('/schemas', adminOrArchivist, metadataController.getSchemas);
router.post('/schemas', adminOrArchivist, metadataController.createSchema);
router.get('/schemas/:id', adminOrArchivist, metadataController.getSchemaById);
router.put('/schemas/:id', adminOrArchivist, metadataController.updateSchema);
router.put('/schemas/:id/sync', adminOrArchivist, metadataController.syncSchema);
router.delete('/schemas/:id', adminOrArchivist, metadataController.deleteSchema);

router.post('/schemas/:schemaId/fields', adminOrArchivist, metadataController.createField);
router.put('/fields/:id', adminOrArchivist, metadataController.updateField);
router.delete('/fields/:id', adminOrArchivist, metadataController.deleteField);

// --- Gestion des valeurs (GED) ---
// Périmètre piloté par le réglage « Rôle d'accès à la GED » (ged_access_role) :
// archiviste seul par défaut, élargissable aux admins ou à tous les utilisateurs
// sans redéploiement. `admin` reste toujours autorisé sur les métadonnées, dont
// il administre le schéma.
const gedAccess = requirePermission('documents.view');

router.get('/documents/:documentId', gedAccess, metadataController.getDocumentMetadata);
router.put('/documents/:documentId', requirePermission('documents.edit'), metadataController.setDocumentMetadata);
router.put('/documents/:documentId/values/:fieldId', requirePermission('documents.edit'), metadataController.updateMetadataValue);
router.delete('/documents/:documentId/values/:fieldId', requirePermission('documents.edit'), metadataController.deleteMetadataValue);

module.exports = router;
