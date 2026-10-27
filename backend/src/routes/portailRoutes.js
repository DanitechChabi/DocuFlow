// ============================================================================
// Portail citoyen et vérification publique (migration 040), montés sous /api.
//   PUBLIC (sans compte, débit limité) :
//     GET  /api/portail/:slug                 l'organisation et son message
//     POST /api/portail/:slug/demandes        dépôt d'une demande d'acte
//     GET  /api/portail/:slug/suivi/:code     avancement (aucune donnée nominative)
//     GET  /api/verifier/:jeton               vérification d'une copie certifiée (QR)
//   PERSONNEL :
//     GET  /api/requests/:id/citoyen          identité de l'usager, copies, statut vu par lui
//     POST /api/requests/:id/citoyen/retrait  retrait constaté au guichet
//     GET  /api/portail-indicateurs           chiffres du portail
// ============================================================================
const express = require('express');
const router = express.Router();
const portail = require('../services/portailService');
const copies = require('../services/copieCertifieeService');
const auth = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');
const { limiteur } = require('../middlewares/limiteur');

const depots = limiteur({ max: 5, fenetreMs: 60 * 60 * 1000, message: 'Trop de demandes depuis cette connexion : réessayez dans une heure.' });
const lectures = limiteur({ max: 60, fenetreMs: 10 * 60 * 1000 });
const traiter = [auth, requirePermission('requests.process')];

const repondre = (fn, message) => async (req, res) => {
  try {
    const r = await fn(req);
    if (r === null) return res.status(404).json({ message: 'Introuvable.' });
    return res.json(r);
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
    console.error(`[portail] ${message} :`, err);
    return res.status(500).json({ message });
  }
};

router.get('/portail/:slug', lectures, repondre(async (req) => {
  const o = await portail.organisation(req.params.slug);
  return o && { nom: o.nom, slug: o.slug, logo: o.logo, message: o.message, lieu_retrait: o.lieu_retrait, types: portail.TYPES_ACTE, liens: portail.LIENS };
}, 'Portail indisponible'));
router.post('/portail/:slug/demandes', depots, async (req, res) => {
  try {
    res.status(201).json(await portail.deposer(req.params.slug, req.body || {}, { ip: req.ip }));
  } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message });
    console.error('[portail] dépôt :', err);
    return res.status(500).json({ message: 'Dépôt impossible pour le moment.' });
  }
});
router.get('/portail/:slug/suivi/:code', lectures, repondre((req) => portail.suivre(req.params.slug, req.params.code), 'Suivi indisponible'));
router.get('/verifier/:jeton', lectures, repondre((req) => copies.verifierPublic(req.params.jeton, req.query.empreinte), 'Vérification indisponible'));

router.get('/requests/:id/citoyen', traiter, repondre(async (req) => (await portail.pourDemande(req.user.tenant_id, req.params.id)) || { aucune: true }, 'Lecture impossible'));
router.post('/requests/:id/citoyen/retrait', traiter, repondre((req) => portail.marquerRetire(req.user.tenant_id, req.params.id, req.user), 'Enregistrement du retrait impossible'));
router.get('/portail-indicateurs', traiter, repondre((req) => portail.indicateurs(req.user.tenant_id), 'Lecture impossible'));

module.exports = router;
