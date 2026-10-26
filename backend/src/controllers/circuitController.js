// ============================================================================
// circuitController — circuits de validation (migration 034) : modèles
// (workflows.manage), circuit d'un document (workflows.start pour lancer ou
// annuler, être destinataire pour décider), « Mes tâches », suivi.
// La logique et ses gardes vivent dans circuitService ; ici, le périmètre
// (ACL) du document et la traduction HTTP des erreurs.
// ============================================================================
const circuits = require('../services/circuitService');
const { verifierAccesDocument, repondreRefus } = require('../helpers/accesDocument');

const erreur = (res, err, message) => {
  if (err && err.status && err.status < 500) {
    return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  if (err && err.status === 503) return res.status(503).json({ message: err.message });
  console.error(`[circuits] ${message} :`, err);
  return res.status(500).json({ message });
};

const ip = (req) => ({ ip: req.ip });

// ----------------------------------------------------------------- modèles
exports.modeles = async (req, res) => {
  try { res.json(await circuits.listerModeles(req.user.tenant_id)); } catch (err) { erreur(res, err, 'Chargement des circuits impossible'); }
};
exports.referentiel = async (req, res) => {
  try { res.json(await circuits.referentiel(req.user.tenant_id)); } catch (err) { erreur(res, err, 'Chargement du référentiel impossible'); }
};
exports.modele = async (req, res) => {
  try {
    const m = await circuits.chargerModele(req.user.tenant_id, req.params.id);
    if (!m) return res.status(404).json({ message: 'Circuit introuvable.' });
    res.json(m);
  } catch (err) { erreur(res, err, 'Chargement du circuit impossible'); }
};
exports.creerModele = async (req, res) => {
  try { res.status(201).json(await circuits.creerModele(req.user.tenant_id, req.body || {}, req.user)); } catch (err) { erreur(res, err, 'Création du circuit impossible'); }
};
exports.modifierModele = async (req, res) => {
  try { res.json(await circuits.modifierModele(req.user.tenant_id, req.params.id, req.body || {}, req.user)); } catch (err) { erreur(res, err, 'Modification du circuit impossible'); }
};
exports.supprimerModele = async (req, res) => {
  try { res.json(await circuits.supprimerModele(req.user.tenant_id, req.params.id)); } catch (err) { erreur(res, err, 'Suppression du circuit impossible'); }
};

// ------------------------------------------------------------- un document
exports.etatDocument = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req);
    if (refus) return repondreRefus(res, refus);
    res.json(await circuits.etatDocument(req.user.tenant_id, document.id, req.user));
  } catch (err) { erreur(res, err, 'Chargement du circuit du document impossible'); }
};
exports.demarrer = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req, { mode: 'write', corbeille: false });
    if (refus) return repondreRefus(res, refus);
    const instance = await circuits.demarrer(req.user.tenant_id, document.id, { circuitId: req.body?.circuit_id || null, user: req.user, ...ip(req) });
    res.status(201).json({ message: 'Circuit de validation démarré : le document est en validation.', instance });
  } catch (err) { erreur(res, err, 'Démarrage du circuit impossible'); }
};
exports.annuler = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req, { mode: 'write' });
    if (refus) return repondreRefus(res, refus);
    res.json(await circuits.annuler(req.user.tenant_id, document.id, req.body || {}, req.user, ip(req)));
  } catch (err) { erreur(res, err, 'Annulation du circuit impossible'); }
};
exports.relancer = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req, { mode: 'write', corbeille: false });
    if (refus) return repondreRefus(res, refus);
    res.json(await circuits.relancer(req.user.tenant_id, document.id, req.body || {}, req.user, ip(req)));
  } catch (err) { erreur(res, err, 'Reprise du circuit impossible'); }
};

// ------------------------------------------------------------------- tâches
exports.mesTaches = async (req, res) => {
  try { res.json(await circuits.mesTaches(req.user.tenant_id, req.user, { vue: req.query.vue })); } catch (err) { erreur(res, err, 'Chargement des tâches impossible'); }
};
exports.compte = async (req, res) => {
  try { res.json(await circuits.compteTaches(req.user.tenant_id, req.user.id)); } catch (err) { erreur(res, err, 'Comptage des tâches impossible'); }
};
exports.decider = async (req, res) => {
  try { res.json(await circuits.decider(req.user.tenant_id, req.params.id, req.body || {}, req.user, ip(req))); } catch (err) { erreur(res, err, 'Décision impossible'); }
};
exports.delegataires = async (req, res) => {
  try { res.json(await circuits.delegataires(req.user.tenant_id, req.params.id, req.user)); } catch (err) { erreur(res, err, 'Chargement des personnes impossible'); }
};
exports.deleguer = async (req, res) => {
  try { res.json(await circuits.deleguer(req.user.tenant_id, req.params.id, req.body || {}, req.user, ip(req))); } catch (err) { erreur(res, err, 'Délégation impossible'); }
};
exports.reassigner = async (req, res) => {
  try { res.json(await circuits.reassigner(req.user.tenant_id, req.params.id, req.body || {}, req.user, ip(req))); } catch (err) { erreur(res, err, 'Réassignation impossible'); }
};
exports.suivi = async (req, res) => {
  try { res.json(await circuits.suivi(req.user.tenant_id, req.user)); } catch (err) { erreur(res, err, 'Chargement du suivi impossible'); }
};
