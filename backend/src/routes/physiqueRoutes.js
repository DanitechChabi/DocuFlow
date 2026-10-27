// ============================================================================
// Routes des archives papier (migration 038), montées sous /api :
//   /api/archives/emplacements[...]     dépôts, magasins, travées, tablettes, boîtes
//   /api/documents/:id/localisation     support, boîte, cote d'un document
//   /api/archives/recolements[...]      campagnes de récolement et PV
// ============================================================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/physiqueController');
const auth = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

const consulter = [auth, requirePermission('documents.view')];
const voir = [auth, requirePermission('archives.view')];
const gerer = [auth, requirePermission('archives.manage')];

router.get('/archives/emplacements', consulter, ctrl.emplacements);
router.post('/archives/emplacements', gerer, ctrl.creerEmplacement);
router.patch('/archives/emplacements/:id', gerer, ctrl.modifierEmplacement);
router.delete('/archives/emplacements/:id', gerer, ctrl.supprimerEmplacement);
router.get('/archives/emplacements/:id/documents', consulter, ctrl.contenu);

router.get('/documents/:id/localisation', consulter, ctrl.localisation);
router.put('/documents/:id/localisation', [auth, requirePermission('documents.edit')], ctrl.placer);

router.get('/archives/recolements', voir, ctrl.recolements);
router.post('/archives/recolements', gerer, ctrl.ouvrirRecolement);
router.get('/archives/recolements/:id', voir, ctrl.recolement);
router.post('/archives/recolements/:id/constats', gerer, ctrl.constater);
router.post('/archives/recolements/:id/cloture', gerer, ctrl.clore);
router.get('/archives/recolements/:id/pv', voir, ctrl.pvRecolement);

module.exports = router;
