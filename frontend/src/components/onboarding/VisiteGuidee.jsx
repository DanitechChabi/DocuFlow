import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import OnboardingTour, { RESTART_TOUR_EVENT } from '../OnboardingTour';
import { usePermissions } from '../../hooks/usePermissions';
import { useSettings } from '../../contexts/SettingsContext';
import { authService } from '../../services/authService';
import { construireVisite, moduleDeLaPage } from './visites';

/**
 * VisiteGuidee — décide QUAND une visite se joue.
 *
 * - Une visite par espace (accueil, demandes, documents), lancée la première
 *   fois que l'utilisateur y entre — pas tout d'un coup au premier écran.
 * - Construite d'après ses permissions, une fois celles-ci chargées : avant,
 *   `can()` répond oui à tout et la visite montrerait des écrans interdits.
 * - « Vue » (terminée ou passée) est enregistré sur le compte (migration 026) :
 *   la visite ne revient ni sur un autre poste ni dans l'app de bureau.
 * - « Revoir le tour guidé » (menu) rejoue la visite de l'espace courant.
 * - Signale au parent si une visite est en cours ou imminente, pour que les
 *   conseils contextuels se taisent : un seul guide à la fois.
 */
const DELAI_DEMARRAGE_MS = 900;

const VisiteGuidee = ({ onOccupe }) => {
  const { pathname } = useLocation();
  const perms = usePermissions();
  const { can, charge, visiteVue, marquerVisite, revoirVisite } = perms;
  const settings = useSettings();
  const module = moduleDeLaPage(pathname);

  const [actif, setActif] = useState(false);
  const [moduleActif, setModuleActif] = useState(null);
  // Étapes réellement jouées : celles dont la cible est à l'écran au
  // lancement (ou sans cible). Le compteur « Étape 2 sur 4 » ne compte ainsi
  // que ce que l'utilisateur verra — une fonction masquée à son rôle, un
  // menu replié sur téléphone ne gonflent pas le total.
  const [etapesJouees, setEtapesJouees] = useState([]);
  const demarrageRef = useRef(null);
  const moduleActifRef = useRef(null);

  const etapes = useMemo(() => {
    if (!moduleActif) return [];
    const user = authService.getCurrentUser();
    return construireVisite(moduleActif, {
      can,
      prenom: (user?.full_name || '').split(' ')[0],
      organisation: settings.site_name && settings.site_name !== 'DocuFlow' ? settings.site_name : null,
    });
  }, [moduleActif, can, settings.site_name]);

  const lancer = (m) => {
    setEtapesJouees([]);
    moduleActifRef.current = m;
    setModuleActif(m);
    setActif(false);
    // Les familles repliées du menu cachent des cibles : on les déplie.
    window.dispatchEvent(new CustomEvent('docuflow:deplier-menu'));
    // Laisser la page se rendre (cibles présentes) avant la première mesure.
    clearTimeout(demarrageRef.current);
    demarrageRef.current = setTimeout(() => setActif(true), DELAI_DEMARRAGE_MS);
  };

  useEffect(() => {
    if (!actif) return;
    const visible = (sel) => [...document.querySelectorAll(sel)].some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    setEtapesJouees(etapes.filter((e) => !e.selector || e.inMenu || visible(e.selector)));
  }, [actif, etapes]);

  // Première entrée dans un espace : visite automatique.
  const aVoir = Boolean(module && charge && !visiteVue(module));
  useEffect(() => {
    if (aVoir && !actif && moduleActif !== module) lancer(module);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aVoir, module]);

  // « Revoir le tour guidé » : la visite de l'espace courant.
  useEffect(() => {
    const handler = () => {
      const m = moduleDeLaPage(window.location.pathname) || 'accueil';
      revoirVisite(m);
      lancer(m);
    };
    window.addEventListener(RESTART_TOUR_EVENT, handler);
    return () => window.removeEventListener(RESTART_TOUR_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revoirVisite]);

  useEffect(() => () => clearTimeout(demarrageRef.current), []);

  // Un seul guide à la fois : occupé pendant la visite, et tant que la visite
  // de cet espace reste à voir (elle va démarrer).
  const occupe = actif || aVoir;
  useEffect(() => { onOccupe?.(occupe); }, [occupe, onOccupe]);

  // Terminée ou passée : dans les deux cas, ne plus l'imposer. On ne vide la
  // visite active que SI c'est encore celle qu'on ferme : en changeant
  // d'espace, la visite du nouvel espace a pu être lancée juste avant (effet
  // précédent) et ne doit pas être écrasée — d'où la réf, à jour sans
  // attendre le rendu.
  const fermer = (m) => {
    if (!m) return;
    marquerVisite(m);
    if (moduleActifRef.current === m) {
      moduleActifRef.current = null;
      setModuleActif(null);
      setActif(false);
    }
  };

  // Quitter l'espace en pleine visite (un lien du menu…) : elle est close et
  // comptée comme vue — ses cibles ne sont plus à l'écran.
  useEffect(() => {
    if (moduleActif && module !== moduleActif) fermer(moduleActif);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module]);

  // Rien à montrer à ce rôle dans cet espace : marquée vue d'emblée, sinon
  // elle resterait « à voir » et tairait les conseils indéfiniment.
  useEffect(() => {
    if (moduleActif && charge && !etapes.length) fermer(moduleActif);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleActif, etapes.length, charge]);

  if (!moduleActif || !etapes.length || !etapesJouees.length) return null;
  return <OnboardingTour key={moduleActif} steps={etapesJouees} actif={actif} onFermer={() => fermer(moduleActif)} />;
};

export default VisiteGuidee;
