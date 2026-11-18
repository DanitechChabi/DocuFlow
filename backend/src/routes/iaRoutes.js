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

// Ollama (modèle de langue de DocuBot) : joignable ? quel modèle ?
router.get('/ollama', requireAnyPermission(['settings.manage']), async (req, res) => {
  res.json(await require('../services/ollamaService').etat(req.user.tenant_id));
});

// Jeu d'entraînement de DocuBot (noms inventés), à téléverser dans le carnet Colab.
router.get('/jeu-docubot/:type', requireAnyPermission(['settings.manage']), (req, res) => {
  const type = req.params.type === 'test' ? 'test' : 'entrainement';
  const { generer, enJsonl } = require('../services/jeuDocubotService');
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="jeu-docubot-${type}.jsonl"`);
  res.send(enJsonl(generer()[type]));
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

// DocuBot apprend : l'avis de la personne sur une réponse, et les corrections de l'archive.
const apprentissage = require('../services/apprentissageService');
const geste = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (err) {
    if (!err.statut) console.error('[docubot]', err.message);
    res.status(err.statut || 500).json({ message: err.statut ? err.message : 'Opération impossible.' });
  }
};
router.post('/docubot/echanges/:id/avis', geste((req) => apprentissage.avis(req.user.tenant_id, req.user.id, req.params.id, req.body || {})));
router.get('/docubot/apprentissage', requireAnyPermission(['requests.process']), geste((req) => apprentissage.aRevoir(req.user.tenant_id)));
router.post('/docubot/echanges/:id/correction', requireAnyPermission(['requests.process']), geste((req) => apprentissage.corriger(req.user.tenant_id, req.user, req.params.id, req.body?.intention)));

// La veille : ce que l'archive doit savoir ce matin.
router.get('/docubot/veille', requireAnyPermission(['requests.process']), geste(async (req) => {
  const veille = require('../services/veilleService');
  const b = await veille.bilan(req.user.tenant_id);
  return { ...b, texte: veille.enTexte(b) };
}));

module.exports = router;
