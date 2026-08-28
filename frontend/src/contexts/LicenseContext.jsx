import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { licenseService } from '../services/licenseService';
import { estBureau } from '../utils/plateforme';

// ============================================================================
// LicenseContext — état de la licence de la version bureau.
//
// GARDE-FOU CAPITAL : LE MÊME BUILD SERT VERCEL
// Ce bundle est déployé tel quel sur le SaaS web, où aucune licence n'existe et
// où /api/license répond 404. Sans la détection ci-dessous, chaque chargement du
// SaaS déclencherait un appel voué à l'échec et, pire, un état `unlicensed` qui
// enfermerait tous les clients en ligne sur l'écran d'activation. Le provider
// est donc INERTE hors mode bureau : état `active`, `allowed` vrai, zéro requête.
//
// POURQUOI UN CONTEXTE ET PAS UN SIMPLE APPEL DANS LA PAGE
// L'état sert à deux endroits qui ne se connaissent pas : l'écran /license, et
// la garde de routes de App.jsx. Un état partagé évite que la garde et la page
// interrogent le backend séparément et affichent des verdicts divergents.
// ============================================================================

// Détection centralisée dans utils/plateforme.js : la même question est posée par
// SuperAdminPage pour retirer le portail des licences, et deux définitions
// parallèles finiraient par diverger.
const isDesktop = estBureau;

// État servi sur le web, et tant que le premier appel n'a pas répondu en mode
// bureau. `allowed: true` par défaut est délibéré : l'application ne doit pas
// clignoter vers l'écran de licence pendant les quelques millisecondes de
// chargement d'un poste parfaitement sous licence.
const ETAT_TRANSPARENT = {
  state: 'active',
  allowed: true,
  message: null,
  license_key: null,
  valid_until: null,
  days_remaining: null,
  grace_days_remaining: null,
  machine_id: null,
  offline: false,
};

const LicenseContext = createContext({
  ...ETAT_TRANSPARENT,
  desktop: false,
  loading: false,
  refresh: async () => {},
  activate: async () => {},
  deactivate: async () => {},
});

export const useLicense = () => useContext(LicenseContext);

export const LicenseProvider = ({ children }) => {
  const desktop = isDesktop();
  const [etat, setEtat] = useState(ETAT_TRANSPARENT);
  // Chargement initial uniquement en mode bureau : sur le web il n'y a rien à
  // attendre, et un `loading` vrai ferait afficher un écran d'attente inutile.
  const [loading, setLoading] = useState(desktop);

  // Le backend renvoie déjà `allowed` (licenseGuard.isAllowed) : on ne recalcule
  // pas la règle côté client, sinon les deux implémentations divergeraient au
  // premier ajout d'état. Repli sur la liste des états autorisés seulement si le
  // champ manque (réponse tronquée par un proxy).
  const appliquer = useCallback((data) => {
    if (!data) return;
    setEtat({
      ...ETAT_TRANSPARENT,
      ...data,
      allowed: typeof data.allowed === 'boolean'
        ? data.allowed
        : ['active', 'grace'].includes(data.state),
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!desktop) return;
    setLoading(true);
    try {
      appliquer(await licenseService.getState());
    } catch {
      // Backend local injoignable (fermeture en cours, port pas encore ouvert).
      // On NE bascule PAS en état bloquant : ce serait punir un client sous
      // licence pour un incident de démarrage. Le prochain appel corrigera.
    } finally {
      setLoading(false);
    }
  }, [desktop, appliquer]);

  const check = useCallback(async (force = false) => {
    if (!desktop) return ETAT_TRANSPARENT;
    setLoading(true);
    try {
      const data = await licenseService.check(force);
      appliquer(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, [desktop, appliquer]);

  const activate = useCallback(async (key) => {
    const data = await licenseService.activate(key);
    appliquer(data);
    return data;
  }, [appliquer]);

  const deactivate = useCallback(async () => {
    const data = await licenseService.deactivate();
    appliquer(data);
    return data;
  }, [appliquer]);

  // Premier état au démarrage. `check()` plutôt que `getState()` : au tout
  // premier lancement, main.js a certes déjà calculé l'état, mais après une
  // journée d'inactivité l'artefact peut avoir besoin d'être renouvelé — et
  // c'est le seul moment où l'utilisateur ne remarquera pas l'attente réseau.
  useEffect(() => {
    if (!desktop) return;
    let monte = true;
    (async () => {
      try {
        const data = await licenseService.check(false);
        if (monte) appliquer(data);
      } catch {
        try {
          const data = await licenseService.getState();
          if (monte) appliquer(data);
        } catch {
          // Voir refresh() : aucun état bloquant sur une erreur de transport.
        }
      } finally {
        if (monte) setLoading(false);
      }
    })();
    return () => { monte = false; };
  }, [desktop, appliquer]);

  // ---------------------------------------------------------------------------
  // Réaction au 402 émis par l'intercepteur axios (services/api.js)
  //
  // L'intercepteur ne redirige pas lui-même : il se contente de signaler. C'est
  // ici que la décision se prend, parce que seul le provider sait si l'on est en
  // mode bureau — et parce qu'un `window.location.href` dans l'intercepteur
  // arracherait l'utilisateur à son écran (avec son formulaire en cours) sur un
  // simple appel de fond, par exemple un compteur de notifications.
  //
  // L'événement porte déjà `license_state` : on l'applique immédiatement pour
  // que le message soit juste, PUIS on relit l'état complet, seul porteur de
  // `days_remaining` et de `machine_id`.
  // ---------------------------------------------------------------------------
  const enCours = useRef(false);

  useEffect(() => {
    if (!desktop) return;

    const onLicenseRequired = (event) => {
      const detail = event.detail || {};
      setEtat((prev) => ({
        ...prev,
        state: detail.license_state || prev.state,
        message: detail.message || prev.message,
        valid_until: detail.valid_until ?? prev.valid_until,
        machine_id: detail.machine_id || prev.machine_id,
        allowed: false,
      }));

      // Un écran refusé déclenche souvent plusieurs requêtes d'un coup, donc
      // plusieurs 402 : sans ce verrou, chacun lancerait sa propre vérification
      // et le backend verrait une rafale d'appels au serveur de licence.
      if (enCours.current) return;
      enCours.current = true;
      licenseService
        .getState()
        .then(appliquer)
        .catch(() => { /* l'état posé ci-dessus suffit à afficher la raison */ })
        .finally(() => { enCours.current = false; });
    };

    window.addEventListener('docuflow:license-required', onLicenseRequired);
    return () => window.removeEventListener('docuflow:license-required', onLicenseRequired);
  }, [desktop, appliquer]);

  const valeur = {
    ...etat,
    // Renommages pour l'interface : le backend parle `snake_case`, les
    // composants React `camelCase`.
    licenseKey: etat.license_key,
    validUntil: etat.valid_until,
    daysRemaining: etat.days_remaining,
    graceDaysRemaining: etat.grace_days_remaining,
    machineId: etat.machine_id,
    desktop,
    loading,
    refresh,
    check,
    activate,
    deactivate,
  };

  return (
    <LicenseContext.Provider value={valeur}>
      {children}
    </LicenseContext.Provider>
  );
};
