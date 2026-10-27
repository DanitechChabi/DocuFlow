// ============================================================================
// physiqueController — archives papier (migration 038) : emplacements et
// cotes, localisation des documents, récolement. La logique vit dans
// physiqueService ; ici, la traduction HTTP.
// ============================================================================
const physique = require('../services/physiqueService');
const { verifierAccesDocument, repondreRefus } = require('../helpers/accesDocument');

const erreur = (res, err, message) => {
  if (err && err.status && err.status < 500) {
    return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error(`[physique] ${message} :`, err);
  return res.status(500).json({ message });
};
const action = (fn, message, statut = 200) => async (req, res) => {
  try { res.status(statut).json(await fn(req)); } catch (err) { erreur(res, err, message); }
};
const t = (req) => req.user.tenant_id;

exports.emplacements = action((req) => physique.lister(t(req)), 'Chargement des emplacements impossible');
exports.creerEmplacement = action((req) => physique.creer(t(req), req.body || {}, req.user), "Création de l'emplacement impossible", 201);
exports.modifierEmplacement = action((req) => physique.modifier(t(req), req.params.id, req.body || {}, req.user), "Modification de l'emplacement impossible");
exports.supprimerEmplacement = action((req) => physique.supprimer(t(req), req.params.id, req.user), "Suppression de l'emplacement impossible");
exports.contenu = action((req) => physique.contenu(t(req), req.params.id, req.user), 'Chargement du contenu impossible');

exports.localisation = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req);
    if (refus) return repondreRefus(res, refus);
    res.json(await physique.localisation(t(req), document.id));
  } catch (err) { erreur(res, err, 'Chargement de la localisation impossible'); }
};
exports.placer = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req, { mode: 'write', corbeille: false });
    if (refus) return repondreRefus(res, refus);
    res.json(await physique.placer(t(req), document.id, req.body || {}, req.user));
  } catch (err) { erreur(res, err, 'Rangement impossible'); }
};

exports.recolements = action((req) => physique.listerRecolements(t(req)), 'Chargement des récolements impossible');
exports.ouvrirRecolement = action((req) => physique.ouvrirRecolement(t(req), req.body || {}, req.user), 'Ouverture du récolement impossible', 201);
exports.recolement = action((req) => physique.detailRecolement(t(req), req.params.id), 'Chargement du récolement impossible');
exports.constater = action((req) => physique.constater(t(req), req.params.id, req.body?.constats || [], req.user), 'Constat impossible');
exports.clore = action((req) => physique.clore(t(req), req.params.id, req.body || {}, req.user), 'Clôture impossible');
exports.pvRecolement = action((req) => physique.procesVerbal(t(req), req.params.id), 'Édition du procès-verbal impossible');
