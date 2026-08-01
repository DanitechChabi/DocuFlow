const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
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

// Documents
router.post('/', roleMiddleware(ADMIN_ROLES), uploadMultiple, documentController.createDocument);
router.get('/', documentController.listDocuments);
router.get('/:id', documentController.getDocument);
router.patch('/:id', roleMiddleware(ADMIN_ROLES), documentController.updateDocument);
router.delete('/:id', roleMiddleware(ADMIN_ROLES), documentController.deleteDocument);
router.post('/:id/files', roleMiddleware(ADMIN_ROLES), uploadMultiple, documentController.addFiles);
router.delete('/:id/files/:fileId', roleMiddleware(ADMIN_ROLES), documentController.deleteFile);
router.post('/:id/status', roleMiddleware(ADMIN_ROLES), documentController.setStatus);

module.exports = router;
