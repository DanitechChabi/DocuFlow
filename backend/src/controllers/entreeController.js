// Entrée des dossiers aux archives (049) : traduction HTTP de entreeService.
const entreeService = require('../services/entreeService');

const geste = (fn, contexte) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err.statut) return res.status(err.statut).json({ message: err.message });
    if (err.code === '42P01') return res.status(503).json({ message: 'L\'entrée des dossiers n\'est pas encore disponible (migration 049 à appliquer).' });
    console.error(`[entrées] ${contexte} :`, err);
    return res.status(500).json({ message: `Erreur lors de ${contexte}.` });
  }
};

exports.importer = geste((req) => entreeService.importer(req.user.tenant_id, req.user, req.body || {}), 'l\'import');
exports.semaines = geste((req) => entreeService.semaines(req.user.tenant_id, req.query), 'la lecture des semaines');
exports.semaine = geste((req) => entreeService.semaine(req.user.tenant_id, req.params.debut), 'la lecture de la semaine');
exports.rechercher = geste((req) => entreeService.rechercher(req.user.tenant_id, req.query), 'la recherche');
exports.filtres = geste((req) => entreeService.filtres(req.user.tenant_id), 'la lecture des filtres');
exports.presence = geste((req) => entreeService.presence(req.user.tenant_id, req.query), 'la recherche de présence');
exports.presences = geste((req) => entreeService.presences(req.user.tenant_id, req.body?.dossiers), 'la recherche de présence');
exports.fichiers = geste((req) => entreeService.fichiers(req.user.tenant_id), 'la lecture des classeurs');
exports.supprimerFichier = geste((req) => entreeService.supprimerFichier(req.user.tenant_id, req.user, req.body || {}), 'la suppression du classeur');
