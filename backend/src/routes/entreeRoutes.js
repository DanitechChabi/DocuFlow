const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');
const entreeController = require('../controllers/entreeController');

// Entrée des dossiers aux archives (049) : gestes de l'archive.
router.use(authMiddleware, requirePermission('requests.process'));
router.post('/import', entreeController.importer);
router.get('/semaines', entreeController.semaines);
router.get('/semaines/:debut', entreeController.semaine);
router.get('/recherche', entreeController.rechercher);
router.get('/filtres', entreeController.filtres);

module.exports = router;
