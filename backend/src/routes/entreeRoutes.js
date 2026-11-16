const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middlewares/requirePermission');
const entreeController = require('../controllers/entreeController');

// Présence d'un dossier aux archives (050) : le demandeur la voit en
// demandant ; seuls la dénomination, les actes et le classement sont rendus.
const demandeur = requireAnyPermission(['requests.create', 'requests.process']);
router.get('/presence', authMiddleware, demandeur, entreeController.presence);
router.post('/presences', authMiddleware, demandeur, entreeController.presences);

// Entrée des dossiers aux archives (049) : gestes de l'archive.
router.use(authMiddleware, requirePermission('requests.process'));
router.post('/import', entreeController.importer);
router.get('/semaines', entreeController.semaines);
router.get('/semaines/:debut', entreeController.semaine);
router.get('/recherche', entreeController.rechercher);
router.get('/filtres', entreeController.filtres);
router.get('/fichiers', entreeController.fichiers);
router.delete('/fichiers', entreeController.supprimerFichier);

module.exports = router;
