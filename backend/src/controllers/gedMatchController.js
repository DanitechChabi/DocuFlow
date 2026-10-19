// ============================================================================
// gedMatchController — recherche automatique dans la GED pour les demandes.
// Logique : services/gedMatchService (correspondance), gedDeliveryService
// (transmission). Ici, la traduction HTTP et la double garde GED : traiter
// des demandes (route) ET consulter les documents (ci-dessous).
// ============================================================================
const tenantDb = require('../config/db-tenant');
const roleService = require('../services/roleService');
const gedMatch = require('../services/gedMatchService');
const gedDelivery = require('../services/gedDeliveryService');

const CHAMPS = ['description', 'nom_entreprise', 'num_dossier', 'num_acte', 'annee', 'type_document'];

/** Seul un rôle qui consulte la GED en voit le contenu (règle archiviste). */
async function accesGed(req) {
  return roleService.possede(req.user.tenant_id, req.user.role, 'documents.view');
}

/**
 * Pendant la saisie d'une demande : un document correspondant existe-t-il
 * probablement ? Rien d'autre — ni référence ni titre (voir gedMatchService).
 */
exports.precheck = async (req, res) => {
  try {
    const source = Object.fromEntries(CHAMPS.map((k) => [k, req.query[k]]));
    res.json(await gedMatch.indicateurPour(req.user.tenant_id, req.user, source));
  } catch (err) {
    // Indication de confort : jamais d'erreur visible pour le demandeur.
    if (!['42703', '42P01', '42883'].includes(err.code)) console.error('[ged-match] precheck :', err.message);
    res.json({ probable: false });
  }
};

/** Candidats pour une demande, dans les dossiers que l'appelant peut lire. */
exports.candidats = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    if (!(await accesGed(req))) {
      return res.status(403).json({ message: 'La consultation de la GED n\'est pas ouverte à votre rôle.', code: 'PERMISSION_REFUSEE' });
    }
    const r = await tenantDb.query(tenantId, 'SELECT * FROM requests WHERE id = $1', [req.params.id]);
    const request = r.rows[0];
    if (!request) return res.status(404).json({ message: 'Demande non trouvée' });
    const candidats = await gedMatch.candidatsPour(tenantId, req.user, request);
    // Le badge des listes suit la dernière recherche (documents versés depuis).
    gedMatch.noterDemande(tenantId, request).catch(() => {});
    res.json({ candidats, seuilProbable: gedMatch.SEUIL_PROBABLE });
  } catch (err) {
    if (['42703', '42P01', '42883'].includes(err.code)) {
      return res.status(503).json({ message: 'La recherche automatique n\'est pas encore disponible (migration 027 à appliquer).', code: 'MIGRATION_027_REQUISE' });
    }
    console.error('[ged-match] candidats :', err);
    res.status(500).json({ message: 'Erreur lors de la recherche dans la GED' });
  }
};

/** Transmettre un document de la GED en réponse à la demande. */
exports.transmettre = async (req, res) => {
  try {
    if (!(await accesGed(req))) {
      return res.status(403).json({ message: 'La consultation de la GED n\'est pas ouverte à votre rôle.', code: 'PERMISSION_REFUSEE' });
    }
    const out = await gedDelivery.transmettre(req.user.tenant_id, Number(req.params.id), req.user, Number(req.body?.document_id));
    res.json({ message: 'Document transmis — la demande est livrée et le demandeur prévenu.', ...out });
  } catch (err) {
    if (err.statut) return res.status(err.statut).json({ message: err.message, ...(typeof err.code === 'string' && !/^\d/.test(err.code) ? { code: err.code } : {}) });
    console.error('[ged-livraison] :', err);
    res.status(500).json({ message: 'Erreur lors de la transmission du document' });
  }
};
