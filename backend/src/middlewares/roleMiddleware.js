const roleMiddleware = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ message: 'Accès refusé : utilisateur non identifié' });
    }

    console.log(`Role check: user=${req.user?.username}, role=${req.user?.role}, allowed=${allowedRoles}`);
    if (req.user.role !== 'superadmin' && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Accès refusé : vous n'avez pas les permissions nécessaires. Rôle requis : ${allowedRoles.join(' ou ')}`
      });
    }

    next();
  };
};

module.exports = roleMiddleware;
