const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const requestFieldController = require('../controllers/requestFieldController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Toutes les routes de demandes nécessitent une authentification
router.use(authMiddleware);

const ADMIN_ROLES = ['superadmin', 'admin', 'archiviste'];

// Créer une demande (Tous)
router.post('/', requestController.createRequest);

// Listes de choix du formulaire (Tous) — un demandeur doit pouvoir les lire.
router.get('/options', requestController.getRequestOptions);

// --- Champs configurables du formulaire (migration 016) ---
//
// Déclarés AVANT les routes `/:id/...` : Express retient la première
// correspondance, et `/fields` serait sinon capté par `/:id` comme un
// identifiant de demande — la route ne serait jamais atteinte, et le contrôleur
// de demande recevrait « fields » là où il attend un entier.
//
// La structure du formulaire est lisible par TOUS : un demandeur ne peut pas
// remplir un formulaire dont il ignore les champs. Sa configuration, elle, est
// réservée à l'administration.
router.get('/fields/form', requestFieldController.getFormFields);
router.get('/fields', roleMiddleware(['superadmin', 'admin']), requestFieldController.getFields);
router.put('/fields', roleMiddleware(['superadmin', 'admin']), requestFieldController.syncFields);
router.post('/fields/provision', roleMiddleware(['superadmin', 'admin']), requestFieldController.provisionDefaults);
router.patch('/fields/:id/visibility', roleMiddleware(['superadmin', 'admin']), requestFieldController.setVisibility);

// Voir mes demandes (Tous)
router.get('/my-requests', requestController.getUserRequests);

// Routes réservées aux Archivistes et Admins
router.get('/my-tasks', roleMiddleware(ADMIN_ROLES), requestController.getMyTasks);
router.get('/stats', roleMiddleware(ADMIN_ROLES), requestController.getStats);
router.get('/history', roleMiddleware(ADMIN_ROLES), requestController.getAuditLogs);
router.get('/all', roleMiddleware(ADMIN_ROLES), requestController.getAllRequests);
// Ancien chemin `/verify-mfile`, renommé : l'interface ne mentionne plus le nom
// d'un logiciel tiers. Le comportement est inchangé — on cherche dans le
// référentiel documentaire un document de mêmes numéros de dossier et d'acte.
router.get('/:id/matching-document', roleMiddleware(ADMIN_ROLES), requestController.findMatchingDocument);
router.patch('/:id/status', roleMiddleware(ADMIN_ROLES), requestController.updateRequestStatus);
router.patch('/:id/assign', roleMiddleware(ADMIN_ROLES), requestController.assignRequest);
router.patch('/:id/document', roleMiddleware(ADMIN_ROLES), requestController.linkDocument);

module.exports = router;
