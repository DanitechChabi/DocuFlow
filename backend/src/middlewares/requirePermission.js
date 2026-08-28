// ============================================================================
// requirePermission — garde d'API fondée sur les permissions (RBAC).
//
// roleMiddleware comparait des chaînes de rôle (« admin », « archiviste ») :
// impossible de créer un rôle personnalisé, et chaque nouvelle route
// réinventait sa liste. requirePermission demande ce que la route PROTEGE
// (« documents.delete »), et le rôle de l'appelant — quel qu'il soit — dit
// s'il le détient.
//
//   router.delete('/:id', requirePermission('documents.delete'), ctrl)
//
// La sécurité est ici, côté serveur : le frontend masque des actions, il ne
// les interdit pas. Les refus (403) sont tracés dans le journal d'audit par
// auditMiddleware.
//
// FAIL-CLOSED : rôle inconnu, désactivé ou base injoignable → refus (voir
// roleService.possede).
// ============================================================================
const roleService = require('../services/roleService');

/**
 * Exige UNE permission.
 * @param {string} permission clé du catalogue (config/permissions.js).
 */
function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Authentification requise.' });
    }
    try {
      const accorde = await roleService.possede(req.user.tenant_id, req.user.role, permission);
      if (!accorde) {
        return res.status(403).json({
          message: 'Vous n\'avez pas la permission requise pour cette action.',
          code: 'PERMISSION_REFUSEE',
          permission,
        });
      }
      return next();
    } catch (err) {
      // Le fail-close est dans roleService : ici, l'exception est un défaut de
      // NOTRE code, pas une fraude — on refuse quand même (c'est une garde)
      // mais on le distingue dans les journaux.
      console.error('[permissions] Garde en échec — accès refusé :', err.message);
      return res.status(403).json({ message: 'Accès refusé.', code: 'PERMISSION_REFUSEE' });
    }
  };
}

/**
 * Exige L'UNE des permissions listées (lecture OU écriture, par exemple).
 * @param {string[]} permissions
 */
function requireAnyPermission(permissions) {
  return async (req, res, next) => {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Authentification requise.' });
    }
    try {
      for (const permission of permissions) {
        if (await roleService.possede(req.user.tenant_id, req.user.role, permission)) {
          return next();
        }
      }
      return res.status(403).json({
        message: 'Vous n\'avez pas la permission requise pour cette action.',
        code: 'PERMISSION_REFUSEE',
        permission: permissions.join(' | '),
      });
    } catch (err) {
      console.error('[permissions] Garde en échec — accès refusé :', err.message);
      return res.status(403).json({ message: 'Accès refusé.', code: 'PERMISSION_REFUSEE' });
    }
  };
}

module.exports = { requirePermission, requireAnyPermission };
