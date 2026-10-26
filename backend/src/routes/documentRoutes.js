const express = require('express');
const router = express.Router();
const indexSuggestionController = require('../controllers/indexSuggestionController');
const conformiteController = require('../controllers/conformiteController');
const archivesController = require('../controllers/archivesController');
const documentController = require('../controllers/documentController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');
const uploadPolicyMiddleware = require('../middlewares/uploadPolicyMiddleware');
const { uploadMultiple } = require('../helpers/upload');

// Téléchargement/aperçu de fichier — AVANT authMiddleware, volontairement :
// un <img src> ou <a href> ne porte pas d'en-tête Authorization, donc cette
// route ne peut pas dépendre d'une session active. L'autorisation tient au
// ticket signé (voir storageService.secureFileUrl / helpers/fileTicket.js),
// que le contrôleur revérifie lui-même (permission + ACL de dossier) avant
// de livrer le fichier.
router.get('/:id/files/:fileId/download', documentController.downloadDocumentFile);

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

// Périmètres d'accès par dossier (ACL) — la double garde est voulue : la
// permission RBAC dit QUI administre les périmètres, le contrôle peutGerer
// dit sur QUEL dossier (manage direct ou hérité). Les rôles admin/superadmin
// passent toujours (voir aclService).
router.get('/folders/:id/acls', requirePermission('folders.manage_permissions'), documentController.listFolderAcls);
router.post('/folders/:id/acls', requirePermission('folders.manage_permissions'), documentController.setFolderAcl);
router.delete('/folders/:id/acls/:subjectType/:subjectId', requirePermission('folders.manage_permissions'), documentController.deleteFolderAcl);

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

// Demandes liées — la réciproque du lien demandes ↔ documents (migration 021)
router.get('/:id/requests', lireDocuments, documentController.getDocumentRequests);

// Métadonnées et journal d'audit
router.get('/:id/metadata', lireDocuments, documentController.getDocumentMetadata);
// Indexation assistée : propositions de métadonnées tirées du texte du
// document (lecture seule ; réservé à qui peut corriger la fiche).
router.get('/:id/suggestions', requirePermission('documents.edit'), indexSuggestionController.propositions);
// L'écriture des métadonnées est l'INDEXATION (statut « à indexer ») comme la
// correction de fiche : permission documents.edit.
router.post('/:id/metadata', requirePermission('documents.edit'), documentController.setDocumentMetadata);
router.get('/:id/audit', requirePermission('documents.view_history'), documentController.getDocumentAudit);
// Analyse du document (migration 030) : ce que la lecture a trouvé (émetteur,
// montants, dates, identifiants) et les alertes de conformité qui le concernent.
router.get('/:id/analysis', requirePermission('compliance.view'), conformiteController.analyseDocument);
router.post('/:id/analysis', requirePermission('compliance.manage'), conformiteController.relancerAnalyse);
// Intégrité et preuve (migration 031) : empreintes et contrôle des fichiers,
// certificat d'archivage — pour qui peut lire le document ; le gel juridique
// est un pouvoir à part (archives.hold).
router.get('/:id/integrite', lireDocuments, archivesController.etatDocument);
router.post('/:id/integrite/verifier', lireDocuments, archivesController.verifierDocument);
// Émettre un certificat est un acte journalisé (CERTIFICAT_EMIS) : POST.
router.post('/:id/certificat', lireDocuments, archivesController.certificat);
router.post('/:id/gel', requirePermission('archives.hold'), archivesController.poserGel);
router.post('/:id/gel/levee', requirePermission('archives.hold'), archivesController.leverGel);

// Verrouillage pour édition (check-out / check-in) — une action sur les
// versions du fond documentaire, réservée à qui peut les gérer.
router.post('/:id/checkout', requirePermission('documents.manage_versions'), documentController.checkoutDocument);
router.post('/:id/checkin', requirePermission('documents.manage_versions'), documentController.checkinDocument);

// Partage de document par email — le message part DU domaine vérifié de
// l'organisation : c'est un pouvoir d'expédition, pas une consultation.
router.post('/:id/share', requirePermission('documents.share'), documentController.shareDocument);

module.exports = router;
