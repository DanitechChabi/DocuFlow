const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const gedAccessMiddleware = require('../middlewares/gedAccessMiddleware');
const uploadPolicyMiddleware = require('../middlewares/uploadPolicyMiddleware');
const { uploadMultiple } = require('../helpers/upload');

const ADMIN_ROLES = ['superadmin', 'admin', 'archiviste'];

// Toutes les routes documents exigent une authentification
router.use(authMiddleware);

// LECTURE DE LA GED — gedAccessMiddleware, PAS authMiddleware seule.
//
// Réglage « Rôle d'accès à la GED » de la console de configuration : il promet
// de décider qui consulte la gestion documentaire, mais il n'était appliqué que
// sur les routes de métadonnées. Les lectures ci-dessous restaient ouvertes à
// TOUT utilisateur authentifié — donc à un demandeur, voire à tout compte créé
// par l'inscription publique : la bibliothèque documentaire entière (fichiers,
// secure_url, historique) était lisible, et les actions sensibles (verrouillage,
// partage par e-mail depuis le domaine de l'organisation) exécutables.
const lectureGed = gedAccessMiddleware();

// Dossiers (lecture selon le réglage GED, écriture archiviste+)
router.get('/folders', lectureGed, documentController.listFolders);
router.post('/folders', roleMiddleware(ADMIN_ROLES), documentController.createFolder);
router.patch('/folders/:id', roleMiddleware(ADMIN_ROLES), documentController.renameFolder);
router.delete('/folders/:id', roleMiddleware(ADMIN_ROLES), documentController.deleteFolder);

// Indexation depuis une demande (archiviste+)
router.post('/from-request/:requestId', roleMiddleware(ADMIN_ROLES), documentController.indexFromRequest);

// Vues Dynamiques (Dynamic Views par métadonnées) — elles AFFICHENT des
// documents : même garde de lecture que la liste.
router.get('/dynamic-views/list', lectureGed, documentController.getDynamicViews);
router.post('/dynamic-views', roleMiddleware(ADMIN_ROLES), documentController.createDynamicView);
router.get('/dynamic-views/data', lectureGed, documentController.getDynamicViewData);

// Documents
// uploadPolicyMiddleware s'exécute après multer : il applique la taille maximale
// et les extensions autorisées configurées par l'organisation.
router.post('/', roleMiddleware(ADMIN_ROLES), uploadMultiple, uploadPolicyMiddleware, documentController.createDocument);
router.get('/', lectureGed, documentController.listDocuments);
router.get('/:id', lectureGed, documentController.getDocument);
router.patch('/:id', roleMiddleware(ADMIN_ROLES), documentController.updateDocument);
router.delete('/:id', roleMiddleware(ADMIN_ROLES), documentController.deleteDocument);
router.post('/:id/files', roleMiddleware(ADMIN_ROLES), uploadMultiple, uploadPolicyMiddleware, documentController.addFiles);
router.delete('/:id/files/:fileId', roleMiddleware(ADMIN_ROLES), documentController.deleteFile);
router.post('/:id/status', roleMiddleware(ADMIN_ROLES), documentController.setStatus);

// Assemblage automatique de dossier
router.get('/assembly/templates', lectureGed, documentController.getAssemblyTemplates);
router.post('/assembly/generate', roleMiddleware(ADMIN_ROLES), documentController.generateAssembledDocument);

// Relations et dépendances entre documents
router.get('/:id/relations', roleMiddleware(ADMIN_ROLES), documentController.getDocumentRelations);
router.post('/:id/relations', roleMiddleware(ADMIN_ROLES), documentController.createDocumentRelation);

// Métadonnées et journal d'audit
router.get('/:id/metadata', roleMiddleware(ADMIN_ROLES), documentController.getDocumentMetadata);
router.post('/:id/metadata', roleMiddleware(ADMIN_ROLES), documentController.setDocumentMetadata);
router.get('/:id/audit', roleMiddleware(ADMIN_ROLES), documentController.getDocumentAudit);

// Verrouillage pour édition (check-out / check-in) — action de TRAVAIL sur le
// fond documentaire : réservée au personnel, comme toute écriture. Un
// demandeur pouvait auparavant verrouiller n'importe quel document.
router.post('/:id/checkout', roleMiddleware(ADMIN_ROLES), documentController.checkoutDocument);
router.post('/:id/checkin', roleMiddleware(ADMIN_ROLES), documentController.checkinDocument);

// Partage de document par email — le message part DU domaine vérifié de
// l'organisation : c'est un pouvoir d'expédition, pas une consultation.
// Ouvert à tout utilisateur authentifié, il permettait d'exfiltrer la
// bibliothèque documentaire par e-mail.
router.post('/:id/share', roleMiddleware(ADMIN_ROLES), documentController.shareDocument);

module.exports = router;
