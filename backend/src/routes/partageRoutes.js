// ============================================================================
// Routes PUBLIQUES des liens de partage (migration 033), montées sous /api
// SANS authentification : le jeton du lien est la seule autorisation, revérifiée
// à chaque requête par partageController (voir son en-tête).
// ============================================================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/partageController');

router.get('/partage/:jeton', ctrl.consulter);
router.post('/partage/:jeton/acces', ctrl.acceder);
router.get('/partage/:jeton/fichier', ctrl.fichier);

module.exports = router;
