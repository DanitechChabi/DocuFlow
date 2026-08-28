const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const requestFieldController = require('../controllers/requestFieldController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middlewares/requirePermission');

// Toutes les routes de demandes nécessitent une authentification
router.use(authMiddleware);

// Créer une demande (permission requests.create — le rôle demandeur la porte)
router.post('/', requirePermission('requests.create'), requestController.createRequest);

// Listes de choix du formulaire — un demandeur doit pouvoir les lire.
router.get('/options', requirePermission('requests.create'), requestController.getRequestOptions);

// --- Champs configurables du formulaire (migration 016) ---
//
// Déclarés AVANT les routes `/:id/...` : Express retient la première
// correspondance, et `/fields` serait sinon capté par `/:id` comme un
// identifiant de demande — la route ne serait jamais atteinte, et le contrôleur
// de demande recevrait « fields » là où il attend un entier.
//
// La structure du formulaire est lisible par TOUS (permission requests.create,
// portée par le demandeur) : on ne peut pas remplir un formulaire dont on
// ignore les champs. Sa configuration, elle, est une administration de
// l'organisation (settings.manage).
router.get('/fields/form', requirePermission('requests.create'), requestFieldController.getFormFields);
router.get('/fields', requirePermission('settings.manage'), requestFieldController.getFields);
router.put('/fields', requirePermission('settings.manage'), requestFieldController.syncFields);
router.post('/fields/provision', requirePermission('settings.manage'), requestFieldController.provisionDefaults);
router.patch('/fields/:id/visibility', requirePermission('settings.manage'), requestFieldController.setVisibility);

// Voir mes demandes (requests.view)
router.get('/my-requests', requirePermission('requests.view'), requestController.getUserRequests);

// Personnel de traitement : ces vues exigent soit le traitement (mes tâches),
// soit la supervision (stats, historique global, toutes les demandes).
router.get('/my-tasks', requirePermission('requests.process'), requestController.getMyTasks);
router.get('/stats', requirePermission('requests.process'), requestController.getStats);
router.get('/history', requirePermission('requests.view_history'), requestController.getAuditLogs);
router.get('/all', requireAnyPermission(['requests.process', 'requests.view']), requestController.getAllRequests);
// Ancien chemin `/verify-mfile`, renommé : l'interface ne mentionne plus le nom
// d'un logiciel tiers. Le comportement est inchangé — on cherche dans le
// référentiel documentaire un document de mêmes numéros de dossier et d'acte.
router.get('/:id/matching-document', requirePermission('requests.process'), requestController.findMatchingDocument);
router.patch('/:id/status', requirePermission('requests.process'), requestController.updateRequestStatus);
router.patch('/:id/assign', requirePermission('requests.assign'), requestController.assignRequest);
// Lier/délier un document GED : une action documentaire autant que de demande —
// l'indexation elle-même exige documents.index ; le lien exige le côté demande.
router.patch('/:id/document', requirePermission('requests.process'), requestController.linkDocument);

module.exports = router;
