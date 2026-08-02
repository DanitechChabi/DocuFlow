const express = require('express');
const router = express.Router();
const sectionController = require('../controllers/sectionController');
const authMiddleware = require('../middlewares/authMiddleware');
const optionalAuthMiddleware = require('../middlewares/optionalAuthMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// GET / — route publique : liste des sections, utilisée par le formulaire
// d'inscription (sans authentification). Ne renvoie que des noms de sections.
// Le token optionnel permet à un utilisateur connecté de voir LES SECTIONS
// DE SON ENTREPRISE (tenant) au lieu du tenant 1 par défaut.
router.get('/', optionalAuthMiddleware, sectionController.getSections);

// Routes protégées — nécessitent authentification et rôle SuperAdmin
router.use(authMiddleware);
router.use(roleMiddleware(['superadmin']));
router.post('/', sectionController.createSection);
router.delete('/:id', sectionController.deleteSection);

module.exports = router;
