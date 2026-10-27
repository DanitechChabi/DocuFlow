// ============================================================================
// Routes de l'archivage réglementaire (migration 032), montées sous /api :
//   /api/archives/classes/:id/dua         DUA et sort final d'une classe
//   /api/archives/sort-final               échéances atteintes ou proches
//   /api/archives/bordereaux/...           bordereaux d'élimination et PV
//   /api/documents/:id/dua                 échéance d'un document (fiche)
// archives.manage prépare, propose et exécute ; archives.validate valide ou
// rejette (jamais son propre bordereau : voir archivageService).
// ============================================================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/archivageController');
const auth = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

const voir = [auth, requirePermission('archives.view')];
const gerer = [auth, requirePermission('archives.manage')];
const valider = [auth, requirePermission('archives.validate')];

router.put('/archives/classes/:id/dua', gerer, ctrl.definirDua);
router.get('/archives/sort-final', voir, ctrl.sortFinal);
router.post('/archives/sort-final/decisions', gerer, ctrl.decider);
router.delete('/archives/sort-final/decisions/:documentId', gerer, ctrl.annulerDecision);

router.get('/archives/bordereaux', voir, ctrl.bordereaux);
router.post('/archives/bordereaux', gerer, ctrl.creer);
router.get('/archives/bordereaux/:id', voir, ctrl.bordereau);
router.patch('/archives/bordereaux/:id', gerer, ctrl.modifier);
router.post('/archives/bordereaux/:id/documents', gerer, ctrl.ajouter);
router.delete('/archives/bordereaux/:id/documents/:documentId', gerer, ctrl.retirer);
router.post('/archives/bordereaux/:id/proposition', gerer, ctrl.proposer);
router.post('/archives/bordereaux/:id/retrait', gerer, ctrl.retirerProposition);
router.post('/archives/bordereaux/:id/validation', valider, ctrl.valider);
router.post('/archives/bordereaux/:id/rejet', valider, ctrl.rejeter);
router.post('/archives/bordereaux/:id/reprise', gerer, ctrl.reprendre);
router.post('/archives/bordereaux/:id/annulation', gerer, ctrl.annuler);
router.post('/archives/bordereaux/:id/transmission', gerer, ctrl.transmettre);
router.post('/archives/bordereaux/:id/visa', gerer, ctrl.visa);
router.post('/archives/bordereaux/:id/execution', gerer, ctrl.executer);
router.get('/archives/bordereaux/:id/pv', voir, ctrl.procesVerbal);

router.get('/archives/versements', voir, ctrl.versements);
router.post('/archives/versements', gerer, ctrl.creerVersement);
router.get('/archives/versements/:id', voir, ctrl.versement);
router.post('/archives/versements/:id/documents', gerer, ctrl.ajouterVersement);
router.delete('/archives/versements/:id/documents/:documentId', gerer, ctrl.retirerVersement);
router.post('/archives/versements/:id/transmission', gerer, ctrl.transmettreVersement);
router.post('/archives/versements/:id/prise-en-charge', gerer, ctrl.priseEnCharge);
router.post('/archives/versements/:id/annulation', gerer, ctrl.annulerVersement);
router.get('/archives/versements/:id/paquet', gerer, ctrl.paquetVersement);

router.get('/documents/:id/dua', auth, requirePermission('documents.view'), ctrl.echeanceDocument);

module.exports = router;
