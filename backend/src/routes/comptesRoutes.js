const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');
const c = require('../controllers/comptesController');

// Gestion des comptes, pour l'administrateur (054).
router.use(authMiddleware);
router.get('/', requirePermission('users.view'), c.lister);
router.patch('/:id', requirePermission('users.edit'), c.modifier);
router.post('/:id/desactivation', requirePermission('users.disable'), c.desactiver);
router.post('/:id/reactivation', requirePermission('users.disable'), c.reactiver);
router.post('/:id/mot-de-passe', requirePermission('users.edit'), c.motDePasse);
router.post('/:id/deblocage', requirePermission('users.edit'), c.debloquer);

module.exports = router;
