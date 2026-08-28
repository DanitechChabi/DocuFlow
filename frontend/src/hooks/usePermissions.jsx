import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { authService } from '../services/authService';

// ============================================================================
// PermissionsContext — ce que l'utilisateur courant PEUT FAIRE.
//
// Le RBAC s'applique côté serveur (requirePermission) ; l'interface n'a jamais
// besoin de le répliquer, seulement de NE PAS AFFICHER ce que l'API refuserait
// (un bouton qui rend un 403 est un défaut d'interface, pas une sécurité).
// La source : GET /api/auth/me, qui renvoie le rôle EFFECTIF du compte —
// rôles personnalisés compris, changements appliqués en ≤30 s (cache serveur).
//
// SUR LE WEB SANS SESSION : permissif par défaut (rien à masquer hors connexion)
// — c'est ProtectedRoute qui garde les routes.
// ============================================================================

const ETAT_DEFAUT = {
  charge: false,
  role: null,        // { key, name, description, is_system, permissions }
  can: () => true,   // permissif pendant le chargement : masquer trop tôt
};

const PermissionsContext = createContext(ETAT_DEFAUT);

export const usePermissions = () => useContext(PermissionsContext);

export const PermissionsProvider = ({ children }) => {
  const [etat, setEtat] = useState(ETAT_DEFAUT);

  const charger = useCallback(async () => {
    const user = authService.getCurrentUser();
    if (!user?.id) return; // hors session : rien à charger
    try {
      const { data } = await api.get('/auth/me');
      const permissions = data?.role?.permissions || [];
      const possedeTout = permissions.includes('*');
      setEtat({
        charge: true,
        role: data.role,
        // Le joker '*' (super administrateur) accorde tout.
        can: (permission) => possedeTout || permissions.includes(permission),
      });
    } catch {
      // Transport en échec (session expirée, réseau) : on reste permissif —
      // l'API tranche. Un menu qui s'affiche à tort est un défaut cosmétique ;
      // un menu qui disparaît à tort est une fonctionnalité perdue.
      setEtat({ charge: false, role: null, can: () => true });
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  // Après un changement de rôle, l'API répond 401 SESSION_INVALIDEE (jeton
  // invalidé) : l'intercepteur d'api.js redirige vers la connexion. Au retour,
  // ce provider se remonte et recharge — rien à faire ici de plus.
  return (
    <PermissionsContext.Provider value={etat}>
      {children}
    </PermissionsContext.Provider>
  );
};
