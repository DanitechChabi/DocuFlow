// ============================================================================
// listeController — demandes groupées en listes (047). La logique vit dans
// services/listeService ; ici, la traduction HTTP. Les erreurs métier portent
// leur statut (400, 403, 404, 409, 422) ; une base sans la migration 047
// répond 503 avec la marche à suivre.
// ============================================================================
const listeService = require('../services/listeService');

function repondreErreur(res, err, contexte) {
  if (err.statut) {
    return res.status(err.statut).json({
      message: err.message,
      ...(typeof err.code === 'string' && !/^\d/.test(err.code) ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }
  if (err.code === '42P01' || err.code === '42703') {
    return res.status(503).json({
      message: 'Les listes de demandes ne sont pas encore disponibles sur cette installation (migration 047 à appliquer).',
      code: 'MIGRATION_047_REQUISE',
    });
  }
  if (err.code === '23505') {
    return res.status(409).json({ message: 'Un dossier de cette sélection vient d\'être transmis par quelqu\'un d\'autre. Rechargez la liste.', code: 'DEJA_REMIS' });
  }
  console.error(`[listes] ${contexte} :`, err);
  return res.status(500).json({ message: `Erreur lors de ${contexte}.` });
}

const geste = (fn, contexte, statut = 200) => async (req, res) => {
  try {
    res.status(statut).json(await fn(req));
  } catch (err) {
    repondreErreur(res, err, contexte);
  }
};

exports.creer = geste((req) => listeService.creer(req.user.tenant_id, req.user, req.body || {}), 'l\'enregistrement de la liste', 201);
exports.lister = geste((req) => listeService.lister(req.user.tenant_id, req.user, { cadre: req.query.cadre, q: req.query.q }), 'la lecture des listes');
exports.detail = geste((req) => listeService.detail(req.user.tenant_id, req.params.listeId, req.user), 'la lecture de la liste');
exports.typologie = geste((req) => listeService.fixerTypologie(req.user.tenant_id, req.user, req.params.id, req.body?.type_document), 'la mise à jour de la typologie');
exports.transmettre = geste((req) => listeService.transmettre(req.user.tenant_id, req.params.listeId, req.user, req.body || {}), 'la transmission de la liste');
exports.retourner = geste((req) => listeService.retourner(req.user.tenant_id, req.params.listeId, req.user, req.body || {}), 'l\'enregistrement du retour');
exports.dossiersConnus = geste((req) => listeService.dossiersConnus(req.user.tenant_id, req.user, req.query.q), 'la recherche des dossiers');
exports.cadres = geste(async (req) => (await listeService.cadresAdmis(req.user.tenant_id)), 'la lecture des cadres');

// --- Demandes reçues par l'archive (téléphone) ---
const demandeRapideService = require('../services/demandeRapideService');
exports.demandeurs = geste((req) => demandeRapideService.demandeurs(req.user.tenant_id), 'la lecture des agents');
exports.pourAgent = geste((req) => demandeRapideService.pourAgent(req.user.tenant_id, req.user, req.body || {}), 'l\'enregistrement de la demande', 201);
exports.supprimer = geste((req) => listeService.supprimer(req.user.tenant_id, req.params.listeId, req.user), 'la suppression de la liste');
