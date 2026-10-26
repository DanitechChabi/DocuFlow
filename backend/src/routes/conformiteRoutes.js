// ============================================================================
// Routes de la conformité (migration 030), montées sous /api :
//   /api/compliance/...   tableau de bord, alertes, recalcul
//   /api/suppliers/...    fournisseurs (CRM)
// L'analyse d'UN document est sous /api/documents/:id/analysis
// (voir documentRoutes).
// ============================================================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/conformiteController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

router.use('/compliance', authMiddleware);
router.use('/suppliers', authMiddleware);

const voir = requirePermission('compliance.view');
const gerer = requirePermission('compliance.manage');

router.get('/compliance/dashboard', voir, ctrl.tableauDeBord);
router.get('/compliance/alerts', voir, ctrl.alertes);
router.patch('/compliance/alerts/:id', gerer, ctrl.traiterAlerte);
router.post('/compliance/recalculate', gerer, ctrl.recalculer);
router.get('/compliance/referentials', voir, ctrl.referentiels);

router.get('/suppliers', voir, ctrl.fournisseurs);
// La clé est composite (« id:3201710001234 », « nom:sbee ») : jamais un chemin.
router.get('/suppliers/:cle', voir, ctrl.documentsFournisseur);

module.exports = router;
