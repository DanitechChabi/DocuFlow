// ============================================================================
// conformiteController — API de la conformité, des fournisseurs et de
// l'analyse d'un document.
//
// Chaque réponse est bornée par le périmètre de l'utilisateur (ACL de
// dossier) : voir conformiteService.documentsVisibles.
// ============================================================================
const db = require('../config/db');
const aclService = require('../services/aclService');
const analyseService = require('../services/analyseService');
const conformiteService = require('../services/conformiteService');
const fournisseurService = require('../services/fournisseurService');
const llmService = require('../services/llmService');
const settingsService = require('../services/settingsService');
const { REFERENTIELS, referentiel, TYPES_ALERTE, SEVERITES } = require('../config/conformite');

const erreur500 = (res, err, message) => {
  console.error(`[conformite] ${message} :`, err);
  return res.status(500).json({ message });
};

exports.tableauDeBord = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const [chiffres, reglages, llm] = await Promise.all([
      conformiteService.tableauDeBord(tenantId, req.user),
      settingsService.getAll(tenantId),
      llmService.configuration(tenantId),
    ]);
    const ref = referentiel(reglages.conformite_pays);
    res.json({
      ...chiffres,
      configuration: {
        analyse_active: Boolean(reglages.conformite_active),
        referentiel: ref.code,
        referentiel_libelle: ref.libelle,
        tolerance_montant: Number(reglages.conformite_tolerance_montant),
        registre_officiel: Boolean(reglages.conformite_verifier_registre && ref.registre),
        modele: llm.pret ? `${llm.provider}/${llm.modele}` : null,
        modele_raison: llm.pret ? null : llm.raison,
      },
    });
  } catch (err) {
    erreur500(res, err, 'Chargement du tableau de bord impossible');
  }
};

exports.alertes = async (req, res) => {
  const { severite, type, statut } = req.query;
  if (severite && !SEVERITES.includes(severite)) return res.status(400).json({ message: `Sévérité inconnue : ${severite}.` });
  if (type && !TYPES_ALERTE[type]) return res.status(400).json({ message: `Type d'alerte inconnu : ${type}.` });
  if (statut && !['ouverte', 'traitee', 'ignoree', 'resolue', 'toutes'].includes(statut)) return res.status(400).json({ message: `Statut inconnu : ${statut}.` });
  try {
    res.json(await conformiteService.listerAlertes(req.user.tenant_id, req.user, { severite: severite || null, type: type || null, statut: statut || 'ouverte' }));
  } catch (err) {
    erreur500(res, err, 'Chargement des alertes impossible');
  }
};

exports.traiterAlerte = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Alerte invalide.' });
  try {
    const a = await conformiteService.changerStatut(req.user.tenant_id, id, req.user, { statut: req.body?.statut, note: req.body?.note });
    if (!a) return res.status(404).json({ message: 'Alerte introuvable.' });
    res.json(a);
  } catch (err) {
    if (err.statut) return res.status(err.statut).json({ message: err.message });
    erreur500(res, err, "Mise à jour de l'alerte impossible");
  }
};

/** Recalcule les contrôles ; avec `analyser: true`, relit d'abord tous les documents. */
exports.recalculer = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    if (req.body?.analyser) {
      const n = await analyseService.analyserTout(tenantId);
      return res.status(202).json({ message: `Analyse de ${n} document${n > 1 ? 's' : ''} lancée en arrière-plan.`, documents_en_file: n });
    }
    res.json({ message: 'Contrôles recalculés.', ...(await conformiteService.recalculer(tenantId)) });
  } catch (err) {
    erreur500(res, err, 'Recalcul impossible');
  }
};

exports.fournisseurs = async (req, res) => {
  try {
    const fiches = await fournisseurService.lister(req.user.tenant_id, req.user);
    if (req.query.format === 'csv') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="fournisseurs.csv"' });
      return res.send(fournisseurService.versCsv(fiches));
    }
    res.json(fiches);
  } catch (err) {
    erreur500(res, err, 'Chargement des fournisseurs impossible');
  }
};

exports.documentsFournisseur = async (req, res) => {
  const cle = String(req.params.cle || '');
  if (!cle || cle.length > 200) return res.status(400).json({ message: 'Fournisseur invalide.' });
  try {
    res.json(await fournisseurService.documentsDe(req.user.tenant_id, req.user, cle));
  } catch (err) {
    erreur500(res, err, 'Chargement des documents du fournisseur impossible');
  }
};

// ---------------------------------------------------------------------------
// Analyse d'un document
// ---------------------------------------------------------------------------

async function peutLire(req) {
  const { rows } = await db.query('SELECT dossier_id FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [req.params.id, req.user.tenant_id]);
  if (!rows[0]) return { statut: 404, message: 'Document introuvable.' };
  if (!(await aclService.peutLire(req.user.tenant_id, req.user.id, rows[0].dossier_id))) {
    return { statut: 403, message: 'Ce document appartient à un dossier hors de votre périmètre.', code: 'HORS_PERIMETRE' };
  }
  return null;
}

/** Analyse enregistrée du document et alertes ouvertes qui le concernent. */
exports.analyseDocument = async (req, res) => {
  try {
    const refus = await peutLire(req);
    if (refus) return res.status(refus.statut).json({ message: refus.message, code: refus.code });
    const tenantId = req.user.tenant_id;
    const [extraction, alertes] = await Promise.all([
      analyseService.extractionDe(tenantId, Number(req.params.id)),
      conformiteService.listerAlertes(tenantId, req.user, { statut: 'ouverte', documentId: Number(req.params.id) }),
    ]);
    res.json({ extraction, alertes });
  } catch (err) {
    erreur500(res, err, "Chargement de l'analyse impossible");
  }
};

/** Relit le document maintenant (règles + modèle), puis recalcule les contrôles. */
exports.relancerAnalyse = async (req, res) => {
  try {
    const refus = await peutLire(req);
    if (refus) return res.status(refus.statut).json({ message: refus.message, code: refus.code });
    const tenantId = req.user.tenant_id;
    const extraction = await analyseService.analyserDocument(tenantId, Number(req.params.id), { recalculer: false });
    if (!extraction) {
      return res.status(409).json({ message: 'Ce document n\'a pas encore de texte lisible (une lecture OCR est peut-être en cours).' });
    }
    await conformiteService.recalculer(tenantId);
    const alertes = await conformiteService.listerAlertes(tenantId, req.user, { statut: 'ouverte', documentId: Number(req.params.id) });
    res.json({ extraction, alertes });
  } catch (err) {
    erreur500(res, err, "Analyse du document impossible");
  }
};

/** Liste des référentiels et types, pour les écrans de configuration. */
exports.referentiels = (req, res) => {
  res.json({ referentiels: Object.values(REFERENTIELS).map((r) => ({ code: r.code, libelle: r.libelle })), types_alerte: TYPES_ALERTE, severites: SEVERITES });
};
