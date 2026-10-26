// ============================================================================
// accesDocument — garde commune des routes qui portent sur UN document
// (/api/documents/:id/...) hors de documentController : le document existe
// dans l'organisation, et son dossier est dans le périmètre (ACL) de
// l'utilisateur. La permission RBAC, elle, est posée sur la route.
// ============================================================================
const db = require('../config/db');
const aclService = require('../services/aclService');

/**
 * @param {object} req requête authentifiée (req.params.id, req.user)
 * @param {object} [opts]
 * @param {'read'|'write'} [opts.mode='read']
 * @param {boolean} [opts.corbeille=true] accepter un document en corbeille
 * @returns {Promise<{document?: object, refus?: {statut: number, message: string, code?: string}}>}
 */
async function verifierAccesDocument(req, { mode = 'read', corbeille = true } = {}) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return { refus: { statut: 400, message: 'Identifiant de document invalide.' } };
  const { rows } = await db.query(
    `SELECT id, dossier_id, reference_mfile, statut, deleted_at, classe_id
       FROM documents WHERE id = $1 AND tenant_id = $2${corbeille ? '' : ' AND deleted_at IS NULL'}`,
    [id, req.user.tenant_id]
  );
  const document = rows[0];
  if (!document) return { refus: { statut: 404, message: 'Document introuvable.' } };
  const accorde = mode === 'write'
    ? await aclService.peutEcrire(req.user.tenant_id, req.user.id, document.dossier_id)
    : await aclService.peutLire(req.user.tenant_id, req.user.id, document.dossier_id);
  if (!accorde) {
    return {
      refus: {
        statut: 403,
        code: 'HORS_PERIMETRE',
        message: mode === 'write'
          ? "Ce document appartient à un dossier hors de votre périmètre d'écriture."
          : 'Ce document appartient à un dossier hors de votre périmètre.',
      },
    };
  }
  return { document };
}

const repondreRefus = (res, refus) => res.status(refus.statut).json({ message: refus.message, ...(refus.code ? { code: refus.code } : {}) });

module.exports = { verifierAccesDocument, repondreRefus };
