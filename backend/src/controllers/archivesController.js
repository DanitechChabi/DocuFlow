// ============================================================================
// archivesController — preuve et intégrité (migration 031) : volet d'un
// document (empreintes, contrôle, gel, certificat) et onglets de la page
// Archivage (rapport, anomalies, doublons, journal chaîné, sceaux, gels).
// ============================================================================
const db = require('../config/db');
const integrite = require('../services/integriteService');
const auditService = require('../services/auditService');
const { verifierAccesDocument, repondreRefus } = require('../helpers/accesDocument');

const erreur = (res, err, message) => {
  if (err && err.status && err.status < 500) {
    return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error(`[archives] ${message} :`, err);
  return res.status(500).json({ message });
};

// ------------------------------------------------------------- un document

exports.etatDocument = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req);
    if (refus) return repondreRefus(res, refus);
    res.json(await integrite.etatDocument(req.user.tenant_id, document.id, req.user));
  } catch (err) {
    erreur(res, err, "Chargement de l'intégrité du document impossible");
  }
};

exports.verifierDocument = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req);
    if (refus) return repondreRefus(res, refus);
    const resultats = await integrite.verifierDocument(req.user.tenant_id, document.id, { acteur: req.user });
    res.json({ resultats, verifie_at: new Date().toISOString() });
  } catch (err) {
    erreur(res, err, 'Vérification du document impossible');
  }
};

exports.certificat = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req);
    if (refus) return repondreRefus(res, refus);
    const cert = await integrite.certificat(req.user.tenant_id, document.id, req.user);
    if (!cert) return res.status(404).json({ message: 'Document introuvable.' });
    res.json(cert);
  } catch (err) {
    erreur(res, err, 'Émission du certificat impossible');
  }
};

exports.poserGel = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req);
    if (refus) return repondreRefus(res, refus);
    const gel = await integrite.poserGel(req.user.tenant_id, document.id, req.body || {}, req.user);
    res.status(201).json({ message: 'Gel juridique posé : le document ne peut plus être détruit.', gel });
  } catch (err) {
    erreur(res, err, 'Pose du gel impossible');
  }
};

exports.leverGel = async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req);
    if (refus) return repondreRefus(res, refus);
    const gel = await integrite.leverGel(req.user.tenant_id, document.id, req.body || {}, req.user);
    res.json({ message: 'Gel juridique levé.', gel });
  } catch (err) {
    erreur(res, err, 'Levée du gel impossible');
  }
};

// ------------------------------------------------------------ page Archivage

exports.rapport = async (req, res) => {
  try {
    res.json(await integrite.rapport(req.user.tenant_id));
  } catch (err) {
    erreur(res, err, "Chargement du rapport d'intégrité impossible");
  }
};

exports.anomalies = async (req, res) => {
  try {
    res.json(await integrite.anomalies(req.user.tenant_id, req.user));
  } catch (err) {
    erreur(res, err, 'Chargement des anomalies impossible');
  }
};

exports.doublons = async (req, res) => {
  try {
    res.json(await integrite.groupesDoublons(req.user.tenant_id, req.user));
  } catch (err) {
    erreur(res, err, 'Chargement des doublons impossible');
  }
};

/** Contrôle immédiat d'un lot de fichiers de l'organisation (les plus anciens contrôles d'abord). */
exports.verifierLot = async (req, res) => {
  const lot = Math.min(Math.max(Number(req.body?.lot) || 25, 1), 100);
  try {
    const resultats = await integrite.verifierLot({ lot, tenantId: req.user.tenant_id, acteur: req.user });
    const compte = (s) => resultats.filter((r) => r.statut === s).length;
    res.json({
      verifies: resultats.length, intactes: compte('intacte'), alterees: compte('alteree'), introuvables: compte('introuvable'),
      resultats: resultats.filter((r) => r.statut !== 'intacte'),
    });
  } catch (err) {
    erreur(res, err, 'Contrôle des fichiers impossible');
  }
};

exports.verifierJournal = async (req, res) => {
  try {
    res.json(await integrite.verifierJournal(req.user.tenant_id));
  } catch (err) {
    erreur(res, err, 'Vérification du journal impossible');
  }
};

exports.sceaux = async (req, res) => {
  try {
    const sceaux = await integrite.listerSceaux(req.user.tenant_id);
    if (req.query.format === 'csv') {
      const nom = `sceaux-journal-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
      const t = await db.query('SELECT name FROM tenants WHERE id = $1', [req.user.tenant_id]);
      return res.send(integrite.sceauxEnCsv(sceaux, t.rows[0]?.name || `organisation ${req.user.tenant_id}`));
    }
    res.json(sceaux);
  } catch (err) {
    erreur(res, err, 'Chargement des sceaux impossible');
  }
};

exports.sceller = async (req, res) => {
  try {
    const sceau = await integrite.sceller(req.user.tenant_id, { user: req.user, origine: 'manuel' });
    if (sceau.nouveau) {
      const qui = await integrite.identite(req.user);
      await auditService.logAction({
        tenantId: req.user.tenant_id, userId: req.user.id, userName: qui.username, ipAddress: req.ip,
        action: `Journal scellé au rang ${sceau.rang} (empreinte ${sceau.hash.slice(0, 16)}…)`,
      });
    }
    res.status(sceau.nouveau ? 201 : 200).json(sceau);
  } catch (err) {
    erreur(res, err, 'Scellement du journal impossible');
  }
};

exports.gels = async (req, res) => {
  try {
    res.json(await integrite.listerGels(req.user.tenant_id, req.user, { actifs: req.query.statut !== 'tous' }));
  } catch (err) {
    erreur(res, err, 'Chargement des gels impossible');
  }
};

exports.verifierCertificat = async (req, res) => {
  try {
    res.json(await integrite.verifierCertificat(req.user.tenant_id, req.params.numero, req.query.empreinte));
  } catch (err) {
    erreur(res, err, 'Vérification du certificat impossible');
  }
};
