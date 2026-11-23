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
router.put('/lettre', entreeController.corrigerLettre);
router.get('/lettres/apercu', entreeController.lettresApercu);
router.post('/lettres/appliquer', entreeController.lettresAppliquer);
router.get('/recherche', entreeController.rechercher);
router.get('/filtres', entreeController.filtres);
router.get('/fichiers', entreeController.fichiers);
router.delete('/fichiers', entreeController.supprimerFichier);
// Douchette (053) : lire un code, sortir, rentrer.
// Tableau de bord des archives (direction).
router.get('/tableau-de-bord', entreeController.tableauBord);
router.get('/douchette', entreeController.lireScan);
router.post('/douchette/sortie', entreeController.sortieScan);
router.post('/douchette/retour', entreeController.retourScan);
// Plan de rangement (052).
router.get('/rangements', entreeController.rangements);
router.post('/rangements', entreeController.creerRangement);
router.get('/rangements/plan', entreeController.planRangement);
router.post('/rangements/plan', entreeController.installerPlan);
router.put('/rangements/:id', entreeController.modifierRangement);
router.delete('/rangements/:id', entreeController.supprimerRangement);

module.exports = router;
