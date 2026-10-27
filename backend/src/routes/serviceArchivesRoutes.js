// ============================================================================
// Routes du service d'archives, montées sous /api :
//   /api/documents/:id/copies-certifiees        délivrer, lister (art. 36)
//   /api/archives/copies-certifiees[...]        registre, exemplaire, vérification
//   /api/archives/rapport-annuel/:annee         rapport d'activité (art. 31)
// ============================================================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/serviceArchivesController');
const auth = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

const consulter = [auth, requirePermission('documents.view')];
const voir = [auth, requirePermission('archives.view')];
const communiquer = [auth, requirePermission('archives.communicate')];

router.post('/documents/:id/copies-certifiees', communiquer, ctrl.delivrerCopie);
router.get('/documents/:id/copies-certifiees', consulter, ctrl.copiesDocument);
router.get('/archives/copies-certifiees', voir, ctrl.registreCopies);
router.get('/archives/copies-certifiees/:numero/pdf', communiquer, ctrl.exemplaireCopie);
router.get('/archives/copies-certifiees/:numero/verification', voir, ctrl.verifierCopie);
router.get('/archives/rapport-annuel/:annee', voir, ctrl.rapportAnnuel);

module.exports = router;
