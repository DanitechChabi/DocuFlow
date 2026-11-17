const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { requireAnyPermission } = require('../middlewares/requirePermission');
const ia = require('../services/iaService');
const listeService = require('../services/listeService');

// Aide automatique sur le serveur (iaService) : rien ne sort du serveur.
router.use(authMiddleware);

// État des modèles : lesquels tournent sur ce serveur.
router.get('/etat', requireAnyPermission(['settings.manage', 'requests.process']), (req, res) => {
  res.json(ia.etat());
});

// Lecture d'une demande écrite en phrase : entreprise, acte, année, typologie proposée.
router.post('/lire-demande', requireAnyPermission(['requests.create', 'requests.process']), async (req, res) => {
  try {
    const texte = String(req.body?.texte ?? '').slice(0, 1000);
    const types = await listeService.typesAdmis(req.user.tenant_id);
    res.json(await ia.lireDemande(texte, types));
  } catch (err) {
    console.error('[ia] lecture de la demande :', err.message);
    res.status(500).json({ message: 'Lecture de la demande impossible.' });
  }
});

// DocuBot (AFGC) : questions en langage courant sur les archives, selon les droits.
const docubot = require('../services/docubotService');
router.get('/docubot', async (req, res) => {
  try {
    const droits = await docubot.droitsDe(req.user);
    res.json({ suggestions: docubot.suggestionsAccueil(droits), archive: droits.archive });
  } catch (err) {
    res.status(500).json({ message: 'DocuBot indisponible.' });
  }
});
router.post('/docubot', async (req, res) => {
  try {
    const contexte = req.body?.contexte && typeof req.body.contexte === 'object' ? { entreprise: String(req.body.contexte.entreprise || '').slice(0, 200) || null } : {};
    res.json(await docubot.repondre(req.user, req.body?.question, contexte));
  } catch (err) {
    console.error('[docubot]', err.message);
    res.status(500).json({ message: 'DocuBot n\'a pas pu répondre.' });
  }
});

module.exports = router;
