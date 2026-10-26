// ============================================================================
// Routes de la recherche avancée, des recherches enregistrées, de
// l'échéancier et du paquet d'archive (migration 035), montées sous /api.
// Authentification route par route : /api/documents/:id/files/:fileId/download
// est public (ticket signé) et ne doit pas l'exiger.
// ============================================================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/rechercheController');
const auth = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

const avancee = [auth, requirePermission('search.advanced')];
const chercher = [auth, requirePermission('search.documents')];
const lire = [auth, requirePermission('documents.view')];
const telecharger = [auth, requirePermission('documents.download')];

router.post('/documents/recherche', avancee, ctrl.rechercher);
router.get('/recherche/referentiel', avancee, ctrl.referentiel);
router.get('/recherches', chercher, ctrl.recherches);
router.post('/recherches', chercher, ctrl.creerRecherche);
router.patch('/recherches/:id', chercher, ctrl.modifierRecherche);
router.delete('/recherches/:id', chercher, ctrl.supprimerRecherche);

router.get('/echeances', lire, ctrl.echeancier);
router.post('/echeances/:id/traitement', lire, ctrl.traiterEcheance);
router.post('/echeances/:id/annulation', lire, ctrl.annulerEcheance);
router.post('/echeances/:id/report', lire, ctrl.reporterEcheance);
router.delete('/echeances/:id', lire, ctrl.supprimerEcheance);
router.get('/documents/:id/echeances', lire, ctrl.echeancesDocument);
router.post('/documents/:id/echeances', lire, ctrl.creerEcheance);

router.post('/documents/paquet', telecharger, ctrl.paquetSelection);
router.get('/documents/:id/paquet', telecharger, ctrl.paquetDocument);

module.exports = router;
