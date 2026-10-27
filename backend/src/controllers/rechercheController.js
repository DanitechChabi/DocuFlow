// ============================================================================
// rechercheController — recherche avancée, recherches enregistrées,
// échéancier et export « paquet d'archive » (migration 035).
// Chaque réponse est bornée par le périmètre de l'utilisateur (ACL) : voir
// rechercheService.construireRequete, echeanceService, paquetService.
// ============================================================================
const recherche = require('../services/rechercheService');
const echeances = require('../services/echeanceService');
const paquets = require('../services/paquetService');
const { verifierAccesDocument, repondreRefus } = require('../helpers/accesDocument');

const erreur = (res, err, message) => {
  if (err && err.status && err.status < 500) {
    return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error(`[recherche] ${message} :`, err);
  return res.status(500).json({ message });
};

// --------------------------------------------------------------- recherche
exports.rechercher = async (req, res) => {
  try {
    const { criteres = {}, page, par_page: parPage, tri } = req.body || {};
    res.json(await recherche.rechercher(req.user.tenant_id, req.user, criteres, { page, parPage, tri }));
  } catch (err) { erreur(res, err, 'Recherche impossible'); }
};
exports.referentiel = async (req, res) => {
  try { res.json(await recherche.referentiel(req.user.tenant_id, req.user)); } catch (err) { erreur(res, err, 'Chargement des critères impossible'); }
};

// ------------------------------------------------------ recherches enregistrées
exports.recherches = async (req, res) => {
  try { res.json(await recherche.listerRecherches(req.user.tenant_id, req.user, { epinglees: req.query.epinglees === 'true' })); } catch (err) { erreur(res, err, 'Chargement des recherches impossible'); }
};
exports.creerRecherche = async (req, res) => {
  try { res.status(201).json(await recherche.creerRecherche(req.user.tenant_id, req.user, req.body || {})); } catch (err) { erreur(res, err, 'Enregistrement de la recherche impossible'); }
};
exports.modifierRecherche = async (req, res) => {
  try { res.json(await recherche.modifierRecherche(req.user.tenant_id, req.user, req.params.id, req.body || {})); } catch (err) { erreur(res, err, 'Modification de la recherche impossible'); }
};
exports.supprimerRecherche = async (req, res) => {
  try { res.json(await recherche.supprimerRecherche(req.user.tenant_id, req.user, req.params.id)); } catch (err) { erreur(res, err, 'Suppression de la recherche impossible'); }
};

// ------------------------------------------------------------------ échéances
exports.echeancier = async (req, res) => {
  try { res.json(await echeances.lister(req.user.tenant_id, req.user, { vue: req.query.vue, mois: req.query.mois })); } catch (err) { erreur(res, err, "Chargement de l'échéancier impossible"); }
};
exports.echeancesDocument = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req);
    if (refus) return repondreRefus(res, refus);
    res.json(await echeances.deDocument(req.user.tenant_id, document.id));
  } catch (err) { erreur(res, err, 'Chargement des échéances impossible'); }
};
exports.creerEcheance = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req, { mode: 'write', corbeille: false });
    if (refus) return repondreRefus(res, refus);
    res.status(201).json(await echeances.creer(req.user.tenant_id, document.id, req.user, req.body || {}));
  } catch (err) { erreur(res, err, "Ajout de l'échéance impossible"); }
};
const actionEcheance = (fn, message) => async (req, res) => {
  try { res.json(await fn(req.user.tenant_id, req.params.id, req.user, req.body || {})); } catch (err) { erreur(res, err, message); }
};
exports.traiterEcheance = actionEcheance(echeances.traiter, 'Traitement impossible');
exports.annulerEcheance = actionEcheance(echeances.annuler, 'Annulation impossible');
exports.reporterEcheance = actionEcheance(echeances.reporter, 'Report impossible');
exports.supprimerEcheance = actionEcheance((t, id, u) => echeances.supprimer(t, id, u), 'Suppression impossible');

// --------------------------------------------------------------------- paquet
async function envoyerPaquet(req, res, ids, versions, nomImpose = null) {
  const prepare = await paquets.preparer(req.user.tenant_id, req.user, ids, { versions });
  const nom = nomImpose || (prepare.docs.length === 1
    ? `paquet-${String(prepare.docs[0].reference_mfile || prepare.docs[0].id).replace(/[^\w.-]/g, '_')}.zip`
    : `paquet-archive-${new Date().toISOString().slice(0, 10)}.zip`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
  res.setHeader('Cache-Control', 'no-store');
  // Contre-pression : on attend que la réponse ait vidé son tampon.
  const ecrire = (b) => new Promise((resolve) => { if (res.write(b)) resolve(); else res.once('drain', resolve); });
  const bilan = await paquets.exporter(req.user.tenant_id, req.user, prepare, ecrire, { ip: req.ip });
  res.end();
  return bilan;
}
exports.paquetDocument = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req, { corbeille: false });
    if (refus) return repondreRefus(res, refus);
    await envoyerPaquet(req, res, [document.id], req.query.versions === 'toutes' ? 'toutes' : 'courante');
  } catch (err) {
    if (res.headersSent) { console.error('[paquet] export interrompu :', err.message); res.destroy(err); } else erreur(res, err, 'Export du paquet impossible');
  }
};
exports.paquetSelection = async (req, res) => {
  try {
    await envoyerPaquet(req, res, req.body?.ids || [], req.body?.versions === 'toutes' ? 'toutes' : 'courante');
  } catch (err) {
    if (res.headersSent) { console.error('[paquet] export interrompu :', err.message); res.destroy(err); } else erreur(res, err, 'Export du paquet impossible');
  }
};

exports.envoyerPaquet = envoyerPaquet;
