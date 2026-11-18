const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');
const cartons = require('../services/cartonsService');

// Dossiers en cartons (057) : gestes de l'archive.
router.use(authMiddleware, requirePermission('requests.process'));
const geste = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (err) {
    if (!err.statut) console.error('[cartons]', err.message);
    res.status(err.statut || 500).json({ message: err.statut ? err.message : 'Opération impossible.' });
  }
};
router.post('/import', geste((req) => cartons.importer(req.user.tenant_id, req.user, req.body || {})));
router.get('/recherche', geste((req) => cartons.rechercher(req.user.tenant_id, req.query)));
router.get('/liste/:fonds', geste((req) => cartons.cartons(req.user.tenant_id, req.params.fonds)));
router.get('/fichiers', geste((req) => cartons.fichiers(req.user.tenant_id)));
router.delete('/fichiers', geste((req) => cartons.supprimerFichier(req.user.tenant_id, req.user, req.body || {})));

module.exports = router;
