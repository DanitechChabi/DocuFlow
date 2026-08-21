const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const uploadPolicyMiddleware = require('../middlewares/uploadPolicyMiddleware');
const { uploadMultiple } = require('../helpers/upload');

const ADMIN_ROLES = ['superadmin', 'admin', 'archiviste'];

// Toutes les routes documents exigent une authentification
router.use(authMiddleware);

// Dossiers (lecture pour tous, écriture archiviste+)
router.get('/folders', documentController.listFolders);
router.post('/folders', roleMiddleware(ADMIN_ROLES), documentController.createFolder);
router.patch('/folders/:id', roleMiddleware(ADMIN_ROLES), documentController.renameFolder);
router.delete('/folders/:id', roleMiddleware(ADMIN_ROLES), documentController.deleteFolder);

// Indexation depuis une demande (archiviste+)
router.post('/from-request/:requestId', roleMiddleware(ADMIN_ROLES), documentController.indexFromRequest);

// Vues Dynamiques (Dynamic Views par métadonnées)
router.get('/dynamic-views/list', documentController.getDynamicViews);
router.post('/dynamic-views', roleMiddleware(ADMIN_ROLES), documentController.createDynamicView);
router.get('/dynamic-views/data', documentController.getDynamicViewData);

// Documents
// uploadPolicyMiddleware s'exécute après multer : il applique la taille maximale
// et les extensions autorisées configurées par l'organisation.
router.post('/', roleMiddleware(ADMIN_ROLES), uploadMultiple, uploadPolicyMiddleware, documentController.createDocument);
router.get('/', documentController.listDocuments);
router.get('/:id', documentController.getDocument);
router.patch('/:id', roleMiddleware(ADMIN_ROLES), documentController.updateDocument);
router.delete('/:id', roleMiddleware(ADMIN_ROLES), documentController.deleteDocument);
router.post('/:id/files', roleMiddleware(ADMIN_ROLES), uploadMultiple, uploadPolicyMiddleware, documentController.addFiles);
router.delete('/:id/files/:fileId', roleMiddleware(ADMIN_ROLES), documentController.deleteFile);
router.post('/:id/status', roleMiddleware(ADMIN_ROLES), documentController.setStatus);

// Assemblage automatique de dossier
router.get('/assembly/templates', documentController.getAssemblyTemplates);
router.post('/assembly/generate', roleMiddleware(ADMIN_ROLES), documentController.generateAssembledDocument);

// Relations et dépendances entre documents
router.get('/:id/relations', roleMiddleware(ADMIN_ROLES), documentController.getDocumentRelations);
router.post('/:id/relations', roleMiddleware(ADMIN_ROLES), documentController.createDocumentRelation);

// Métadonnées et journal d'audit
router.get('/:id/metadata', roleMiddleware(ADMIN_ROLES), documentController.getDocumentMetadata);
router.post('/:id/metadata', roleMiddleware(ADMIN_ROLES), documentController.setDocumentMetadata);
router.get('/:id/audit', roleMiddleware(ADMIN_ROLES), documentController.getDocumentAudit);

// Verrouillage pour édition (check-out / check-in)
router.post('/:id/checkout', documentController.checkoutDocument);
router.post('/:id/checkin', documentController.checkinDocument);

// Partage de document par email
router.post('/:id/share', documentController.shareDocument);

module.exports = router;
