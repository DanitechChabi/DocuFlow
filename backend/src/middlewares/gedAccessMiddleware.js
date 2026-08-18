/**
 * gedAccessMiddleware — accès à la GED selon le réglage `ged_access_role`.
 *
 * Les routes de la GED figeaient les rôles autorisés dans le code. Le réglage
 * « Rôle d'accès à la GED » de la console de configuration était donc sans
 * effet : le superadministrateur pouvait choisir « Tous les utilisateurs » sans
 * que cela change quoi que ce soit.
 *
 * Règles conservées :
 *   - `superadmin` a toujours accès (cohérent avec roleMiddleware) ;
 *   - par défaut, seul `archiviste` accède à la GED — le réglage élargit ce
 *     périmètre, il ne le restreint jamais en dessous du défaut ;
 *   - en cas d'indisponibilité de la base, on retombe sur le comportement le
 *     plus strict (archiviste seul) plutôt que d'ouvrir l'accès.
 */
const settingsService = require('../services/settingsService');

/**
 * @param {string[]} [extraRoles] rôles toujours autorisés, quel que soit le
 *        réglage (ex. ['admin'] pour l'administration du schéma de métadonnées).
 */
function gedAccessMiddleware(extraRoles = []) {
  return async (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ message: 'Accès refusé : utilisateur non identifié' });
    }
    if (req.user.role === 'superadmin') return next();

    let allowed;
    try {
      allowed = await settingsService.getGedRoles(req.user.tenant_id);
    } catch {
      allowed = ['archiviste'];
    }

    if (allowed.includes(req.user.role) || extraRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      message: `Accès refusé : la gestion documentaire est réservée aux rôles ${[...new Set([...allowed, ...extraRoles])].join(', ')}.`,
    });
  };
}

module.exports = gedAccessMiddleware;
