// ============================================================================
// Routes des circuits de validation (migration 034), montées sous /api :
//   /api/circuits/...            modèles (workflows.manage), suivi
//   /api/taches/...              « Mes tâches » : être destinataire suffit
//   /api/documents/:id/circuit   circuit d'un document (lecture : documents.view ;
//                                lancer / annuler / reprendre : workflows.start)
// Authentification route par route : /api/documents/:id/files/:fileId/download
// est public (ticket signé) et ne doit pas l'exiger.
// ============================================================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/circuitController');
const auth = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

const gerer = [auth, requirePermission('workflows.manage')];
const lancer = [auth, requirePermission('workflows.start')];

router.get('/circuits', gerer, ctrl.modeles);
router.get('/circuits/referentiel', gerer, ctrl.referentiel);
router.get('/circuits/suivi', gerer, ctrl.suivi);
router.get('/circuits/:id', gerer, ctrl.modele);
router.post('/circuits', gerer, ctrl.creerModele);
router.put('/circuits/:id', gerer, ctrl.modifierModele);
router.delete('/circuits/:id', gerer, ctrl.supprimerModele);

router.get('/taches', auth, ctrl.mesTaches);
router.get('/taches/compte', auth, ctrl.compte);
router.post('/taches/:id/decision', auth, ctrl.decider);
router.get('/taches/:id/delegataires', auth, ctrl.delegataires);
router.post('/taches/:id/delegation', auth, ctrl.deleguer);
router.post('/taches/:id/reassignation', gerer, ctrl.reassigner);

router.get('/documents/:id/circuit', auth, requirePermission('documents.view'), ctrl.etatDocument);
router.post('/documents/:id/circuit', lancer, ctrl.demarrer);
router.post('/documents/:id/circuit/annulation', lancer, ctrl.annuler);
router.post('/documents/:id/circuit/reprise', lancer, ctrl.relancer);

module.exports = router;
