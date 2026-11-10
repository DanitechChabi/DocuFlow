// ============================================================================
// Routes du courrier (migration 041), montées sous /api/courriers.
// La permission d'entrée est mail.view ; ce que chacun voit et peut faire est
// décidé par courrierService (périmètre, confidentialité, rôle dans le courrier).
// ============================================================================
const express = require('express');
const router = express.Router();
const courrier = require('../services/courrierService');
const auth = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

router.use(auth, requirePermission('mail.view'));

const repondre = (fn, message, statut = 200) => async (req, res) => {
  try { res.status(statut).json(await fn(req)); } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
    console.error(`[courrier] ${message} :`, err);
    return res.status(500).json({ message });
  }
};

router.get('/', repondre((req) => courrier.lister(req.user, req.query), 'Lecture du registre impossible'));
router.get('/synthese', repondre((req) => courrier.synthese(req.user), 'Lecture impossible'));
router.get('/agents', repondre((req) => courrier.agents(req.user.tenant_id), 'Lecture impossible'));
router.get('/correspondants', repondre((req) => courrier.correspondants(req.user, req.query.q), 'Lecture impossible'));
router.post('/', repondre((req) => courrier.enregistrer(req.user, req.body || {}), 'Enregistrement impossible', 201));
router.get('/:id', repondre((req) => courrier.lire(req.user, req.params.id), 'Lecture impossible'));
router.patch('/:id', repondre((req) => courrier.modifier(req.user, req.params.id, req.body || {}), 'Modification impossible'));
router.post('/:id/affectation', repondre((req) => courrier.affecter(req.user, req.params.id, req.body || {}), 'Affectation impossible'));
router.post('/:id/prise-en-charge', repondre((req) => courrier.prendreEnCharge(req.user, req.params.id), 'Action impossible'));
router.post('/:id/notes', repondre((req) => courrier.annoter(req.user, req.params.id, req.body || {}), 'Note non enregistrée'));
router.post('/:id/cloture', repondre((req) => courrier.clore(req.user, req.params.id, req.body || {}), 'Clôture impossible'));
router.post('/:id/reponse', repondre((req) => courrier.repondre(req.user, req.params.id, req.body || {}), 'Réponse impossible', 201));
router.post('/:id/lettre', repondre((req) => courrier.rediger(req.user, req.params.id, req.body || {}), 'Lettre non enregistrée'));
router.post('/:id/expedition', repondre((req) => courrier.expedier(req.user, req.params.id, req.body || {}), 'Expédition non enregistrée'));
router.get('/:id/accuse-reception', async (req, res) => {
  try {
    const { numero, pdf } = await courrier.accuseReception(req.user, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="accuse-reception-${numero}.pdf"`);
    res.send(pdf);
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message });
    console.error('[courrier] accusé de réception :', err);
    return res.status(500).json({ message: "Accusé de réception indisponible" });
  }
});

module.exports = router;
