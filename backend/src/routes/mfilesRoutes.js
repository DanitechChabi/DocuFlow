const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');
const mfiles = require('../services/mfilesApiService');
const rag = require('../services/ragService');

// M-Files (API REST) et RAG (060). Le compte de service M-Files voit tout le
// coffre : la recherche et les fichiers sont réservés à l'archive.
router.use(authMiddleware, requirePermission('requests.process'));
const geste = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (err) {
    if (!err.statut) console.error('[m-files]', err.message);
    res.status(err.statut || 500).json({ message: err.statut ? err.message : 'Opération impossible.' });
  }
};
const t = (req) => req.user.tenant_id;

router.get('/etat', geste(async (req) => ({ mfiles: await mfiles.etat(t(req)), rag: await rag.etat(t(req)) })));
router.get('/recherche', geste((req) => mfiles.rechercher(t(req), req.query.q, { limite: req.query.limite })));
router.get('/objets/:type/:id', geste((req) => mfiles.objet(t(req), req.params.type, req.params.id)));
router.get('/objets/:type/:id/fichiers/:fichier', async (req, res) => {
  try {
    const { buffer, type } = await mfiles.contenu(t(req), req.params.type, req.params.id, req.params.fichier);
    const nom = String(req.query.nom || `mfiles-${req.params.id}`).replace(/[^\w.\- ]+/g, '_').slice(0, 150);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `${req.query.telecharger ? 'attachment' : 'inline'}; filename="${nom}"`);
    res.send(buffer);
  } catch (err) {
    res.status(err.statut || 500).json({ message: err.statut ? err.message : 'Fichier indisponible.' });
  }
});
// Indexer pour DocuBot : un objet, ou tous les résultats d'une recherche.
router.post('/objets/:type/:id/indexer', geste(async (req) => {
  const o = await mfiles.objet(t(req), req.params.type, req.params.id);
  return rag.indexerObjetMfiles(t(req), { ...o, version: null }, { forcer: true });
}));
router.post('/indexer', geste((req) => rag.indexerRechercheMfiles(t(req), req.body?.q, { limite: Math.min(Number(req.body?.limite) || 100, 500) })));
// Question posée aux documents (GED et M-Files indexés).
router.post('/question', geste(async (req) => (await rag.repondre(t(req), req.body?.question)) || { texte: 'Aucun passage des documents indexés ne répond à cette question.', sources: [] }));

module.exports = router;
