const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middlewares/requirePermission');

// Toutes les routes exigent une authentification.
router.use(authMiddleware);

// Le catalogue (modules + permissions, libellés français) : lisible par la
// matrice d'administration — donc par qui peut déjà voir les rôles.
router.get('/catalogue', requirePermission('roles.view'), roleController.catalogue);

// Lecture des rôles : roles.view.
router.get('/', requirePermission('roles.view'), roleController.list);

// Porteurs d'un rôle : même lecture (préalable à une suppression propre).
router.get('/:key/users', requirePermission('roles.view'), roleController.users);

// ÉCRITURE — la garde délibérée : les trois actions exigent à la fois
// roles.manage (créer/modifier/supprimer) ET roles.edit/view ; la matrice ne
// s'édite pas avec une permission qu'elle accorde (escalade sinon). En
// pratique, seul l'administrateur (et le super administrateur) portent les
// trois. Voir roleController pour le refus du joker '*' sur les rôles
// personnalisés.
const gerer = [requirePermission('roles.view'), requirePermission('roles.edit')];

router.post('/', ...gerer, roleController.create);
router.patch('/:key', ...gerer, roleController.update);
router.delete('/:key', ...gerer, roleController.remove);

module.exports = router;
