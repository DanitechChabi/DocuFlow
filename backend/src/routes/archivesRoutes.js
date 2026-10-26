// ============================================================================
// Routes de l'archivage (migration 031), montées sous /api :
//   /api/archives/...   rapport d'intégrité, anomalies, doublons, journal
//                       chaîné et sceaux, gels juridiques, certificats
// Le volet d'UN document est sous /api/documents/:id/{integrite,certificat,gel}
// (voir documentRoutes).
// ============================================================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/archivesController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

router.use('/archives', authMiddleware);

const voir = requirePermission('archives.view');
const gerer = requirePermission('archives.manage');

router.get('/archives/integrite', voir, ctrl.rapport);
router.get('/archives/integrite/anomalies', voir, ctrl.anomalies);
router.get('/archives/integrite/doublons', voir, ctrl.doublons);
router.post('/archives/integrite/verifier', gerer, ctrl.verifierLot);
router.get('/archives/journal/verification', voir, ctrl.verifierJournal);
router.get('/archives/journal/sceaux', voir, ctrl.sceaux);
router.post('/archives/journal/sceaux', gerer, ctrl.sceller);
router.get('/archives/gels', voir, ctrl.gels);
router.get('/archives/certificats/:numero', voir, ctrl.verifierCertificat);

module.exports = router;
