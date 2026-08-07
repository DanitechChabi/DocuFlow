/**
 * platformOwnerMiddleware — Restreint une route au SEUL propriétaire de la plateforme.
 *
 * Le propriétaire de la plateforme est le superadmin du tenant 1 (DocuFlow).
 * Les superadmins des autres entreprises (créées via register-company)
 * ne doivent JAMAIS avoir accès aux routes globales /api/superadmin/*.
 */
module.exports = (req, res, next) => {
  if (!req.user || req.user.role !== 'superadmin' || req.user.tenant_id !== 1) {
    return res.status(403).json({ message: 'Accès réservé au propriétaire de la plateforme' });
  }
  next();
};
