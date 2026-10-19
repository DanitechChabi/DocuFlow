import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { authService, AUTH_CHANGED_EVENT } from '../services/authService';

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
  // Progression de la prise en main (migration 026) : { tours, conseils }.
  onboarding: { tours: {}, conseils: [] },
  visiteVue: () => true,          // pendant le chargement : ne rien lancer
  marquerVisite: async () => {},
  revoirVisite: async () => {},
  conseilVu: () => true,
  marquerConseil: async () => {},
};

// ---------------------------------------------------------------------------
// Repli « navigateur » de la progression : base sans la migration 026, ou
// serveur injoignable. Simple confort : une visite revue de trop n'est pas
// une perte. Toute lecture/écriture protégée (stockage indisponible).
// ---------------------------------------------------------------------------
const CLE_LOCALE = (userId) => `docuflow.onboarding.${userId}`;
const lireLocal = (userId) => {
  try { return JSON.parse(localStorage.getItem(CLE_LOCALE(userId))) || { tours: {}, conseils: [] }; } catch { return { tours: {}, conseils: [] }; }
};
const ecrireLocal = (userId, o) => {
  try { localStorage.setItem(CLE_LOCALE(userId), JSON.stringify(o)); } catch { /* stockage indisponible */ }
};

const PermissionsContext = createContext(ETAT_DEFAUT);

export const usePermissions = () => useContext(PermissionsContext);

export const PermissionsProvider = ({ children }) => {
  const [etat, setEtat] = useState(ETAT_DEFAUT);
  const [onboarding, setOnboarding] = useState(null); // null = pas encore chargé
  const [serveurOnboarding, setServeurOnboarding] = useState(false);

  const charger = useCallback(async () => {
    const user = authService.getCurrentUser();
    if (!user?.id) return; // hors session : rien à charger
    try {
      const { data } = await api.get('/auth/me');
      // Progression : celle du compte si le serveur la connaît, sinon celle
      // du navigateur.
      setServeurOnboarding(Boolean(data?.onboarding));
      setOnboarding(data?.onboarding || lireLocal(user.id));
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
      setOnboarding(lireLocal(user.id));
    }
  }, []);

  /** Applique une action localement, puis l'envoie au serveur s'il la connaît. */
  const enregistrer = useCallback(async (corps, appliquer) => {
    const user = authService.getCurrentUser();
    setOnboarding((prev) => {
      const suivant = appliquer(prev || { tours: {}, conseils: [] });
      if (user?.id) ecrireLocal(user.id, suivant);
      return suivant;
    });
    if (!serveurOnboarding) return;
    try {
      const { data } = await api.patch('/auth/me/onboarding', corps);
      if (data?.onboarding) setOnboarding(data.onboarding);
    } catch {
      // Échec réseau : l'état local suffit pour cette session.
    }
  }, [serveurOnboarding]);

  const fonctionsOnboarding = useMemo(() => ({
    onboarding: onboarding || { tours: {}, conseils: [] },
    // Tant que la progression n'est pas chargée, tout est « vu » : on ne
    // lance pas une visite que l'utilisateur a peut-être déjà faite.
    visiteVue: (cle) => (onboarding ? Boolean(onboarding.tours?.[cle]) : true),
    marquerVisite: (cle) => enregistrer({ visite: cle, action: 'vue' },
      (o) => ({ ...o, tours: { ...o.tours, [cle]: new Date().toISOString() } })),
    revoirVisite: (cle) => enregistrer({ visite: cle, action: 'revoir' },
      (o) => { const tours = { ...o.tours }; delete tours[cle]; return { ...o, tours }; }),
    conseilVu: (id) => (onboarding ? (onboarding.conseils || []).includes(id) : true),
    marquerConseil: (id) => enregistrer({ conseil: id },
      (o) => ({ ...o, conseils: [...new Set([...(o.conseils || []), id])] })),
  }), [onboarding, enregistrer]);

  useEffect(() => { charger(); }, [charger]);

  // Connexion / déconnexion sans rechargement de page : on repart de zéro.
  useEffect(() => {
    const surSession = () => {
      setEtat(ETAT_DEFAUT);
      setOnboarding(null);
      setServeurOnboarding(false);
      charger();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, surSession);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, surSession);
  }, [charger]);

  // Après un changement de rôle, l'API répond 401 SESSION_INVALIDEE (jeton
  // invalidé) : l'intercepteur d'api.js redirige vers la connexion. Au retour,
  // ce provider se remonte et recharge — rien à faire ici de plus.
  const valeur = useMemo(() => ({ ...etat, ...fonctionsOnboarding }), [etat, fonctionsOnboarding]);

  return (
    <PermissionsContext.Provider value={valeur}>
      {children}
    </PermissionsContext.Provider>
  );
};
