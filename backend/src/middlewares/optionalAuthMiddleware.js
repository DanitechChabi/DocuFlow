/**
 * optionalAuthMiddleware — Peuple req.user si un token valide est fourni,
 * mais ne bloque PAS la requête si le token est absent/invalide.
 *
 * Utilisé sur les routes publiques qui DOIVENT se comporter différemment
 * selon que l'appelant est connecté (ex : GET /api/sections → sections du
 * tenant connecté, ou tenant 1 par défaut pour le formulaire public).
 */
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      ...decoded,
      tenant_id: decoded.tenant_id || 1,
    };
  } catch (err) {
    // Token invalide → on ignore (route publique)
  }
  next();
};
