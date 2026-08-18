const auditService = require('../services/auditService');

/**
 * auditController — Gère les requêtes liées aux logs d'audit.
 */

exports.getAuditLogs = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { userId, action, limit, offset } = req.query;

  try {
    const logs = await auditService.getLogs(
      tenantId,
      { userId, action },
      { limit, offset }
    );
    res.json(logs);
  } catch (err) {
    console.error('[auditController] Erreur:', err);
    res.status(500).json({ message: 'Erreur lors de la récupération des logs d\'audit' });
  }
};
