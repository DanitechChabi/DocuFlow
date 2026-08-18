const auditService = require('../services/auditService');

/**
 * auditMiddleware — Logs every API request to the audit_logs table.
 * It captures the actor, action, object, and details of each request.
 *
 * This middleware is designed to be used globally. It uses the 'finish' event
 * of the response to ensure that the user has been identified by subsequent
 * auth middlewares and the response status is known.
 */
module.exports = (req, res, next) => {
  const { method, originalUrl, ip } = req;
  const startTime = Date.now();

  // We use the 'finish' event to log the request after it has been processed.
  // This allows us to capture the response status and the user identified by authMiddleware.
  res.on('finish', async () => {
    const duration = Date.now() - startTime;
    const status = res.statusCode;
    const user = req.user;

    // The audit_logs table requires a tenant_id (NOT NULL).
    // If the user is not authenticated (e.g., login request), we cannot attribute the log to a tenant.
    if (!user || !user.tenant_id) {
      return;
    }

    const tenantId = user.tenant_id;
    const userId = user.id;
    // Since username is not in the JWT, we use the ID or 'Unknown'
    const userName = user.username || `User ${userId}`;

    // Heuristic to identify the 'object' of the action.
    // We look for numeric IDs in the URL path.
    const pathSegments = originalUrl.split('/');
    const objectId = pathSegments.find(segment => /^\d+$/.test(segment));

    // Determine if the object is a 'request' based on the URL path.
    const requestId = (objectId && originalUrl.includes('/api/requests'))
      ? parseInt(objectId, 10)
      : null;

    // Format the action and details into the action column.
    // actor: derived from user.id / user.tenant_id
    // action: HTTP method and path
    // object: request_id (if applicable)
    // details: response status and processing time
    const actionSummary = `${method} ${originalUrl}`;
    const detailsSummary = `Status: ${status} | Duration: ${duration}ms`;

    const auditAction = `Action: ${actionSummary} | Details: ${detailsSummary}`;

    try {
      await auditService.logAction({
        tenantId,
        userId,
        requestId,
        action: auditAction,
        ipAddress: ip,
        userName: userName,
      });
    } catch (err) {
      console.error('[auditMiddleware] Error writing to audit log:', err.message);
    }
  });

  next();
};
