const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const push = require('../services/pushService');

// Notifications sur l'appareil (058) : chacun abonne ses propres appareils.
router.use(authMiddleware);
const geste = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (err) {
    if (!err.statut) console.error('[push]', err.message);
    res.status(err.statut || 500).json({ message: err.statut ? err.message : 'Opération impossible.' });
  }
};
router.get('/cle', geste(() => push.clePublique()));
router.post('/abonnement', geste((req) => push.abonner(req.user, req.body?.abonnement, req.body?.appareil)));
router.delete('/abonnement', geste((req) => push.desabonner(req.user, req.body?.endpoint)));
router.post('/essai', geste((req) => push.essai(req.user)));

module.exports = router;
