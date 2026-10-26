// ============================================================================
// collaborationController — favoris, suivi, commentaires, liens de partage
// (gestion) et restauration de version (migration 033). Routes authentifiées :
// voir routes/collaborationRoutes.js ; les routes PUBLIQUES des liens sont
// dans partageController.
//
// Chaque route portant sur UN document vérifie l'organisation et le périmètre
// (verifierAccesDocument, lecture) ; un document en corbeille n'a plus de vie
// collaborative (comme sa fiche, il ne se consulte que depuis la corbeille).
// ============================================================================
const collaboration = require('../services/collaborationService');
const partageService = require('../services/partageService');
const versionService = require('../services/versionService');
const { verifierAccesDocument, repondreRefus } = require('../helpers/accesDocument');

const erreur = (res, err, message) => {
  if (err && err.status && err.status < 500) {
    return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error(`[collaboration] ${message} :`, err);
  return res.status(500).json({ message });
};

/** Garde commune : document lisible, hors corbeille. */
const documentLisible = (req) => verifierAccesDocument(req, { mode: 'read', corbeille: false });

/** Fabrique un gestionnaire « un document » : garde, puis action. */
const surDocument = (action, message) => async (req, res) => {
  try {
    const { document, refus } = await documentLisible(req);
    if (refus) return repondreRefus(res, refus);
    await action(req, res, document);
  } catch (err) {
    erreur(res, err, message);
  }
};

// ------------------------------------------------------------ état de la fiche

exports.etat = surDocument(async (req, res, document) => {
  res.json(await collaboration.etatDocument(req.user.tenant_id, req.user.id, document.id));
}, 'Chargement de la collaboration impossible');

// ------------------------------------------------------------------ favoris

exports.ajouterFavori = surDocument(async (req, res, document) => {
  res.json(await collaboration.ajouterFavori(req.user.tenant_id, req.user.id, document.id));
}, 'Ajout aux favoris impossible');

exports.retirerFavori = surDocument(async (req, res, document) => {
  res.json(await collaboration.retirerFavori(req.user.tenant_id, req.user.id, document.id));
}, 'Retrait des favoris impossible');

exports.favoris = async (req, res) => {
  try {
    if (req.query.format === 'ids') return res.json(await collaboration.idsFavoris(req.user.tenant_id, req.user.id));
    res.json(await collaboration.listerDocumentsPersonnels(req.user.tenant_id, req.user.id, 'favoris'));
  } catch (err) {
    erreur(res, err, 'Chargement des favoris impossible');
  }
};

exports.suivis = async (req, res) => {
  try {
    res.json(await collaboration.listerDocumentsPersonnels(req.user.tenant_id, req.user.id, 'suivis'));
  } catch (err) {
    erreur(res, err, 'Chargement des documents suivis impossible');
  }
};

// -------------------------------------------------------------------- suivi

exports.suivre = surDocument(async (req, res, document) => {
  res.json(await collaboration.suivre(req.user.tenant_id, req.user.id, document.id, { origine: 'manuel' }));
}, 'Suivi du document impossible');

exports.nePlusSuivre = surDocument(async (req, res, document) => {
  res.json(await collaboration.nePlusSuivre(req.user.tenant_id, req.user.id, document.id));
}, 'Arrêt du suivi impossible');

// -------------------------------------------------------------- commentaires

exports.commentaires = surDocument(async (req, res, document) => {
  res.json(await collaboration.listerCommentaires(req.user.tenant_id, document.id, req.user));
}, 'Chargement des commentaires impossible');

exports.mentionnables = surDocument(async (req, res, document) => {
  const tous = await collaboration.mentionnables(req.user.tenant_id, document, { exclureUserId: req.user.id });
  const q = String(req.query.q || '').trim().toLowerCase();
  res.json(q ? tous.filter((u) => u.username.toLowerCase().includes(q) || u.nom.toLowerCase().includes(q)) : tous);
}, 'Chargement des personnes mentionnables impossible');

exports.commenter = surDocument(async (req, res, document) => {
  const commentaire = await collaboration.creerCommentaire(req.user.tenant_id, document, req.user, req.body || {});
  res.status(201).json(commentaire);
}, 'Publication du commentaire impossible');

exports.modifierCommentaire = surDocument(async (req, res, document) => {
  res.json(await collaboration.modifierCommentaire(req.user.tenant_id, document, req.user, req.params.commentaireId, req.body || {}));
}, 'Modification du commentaire impossible');

exports.supprimerCommentaire = surDocument(async (req, res, document) => {
  res.json(await collaboration.supprimerCommentaire(req.user.tenant_id, document, req.user, req.params.commentaireId));
}, 'Suppression du commentaire impossible');

// ------------------------------------------------------- liens de partage

exports.partages = surDocument(async (req, res, document) => {
  res.json({
    partages: await partageService.listerPartages(req.user.tenant_id, document.id),
    reglages: await partageService.reglages(req.user.tenant_id),
  });
}, 'Chargement des liens de partage impossible');

exports.creerPartage = surDocument(async (req, res, document) => {
  res.status(201).json(await partageService.creerPartage(req.user.tenant_id, document.id, req.user, req.body || {}, { ip: req.ip }));
}, 'Création du lien de partage impossible');

exports.revoquerPartage = surDocument(async (req, res, document) => {
  const partage = await partageService.revoquerPartage(req.user.tenant_id, document.id, req.params.partageId, req.user, { ip: req.ip });
  res.json({ message: 'Lien révoqué : il ne donne plus accès au document.', partage });
}, 'Révocation du lien impossible');

// ---------------------------------------------------- restauration de version

exports.restaurerVersion = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    // Garde d'écriture de la GED : corbeille, archivé (lecture seule), verrou
    // d'autrui, périmètre d'écriture — la même que pour ajouter une version.
    // Périmètre d'écriture (ACL du dossier) avant la garde de cycle de vie.
    const { refus } = await verifierAccesDocument(req, { mode: 'write', corbeille: false });
    if (refus) return repondreRefus(res, refus);
    const { chargerPourEcriture } = require('./documentController');
    const verrou = await chargerPourEcriture(tenantId, req.params.id, req.user);
    if (verrou) return res.status(verrou.statut).json({ message: verrou.message, code: verrou.code });
    const resultat = await versionService.restaurerVersion(tenantId, Number(req.params.id), req.params.fileId, req.user, { ip: req.ip });
    res.status(201).json({
      message: `Version ${resultat.version_source} restaurée : elle devient la version ${resultat.version}.`,
      ...resultat,
    });
    await collaboration.signaler(tenantId, Number(req.params.id), 'version_restauree', {
      acteur: req.user, source: resultat.version_source, nouvelle: resultat.version,
    });
  } catch (err) {
    if (!res.headersSent) erreur(res, err, 'Restauration de la version impossible');
  }
};
