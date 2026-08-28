const jwt = require('jsonwebtoken');
require('dotenv').config({ path: './.env' });

const roleService = require('../services/roleService');

// Consulte la base pour rafraîchir rôle et version de jeton ? C'est ce qui
// rend un changement de rôle effectif en ≤30 s (cache de roleService) au lieu
// d'attendre l'expiration du jeton — jusqu'à 365 jours au réglage maximum.
// Le coût est une lecture par utilisateur et par fenêtre de 30 s, mise en
// cache : négligeable devant le gain de sécurité. En cas d'indisponibilité de
// la base au moment du rafraîchissement, on continue avec les revendications
// du jeton : une panne de lecture ne doit pas déconnecter l'organisation
// entière — les contrôleurs échoueront de toute façon sur leurs propres
// requêtes si la base est vraiment indisponible.
const RAFRAICHIR_DEPUIS_LA_BASE = true;

module.exports = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ message: 'Accès refusé. Token manquant.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const tenantId = decoded.tenant_id || 1; // Fallback DocuFlow si pas encore migré

    // Rafraîchissement depuis la base : applique les changements de rôle à
    // chaud et rejette les jetons invalidés (token_version incrémenté lors
    // d'un changement de rôle ou de permissions).
    let role = decoded.role;
    if (RAFRAICHIR_DEPUIS_LA_BASE) {
      try {
        const actuel = await roleService.getUserAuth(decoded.id);
        if (actuel === null) {
          // Le compte a été supprimé : le jeton ne doit plus rien ouvrir.
          return res.status(401).json({ message: 'Session invalide.', code: 'SESSION_INVALIDEE' });
        }
        if (decoded.tv !== undefined && decoded.tv !== actuel.token_version) {
          // Rôle ou permissions changés après l'émission : reconnexion exigée.
          return res.status(401).json({ message: 'Vos droits ont changé, reconnectez-vous.', code: 'SESSION_INVALIDEE' });
        }
        role = actuel.role;
      } catch (err) {
        console.warn('[auth] Rôle non rafraîchi, jeton fait foi :', err.message);
      }
    }

    req.user = {
      ...decoded,
      role,
      tenant_id: tenantId,
    };
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Token invalide ou expiré.' });
  }
};
