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

// Plan de rangement (052) : les armoires et ce qu'elles contiennent.
const rangementService = require('../services/rangementService');
exports.rangements = geste((req) => rangementService.lister(req.user.tenant_id), 'la lecture du plan de rangement');
exports.creerRangement = geste((req) => rangementService.creer(req.user.tenant_id, req.user, req.body || {}), 'l\'ajout de l\'armoire');
exports.modifierRangement = geste((req) => rangementService.modifier(req.user.tenant_id, req.user, req.params.id, req.body || {}), 'la modification de l\'armoire');
exports.supprimerRangement = geste((req) => rangementService.supprimer(req.user.tenant_id, req.user, req.params.id), 'la suppression de l\'armoire');
exports.planRangement = geste((req) => rangementService.planPropose(req.user.tenant_id), 'la lecture du plan proposé');
exports.installerPlan = geste((req) => rangementService.installerPlan(req.user.tenant_id, req.user), 'l\'installation du plan');

// Douchette (053) : sorties et retours en scannant l'étiquette du dossier.
const douchetteService = require('../services/douchetteService');
const gesteMetier = (fn, contexte) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    // Erreurs des prêts (déjà remis, date invalide…) : leur message, leur statut.
    if (err.statut) return res.status(err.statut).json({ message: err.message, ...(err.code && typeof err.code === 'string' && !/^\d/.test(err.code) ? { code: err.code } : {}) });
    if (err.code === '42703') return res.status(503).json({ message: 'La douchette n\'est pas encore disponible (migration 053 à appliquer).' });
    console.error(`[douchette] ${contexte} :`, err);
    return res.status(500).json({ message: `Erreur lors de ${contexte}.` });
  }
};
exports.lireScan = gesteMetier((req) => douchetteService.lire(req.user.tenant_id, req.query.code), 'la lecture du code');
exports.sortieScan = gesteMetier((req) => douchetteService.sortir(req.user.tenant_id, req.user, req.body || {}), 'la sortie du dossier');
exports.retourScan = gesteMetier((req) => douchetteService.rentrer(req.user.tenant_id, req.user, req.body || {}), 'le retour du dossier');
