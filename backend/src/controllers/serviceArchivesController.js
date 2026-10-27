// ============================================================================
// serviceArchivesController — copies certifiées conformes (039) et rapport
// annuel (décret n° 2007-532, art. 31 et 36). La logique vit dans
// copieCertifieeService et rapportAnnuelService ; ici, la traduction HTTP.
// ============================================================================
const copies = require('../services/copieCertifieeService');
const rapports = require('../services/rapportAnnuelService');
const { verifierAccesDocument, repondreRefus } = require('../helpers/accesDocument');

const erreur = (res, err, message) => {
  if (err && err.status && err.status < 500) {
    return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error(`[service d'archives] ${message} :`, err);
  return res.status(500).json({ message });
};
const action = (fn, message, statut = 200) => async (req, res) => {
  try { res.status(statut).json(await fn(req)); } catch (err) { erreur(res, err, message); }
};
const t = (req) => req.user.tenant_id;

exports.delivrerCopie = action(async (req) => (await copies.delivrer(t(req), req.params.id, req.body || {}, req.user)).copie,
  'Délivrance de la copie certifiée impossible', 201);
exports.copiesDocument = async (req, res) => {
  try {
    const { refus } = await verifierAccesDocument(req);
    if (refus) return repondreRefus(res, refus);
    return res.json(await copies.lister(t(req), { document_id: req.params.id }));
  } catch (err) { return erreur(res, err, 'Lecture des copies impossible'); }
};
exports.registreCopies = action((req) => copies.lister(t(req), { annee: req.query.annee }), 'Lecture du registre impossible');
exports.verifierCopie = action((req) => copies.verifier(t(req), req.params.numero, req.query.empreinte), 'Vérification impossible');

exports.exemplaireCopie = async (req, res) => {
  try {
    const c = await copies.exemplaire(t(req), req.params.numero);
    if (!c) return res.status(404).json({ message: 'Copie introuvable au registre.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${c.numero}.pdf"`);
    return res.send(c.pdf);
  } catch (err) { return erreur(res, err, 'Lecture de la copie impossible'); }
};

exports.rapportAnnuel = action((req) => rapports.rapport(t(req), req.params.annee), 'Calcul du rapport annuel impossible');
