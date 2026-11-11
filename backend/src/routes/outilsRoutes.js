// ============================================================================
// Routes des outils de gestion (migration 044), montées sous /api :
//   GET  /api/archives/outils      politique, plan de classement, tableau de
//                                  gestion, charte de nommage, campagnes
//   POST /api/archives/campagnes   lancer ou relancer la campagne d'archivage
// Les outils se lisent par tous ceux qui consultent des documents : une
// politique que le personnel ne peut pas lire n'en est pas une.
// ============================================================================
const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');
const outils = require('../services/outilsService');
const campagnes = require('../services/campagneService');

const repondre = (fn, message, statut = 200) => async (req, res) => {
  try { res.status(statut).json(await fn(req)); } catch (err) {
    if (err && err.status && err.status < 500) return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
    console.error(`[outils] ${message} :`, err);
    return res.status(500).json({ message });
  }
};

router.get('/archives/outils', [auth, requirePermission('documents.view')],
  repondre((req) => outils.referentiel(req.user.tenant_id, req.user), 'Édition des outils de gestion impossible'));
router.post('/archives/campagnes', [auth, requirePermission('archives.manage')],
  repondre((req) => campagnes.lancer(req.user.tenant_id, { user: req.user }), "Lancement de la campagne impossible", 201));

module.exports = router;
