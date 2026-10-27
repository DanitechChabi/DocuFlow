// ============================================================================
// archivageController — archivage réglementaire (migration 032) : DUA et sort
// final des classes, vue « Sort final », décisions, bordereaux d'élimination
// (séparation des tâches) et procès-verbal. La logique, les gardes et le
// périmètre vivent dans archivageService ; ici, la traduction HTTP.
// ============================================================================
const archivage = require('../services/archivageService');
const versements = require('../services/versementService');
const horodatage = require('../services/horodatageService');
const formats = require('../services/formatService');
const aclService = require('../services/aclService');
const { verifierAccesDocument, repondreRefus } = require('../helpers/accesDocument');

const erreur = (res, err, message) => {
  if (err && err.status && err.status < 500) {
    return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error(`[archivage] ${message} :`, err);
  return res.status(500).json({ message });
};
const action = (fn, message, statut = 200) => async (req, res) => {
  try { res.status(statut).json(await fn(req)); } catch (err) { erreur(res, err, message); }
};
const t = (req) => req.user.tenant_id;

exports.definirDua = action((req) => archivage.definirDua(t(req), Number(req.params.id), req.body || {}, req.user), 'Enregistrement de la DUA impossible');
exports.sortFinal = action((req) => archivage.vueSortFinal(t(req), req.user, {
  horizon: req.query.horizon, classeId: req.query.classe_id || null, sort: req.query.sort || null, q: req.query.q || '', traites: req.query.traites === 'true',
}), 'Chargement du sort final impossible');
exports.decider = action((req) => archivage.decider(t(req), req.body?.document_ids, req.body || {}, req.user), 'Décision impossible');
exports.annulerDecision = action((req) => archivage.annulerDecision(t(req), Number(req.params.documentId), req.user), 'Annulation de la décision impossible');

exports.echeanceDocument = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req);
    if (refus) return repondreRefus(res, refus);
    res.json(await archivage.echeanceDocument(t(req), document.id));
  } catch (err) { erreur(res, err, "Chargement de l'échéance impossible"); }
};

exports.bordereaux = action((req) => archivage.listerBordereaux(t(req), { statut: req.query.statut || null }), 'Chargement des bordereaux impossible');
exports.bordereau = action((req) => archivage.detailBordereau(t(req), req.params.id, req.user), 'Chargement du bordereau impossible');
exports.creer = action((req) => archivage.creerBordereau(t(req), req.body || {}, req.user), 'Création du bordereau impossible', 201);
exports.modifier = action((req) => archivage.modifierBordereau(t(req), req.params.id, req.body || {}, req.user), 'Modification du bordereau impossible');
exports.ajouter = action((req) => archivage.ajouterDocuments(t(req), req.params.id, req.body?.document_ids || [], req.user), 'Ajout impossible');
exports.retirer = action((req) => archivage.retirerDocument(t(req), req.params.id, Number(req.params.documentId), req.user), 'Retrait impossible');
exports.proposer = action((req) => archivage.proposer(t(req), req.params.id, req.user), 'Proposition impossible');
exports.retirerProposition = action((req) => archivage.retirerProposition(t(req), req.params.id, req.user), 'Retrait de la proposition impossible');
exports.valider = action((req) => archivage.valider(t(req), req.params.id, req.user), 'Validation impossible');
exports.rejeter = action((req) => archivage.rejeter(t(req), req.params.id, req.user, req.body?.motif), 'Rejet impossible');
exports.reprendre = action((req) => archivage.reprendre(t(req), req.params.id, req.user), 'Reprise impossible');
exports.annuler = action((req) => archivage.annuler(t(req), req.params.id, req.body || {}, req.user), 'Annulation impossible');
exports.executer = action((req) => archivage.executer(t(req), req.params.id, req.user, req.body || {}), "Exécution de l'élimination impossible");
exports.transmettre = action((req) => archivage.transmettre(t(req), req.params.id, req.user), "Transmission à l'autorité d'archives impossible");
exports.visa = action((req) => archivage.enregistrerVisa(t(req), req.params.id, req.body || {}, req.user), 'Enregistrement du visa impossible');
exports.procesVerbal = action((req) => archivage.procesVerbal(t(req), req.params.id, req.user), 'Édition du procès-verbal impossible');

// ------------------------------------------- bordereaux de versement (036)
exports.versements = action((req) => versements.lister(t(req)), 'Chargement des versements impossible');
exports.versement = action((req) => versements.detail(t(req), req.params.id, req.user), 'Chargement du versement impossible');
exports.creerVersement = action((req) => versements.creer(t(req), req.body || {}, req.user), 'Création du bordereau de versement impossible', 201);
exports.ajouterVersement = action((req) => versements.ajouter(t(req), req.params.id, req.body?.document_ids || [], req.user), 'Ajout impossible');
exports.retirerVersement = action((req) => versements.retirer(t(req), req.params.id, Number(req.params.documentId), req.user), 'Retrait impossible');
exports.transmettreVersement = action((req) => versements.transmettre(t(req), req.params.id, req.user), 'Transmission du versement impossible');
exports.priseEnCharge = action((req) => versements.priseEnCharge(t(req), req.params.id, req.body || {}, req.user), 'Enregistrement de la prise en charge impossible');
exports.annulerVersement = action((req) => versements.annuler(t(req), req.params.id, req.body || {}, req.user), 'Annulation impossible');
exports.paquetVersement = async (req, res) => {
  try {
    const { versement, ids } = await versements.documentsExportables(t(req), req.params.id, req.user);
    if (!ids.length) return res.status(400).json({ message: 'Aucun document à exporter.' });
    await require('./rechercheController').envoyerPaquet(req, res, ids, 'toutes', `versement-${versement.numero}.zip`);
  } catch (err) {
    if (res.headersSent) { console.error('[versement] export interrompu :', err.message); res.destroy(err); } else erreur(res, err, 'Export du versement impossible');
  }
};

// ------------------------------------------------- horodatage RFC 3161 (037)
exports.horodatages = action((req) => horodatage.lister(t(req), { objetType: req.query.objet_type || null, objetId: req.query.objet_id || null }), 'Chargement des horodatages impossible');
exports.horodaterMaintenant = action((req) => horodatage.horodaterOrganisation(t(req)), 'Horodatage impossible');
exports.jetonHorodatage = async (req, res) => {
  try {
    const h = await horodatage.jeton(t(req), req.params.id);
    if (!h) return res.status(404).json({ message: 'Jeton introuvable.' });
    res.setHeader('Content-Type', 'application/timestamp-reply');
    res.setHeader('Content-Disposition', `attachment; filename="horodatage-${h.objet_type}-${h.objet_id}.tsr"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(h.jeton);
  } catch (err) { erreur(res, err, 'Téléchargement du jeton impossible'); }
};

// --------------------------------------------- formats de conservation (037)
exports.formats = action(async (req) => {
  const { lisibles } = await aclService.dossiersAccessibles(t(req), req.user.id);
  return formats.bilan(t(req), lisibles);
}, 'Chargement du bilan des formats impossible');
exports.copiePdfa = async (req, res) => {
  try {
    // Écriture dans le dossier exigée ; un document archivé reste éligible :
    // ajouter une copie de conservation ne modifie pas ce qui est archivé.
    const { document, refus } = await verifierAccesDocument(req, { mode: 'write', corbeille: false });
    if (refus) return repondreRefus(res, refus);
    res.status(201).json(await formats.copieConservation(t(req), document.id, req.params.fileId, req.user));
  } catch (err) { erreur(res, err, 'Copie de conservation impossible'); }
};

// ------------------------------------------- sauvegarde intégrée (bureau)
const sauvegarde = require('../services/sauvegardeService');
exports.sauvegarde = action(async () => sauvegarde.etat(), 'Lecture de la sauvegarde impossible');
exports.reglerSauvegarde = action(async (req) => sauvegarde.enregistrer(req.body || {}), 'Enregistrement des réglages de sauvegarde impossible');
exports.sauvegarder = action(async () => ({ sauvegarde: await sauvegarde.executer(), etat: sauvegarde.etat() }), 'Sauvegarde impossible');
