const express = require('express');
const router = express.Router();
const sectionController = require('../controllers/sectionController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Route publique — accessible sans authentification (pour le formulaire d'inscription)
router.get('/', sectionController.getSections);

// Routes protégées — nécessitent authentification et rôle SuperAdmin
router.use(authMiddleware);
router.use(roleMiddleware(['superadmin']));
router.post('/', sectionController.createSection);
router.delete('/:id', sectionController.deleteSection);

module.exports = router;
