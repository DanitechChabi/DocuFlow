// Compléments d'une demande (051) : traduction HTTP de complementService.
const complementService = require('../services/complementService');

const geste = (fn, contexte) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err.statut) return res.status(err.statut).json({ message: err.message });
    if (err.code === '42703') return res.status(503).json({ message: 'Les compléments ne sont pas encore disponibles (migration 051 à appliquer).' });
    console.error(`[compléments] ${contexte} :`, err);
    return res.status(500).json({ message: `Erreur lors de ${contexte}.` });
  }
};

exports.demander = geste((req) => complementService.demander(req.user.tenant_id, req.user, req.params.id, req.body || {}), 'la demande de compléments');
exports.completer = geste((req) => complementService.completer(req.user.tenant_id, req.user, req.params.id, req.body || {}), 'l\'envoi des compléments');
