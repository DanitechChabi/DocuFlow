// Gestion des comptes (054) : traduction HTTP de comptesService.
const comptesService = require('../services/comptesService');

const geste = (fn, contexte) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err.statut) return res.status(err.statut).json({ message: err.message });
    if (err.code === '42703') return res.status(503).json({ message: 'La gestion des comptes n\'est pas encore disponible (migration 054 à appliquer).' });
    console.error(`[comptes] ${contexte} :`, err);
    return res.status(500).json({ message: `Erreur lors de ${contexte}.` });
  }
};

exports.lister = geste((req) => comptesService.lister(req.user.tenant_id), 'la lecture des comptes');
exports.modifier = geste((req) => comptesService.modifier(req.user.tenant_id, req.user, req.params.id, req.body || {}), 'la modification du compte');
exports.desactiver = geste((req) => comptesService.activer(req.user.tenant_id, req.user, req.params.id, false), 'la désactivation du compte');
exports.reactiver = geste((req) => comptesService.activer(req.user.tenant_id, req.user, req.params.id, true), 'la réactivation du compte');
exports.motDePasse = geste((req) => comptesService.motDePasseProvisoire(req.user.tenant_id, req.user, req.params.id), 'la création du mot de passe provisoire');
