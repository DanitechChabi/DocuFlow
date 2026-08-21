const db = require('../config/db');

/**
 * documentAuditService — Journal d'audit append-only pour les actions documentaires
 * (conformité GoBD / NF Z42-013).
 *
 * Écrit dans `audit_logs` (docs/migrations/010_metadata_typed.sql), protégée par le
 * trigger `prevent_audit_modification()` : aucun UPDATE/DELETE n'est possible.
 * Colonnes : tenant_id, actor_id, actor_username, action, object_type, object_id,
 *            details_json, ip_address, occurred_at
 */
const documentAuditService = {
  /**
   * Journalise une action sur un document.
   * L'audit ne doit jamais faire échouer l'action métier : les erreurs sont loguées
   * puis avalées (le journal reste néanmoins append-only et inaltérable).
   */
  async logAction({ tenantId, documentId, userId = null, username = null, action, details = {}, ipAddress = null }) {
    try {
      const result = await db.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json, ip_address)
         VALUES ($1, $2, $3, $4, 'document', $5, $6, $7)
         RETURNING *`,
        [tenantId, userId, username, action, documentId, JSON.stringify(details || {}), ipAddress]
      );
      return result.rows[0];
    } catch (err) {
      console.error('[audit] Échec de journalisation:', err.message);
      return null;
    }
  },

  /**
   * Historique d'audit d'un document, avec le nom courant de l'acteur si disponible.
   */
  async getAuditForDocument(tenantId, documentId) {
    const result = await db.query(
      `SELECT a.id, a.action, a.details_json, a.occurred_at, a.ip_address,
              a.actor_id, COALESCE(u.full_name, a.actor_username) AS actor_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id AND u.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1 AND a.object_type = 'document' AND a.object_id = $2
       ORDER BY a.occurred_at DESC`,
      [tenantId, documentId]
    );
    return result.rows;
  }
};

module.exports = documentAuditService;
