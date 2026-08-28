const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');
const uploadPolicyMiddleware = require('../middlewares/uploadPolicyMiddleware');
const { uploadMultiple } = require('../helpers/upload');

// Toutes les routes documents exigent une authentification
router.use(authMiddleware);

// LECTURE DE LA GED — la permission documents.view fait foi : le réglage
// « Rôle d'accès à la GED » d'avant le RBAC est désormais administré dans le
// panneau « Rôles & permissions » (accorder documents.view au rôle demandeur
// équivaut à l'ancienne option « tous les utilisateurs »). La sécurité reste
// ici, côté serveur.
const lireDocuments = requirePermission('documents.view');

// Dossiers (lecture : arborescence ; écriture : gestion des dossiers)
router.get('/folders', requirePermission('folders.view'), documentController.listFolders);
router.post('/folders', requirePermission('folders.create'), documentController.createFolder);
router.patch('/folders/:id', requirePermission('folders.edit'), documentController.renameFolder);
router.delete('/folders/:id', requirePermission('folders.delete'), documentController.deleteFolder);

// Indexation depuis une demande — le geste documentaire par excellence.
router.post('/from-request/:requestId', requirePermission('documents.index'), documentController.indexFromRequest);

// Vues Dynamiques (Dynamic Views par métadonnées) — elles AFFICHENT des
// documents : même permission de lecture ; leur création est une configuration
// documentaire.
router.get('/dynamic-views/list', lireDocuments, documentController.getDynamicViews);
router.post('/dynamic-views', requirePermission('documents.edit'), documentController.createDynamicView);
router.get('/dynamic-views/data', lireDocuments, documentController.getDynamicViewData);

// Documents
// uploadPolicyMiddleware s'exécute après multer : il applique la taille maximale
// et les extensions autorisées configurées par l'organisation.
router.post('/', requirePermission('documents.upload'), uploadMultiple, uploadPolicyMiddleware, documentController.createDocument);
router.get('/', lireDocuments, documentController.listDocuments);
router.get('/corbeille', requirePermission('documents.view'), documentController.listCorbeille);
router.get('/:id', lireDocuments, documentController.getDocument);
router.patch('/:id', requirePermission('documents.edit'), documentController.updateDocument);
// Suppression douce (corbeille) / restauration / destruction physique.
router.delete('/:id', requirePermission('documents.delete'), documentController.deleteDocument);
router.post('/:id/restore', requirePermission('documents.restore'), documentController.restoreDocument);
router.delete('/:id/purge', requirePermission('documents.purge'), documentController.purgeDocument);
router.post('/:id/files', requirePermission('documents.manage_versions'), uploadMultiple, uploadPolicyMiddleware, documentController.addFiles);
router.delete('/:id/files/:fileId', requirePermission('documents.manage_versions'), documentController.deleteFile);
router.post('/:id/status', requirePermission('documents.edit'), documentController.setStatus);

// Assemblage automatique de dossier — génère un document.
router.get('/assembly/templates', lireDocuments, documentController.getAssemblyTemplates);
router.post('/assembly/generate', requirePermission('documents.edit'), documentController.generateAssembledDocument);

// Relations et dépendances entre documents
router.get('/:id/relations', lireDocuments, documentController.getDocumentRelations);
router.post('/:id/relations', requirePermission('documents.edit'), documentController.createDocumentRelation);

// Métadonnées et journal d'audit
router.get('/:id/metadata', lireDocuments, documentController.getDocumentMetadata);
// L'écriture des métadonnées est l'INDEXATION (statut « à indexer ») comme la
// correction de fiche : permission documents.edit.
router.post('/:id/metadata', requirePermission('documents.edit'), documentController.setDocumentMetadata);
router.get('/:id/audit', requirePermission('documents.view_history'), documentController.getDocumentAudit);

// Verrouillage pour édition (check-out / check-in) — une action sur les
// versions du fond documentaire, réservée à qui peut les gérer.
router.post('/:id/checkout', requirePermission('documents.manage_versions'), documentController.checkoutDocument);
router.post('/:id/checkin', requirePermission('documents.manage_versions'), documentController.checkinDocument);

// Partage de document par email — le message part DU domaine vérifié de
// l'organisation : c'est un pouvoir d'expédition, pas une consultation.
router.post('/:id/share', requirePermission('documents.share'), documentController.shareDocument);

module.exports = router;
