import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FileSearch, PlusCircle, ClipboardList, History, Building2,
  FolderOpen, Wand2, Archive, Search as SearchIcon, Bell,
  Settings, User as UserIcon, ChevronLeft, ChevronRight, Menu, X,
  LogOut, ShieldCheck, Info, Compass, MessageCircle,
} from 'lucide-react';
import { authService } from '../services/authService';
import { useSettings } from '../contexts/SettingsContext';
import { usePermissions } from '../hooks/usePermissions';
import { RESTART_TOUR_EVENT } from './OnboardingTour';

// ============================================================================
// Sidebar — navigation principale de la plateforme à deux modules.
//
// DEMANDES et DOCUMENTS sont deux domaines visuellement distincts, chacun avec
// ses entrées de travail. Chaque entrée est conditionnée par la permission qui
// protège sa route côté serveur (usePermissions) : la navigation ne propose
// jamais ce que l'API refuserait.
//
// REPLIABLE : l'état (replié/ouvert) survit au rechargement — c'est une
// préférence de travail, pas un état de page. En mobile, la sidebar devient un
// drawer coulissant.
//
// Les data-tour du tour guidé sont conservés (sidebar, notifications, profile,
// documents, new-request reste au Dashboard).
// ============================================================================

/** Luminosité d'une couleur hexadécimale — pour l'encre du monogramme. */
function isLight(hex) {
  if (!hex) return false;
  const c = hex.replace('#', '');
  if (c.length < 6) return false;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

const DEFAULT_MARK_DARK = '/brand/docuflow-mark.png';
const DEFAULT_MARK_LIGHT = '/brand/docuflow-mark-light.png';

const STOCKAGE_REPLIE = 'docuflow:sidebar-repliee';

// Contexte interne : la barre supérieure héberge le bouton d'ouverture du
// drawer mobile (la sidebar elle-même est hors de portée du pouce en haut de
// colonne) — il lui faut l'état du drawer sans dupliquer la mécanique.
const DrawerContext = React.createContext({ ouvrir: () => {} });

const Sidebar = ({ unreadCount = 0 }) => {
  const navigate = useNavigate();
  const user = authService.getCurrentUser();
  const settings = useSettings();
  const { can, charge } = usePermissions();

  // Le repli est une préférence persistée ; en mobile (< lg) la sidebar est un
  // drawer, toujours « ouverte » en papier mais masquée à l'écran.
  const [repliee, setRepliee] = useState(() => {
    try { return localStorage.getItem(STOCKAGE_REPLIE) === '1'; } catch { return false; }
  });
  const [drawerOuvert, setDrawerOuvert] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STOCKAGE_REPLIE, repliee ? '1' : '0'); } catch { /* privé */ }
  }, [repliee]);

  const primaryColor = settings.primary_color || '#0f172a';
  const sidebarLight = isLight(primaryColor);
  const tText = sidebarLight ? '#1e293b' : '#ffffff';
  const tMuted = sidebarLight ? '#64748b' : 'rgba(255,255,255,0.6)';
  const tBorder = sidebarLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)';
  const tHover = sidebarLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)';
  const tActiveBg = sidebarLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.15)';

  const logoSrc = settings.site_logo_url || (sidebarLight ? DEFAULT_MARK_DARK : DEFAULT_MARK_LIGHT);
  const hasCustomLogo = Boolean(settings.site_logo_url);

  const isSuperadmin = user?.role === 'superadmin';
  const isAdminEntreprise = isSuperadmin || user?.role === 'admin';
  const isOwner = isSuperadmin && user?.tenant_id === 1;

  // --- Entrées de navigation, chacune liée à la permission de sa route ---
  // Pendant le chargement des permissions (can() permissif), tout s'affiche :
  // un clignotement de menu au démarrage est pire qu'une entrée éphémère.
  const entree = (to, label, icon, opts = {}) => ({
    to, label, icon, ...opts,
    visible: opts.permission ? can(opts.permission) : true,
  });

  const sections = [
    {
      titre: null,
      items: [entree('/', 'Accueil', <LayoutDashboard size={18} />, { end: true, tourId: 'sidebar' })],
    },
    {
      titre: 'Demandes',
      items: [
        entree('/demandes', 'Vue d\'ensemble', <Compass size={18} />, { permission: 'requests.view' }),
        entree('/demandes/mes-demandes', 'Mes demandes', <FileSearch size={18} />, { permission: 'requests.view' }),
        entree('/demandes/nouvelle', 'Nouvelle demande', <PlusCircle size={18} />, { permission: 'requests.create' }),
        entree('/demandes/a-traiter', 'À traiter', <ClipboardList size={18} />, { permission: 'requests.process' }),
        entree('/demandes/historique', 'Historique', <History size={18} />, { permission: 'requests.view_history' }),
        entree('/demandes/toutes', 'Toutes les demandes', <Building2 size={18} />, { permission: 'requests.process' }),
      ],
    },
    {
      titre: 'Documents',
      items: [
        entree('/documents', 'Vue d\'ensemble', <Compass size={18} />, { permission: 'documents.view' }),
        entree('/documents/liste', 'Documents', <FolderOpen size={18} />, { permission: 'documents.view', tourId: 'documents' }),
        entree('/documents/a-indexer', 'À indexer', <Wand2 size={18} />, { permission: 'documents.index' }),
        entree('/documents/archives', 'Archives', <Archive size={18} />, { permission: 'documents.view' }),
      ],
    },
    {
      titre: null,
      items: [
        // La recherche globale (Ctrl+K) reste dans la barre supérieure ; cette
        // entrée mène à la recherche approfondie de la GED.
        entree('/documents/liste', 'Recherche', <SearchIcon size={18} />, { permission: 'search.documents', doublon: true }),
        {
          to: '#notifications',
          label: 'Notifications',
          icon: <Bell size={18} />,
          visible: true,
          bouton: true,
          onClick: () => window.dispatchEvent(new CustomEvent('docuflow:open-notifications')),
        },
      ],
    },
  ];

  const renduLien = (item, mobile = false) => {
    if (!item.visible) return null;
    if (item.doublon) return null; // « Recherche » : le champ topbar + Ctrl+K suffisent
    // ALIGNEMENT : l'icône vit dans un conteneur de taille fixe (20 px) — les
    // libellés s'alignent verticalement quelle que soit la largeur naturelle
    // de l'icône. En mode replié, l'entrée se concentre sur son icône dans le
    // rail de 68 px.
    const classes = ({ isActive }) => `group flex items-center rounded-xl transition-colors ${
      mobile ? 'px-3 py-2.5 text-sm gap-3'
        : repliee ? 'justify-center px-0 py-2.5 text-[13px]'
        : 'px-3 py-2 text-[13px] gap-3'
    } font-semibold`;
    const style = ({ isActive }) => ({
      color: isActive ? tText : tMuted,
      backgroundColor: isActive ? tActiveBg : 'transparent',
    });

    const contenu = (
      <>
        <span className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${repliee && !mobile ? 'mx-auto' : ''}`} style={{ color: 'inherit' }}>{item.icon}</span>
        <span className={`truncate ${repliee && !mobile ? 'hidden' : ''}`}>{item.label}</span>
        {item.label === 'Notifications' && unreadCount > 0 && (
          <span className={`ml-auto min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[11px] font-bold ${repliee && !mobile ? 'hidden' : ''}`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </>
    );

    if (item.bouton) {
      return (
        <button
          key={item.label}
          onClick={item.onClick}
          className={classes({ isActive: false })}
          style={style({ isActive: false })}
          title={repliee && !mobile ? item.label : undefined}
        >
          {contenu}
        </button>
      );
    }

    return (
      <NavLink
        key={item.to + (item.label)}
        to={item.to}
        end={item.end}
        data-tour={item.tourId}
        onClick={() => setDrawerOuvert(false)}
        className={classes}
        style={style}
        title={repliee && !mobile ? item.label : undefined}
      >
        {contenu}
      </NavLink>
    );
  };

  const renduSection = (section, mobile = false) => {
    const visibles = section.items.filter((i) => i.visible && !i.doublon);
    if (!visibles.length) return null;
    return (
      <div key={section.titre || 'principal'} className="space-y-1">
        {section.titre && !repliee && !mobile && (
          <div className="px-3 pt-4 pb-1 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: tMuted }}>
            {section.titre}
          </div>
        )}
        {section.titre && repliee && !mobile && (
          <div className="pt-4 pb-1 mx-3 border-t" style={{ borderColor: tBorder }} />
        )}
        {section.items.map((item) => renduLien(item, mobile))}
      </div>
    );
  };

  // --- Menu utilisateur (bas de sidebar, remplace le dropdown avatar) ---
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = React.useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const restartTour = () => {
    setUserMenuOpen(false);
    setDrawerOuvert(false);
    navigate('/');
    setTimeout(() => window.dispatchEvent(new CustomEvent(RESTART_TOUR_EVENT)), 400);
  };

  const handleLogout = () => {
    authService.logout();
    navigate('/login');
  };

  const initial = user?.full_name?.charAt(0)?.toUpperCase() || '?';

  const blocUtilisateur = (
    <div className="relative" ref={userMenuRef}>
      <button
        onClick={() => setUserMenuOpen(!userMenuOpen)}
        data-tour="profile"
        className={`w-full flex items-center rounded-xl transition-colors ${repliee ? 'justify-center px-0' : 'gap-3 px-2'} py-2`}
        style={{ color: tText, backgroundColor: 'transparent' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = tHover; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
          style={{ backgroundColor: settings.secondary_color || '#3b82f6', color: '#fff' }}
        >
          {initial}
        </span>
        {!repliee && (
          <span className="flex-1 text-left min-w-0">
            <span className="block text-[13px] font-bold truncate">{user?.full_name || 'Utilisateur'}</span>
            <span className="block text-[11px] truncate" style={{ color: tMuted }}>{user?.role}</span>
          </span>
        )}
        {!repliee && <ChevronRight size={14} style={{ color: tMuted }} className={userMenuOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />}
      </button>

      {userMenuOpen && (
        <div
          className={`${repliee ? 'left-full bottom-2 ml-2' : 'bottom-full left-2 right-2 mb-2'} absolute z-50 rounded-2xl shadow-2xl border overflow-hidden py-1.5`}
          style={{ backgroundColor: sidebarLight ? '#ffffff' : '#1e293b', borderColor: tBorder, minWidth: '200px' }}
        >
          <div className="px-4 py-2 border-b" style={{ borderColor: tBorder }}>
            <div className="text-sm font-bold" style={{ color: tText }}>{user?.full_name}</div>
            <div className="text-xs truncate" style={{ color: tMuted }}>{user?.username}</div>
          </div>
          <div className="py-1">
            {[
              { to: '/profile', icon: <UserIcon size={15} />, label: 'Mon profil', tourId: 'profile' },
              ...(isAdminEntreprise ? [{ to: isOwner ? '/super-admin-portal' : '/admin-portal', icon: <ShieldCheck size={15} />, label: isOwner ? 'Gestion système' : 'Administration', tourId: 'super-admin' }] : []),
              { to: '/admin/audit-logs', icon: <History size={15} />, label: 'Journal d\'audit', visible: can('audit.view') },
              { onClick: restartTour, icon: <Compass size={15} />, label: 'Revoir le tour guidé' },
              { to: '/about', icon: <Info size={15} />, label: 'À propos' },
            ].filter((i) => i.visible !== false).map((item) => (
              item.to ? (
                <NavLink
                  key={item.label}
                  to={item.to}
                  data-tour={item.tourId}
                  onClick={() => { setUserMenuOpen(false); setDrawerOuvert(false); }}
                  className="flex items-center gap-2.5 px-4 py-2 text-sm font-semibold transition-colors"
                  style={{ color: tText }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = tHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  {item.icon} {item.label}
                </NavLink>
              ) : (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-semibold transition-colors text-left"
                  style={{ color: tText }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = tHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  {item.icon} {item.label}
                </button>
              )
            ))}
            <div className="border-t my-1" style={{ borderColor: tBorder }} />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-semibold transition-colors text-left"
              style={{ color: '#ef4444' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = tHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <LogOut size={15} /> Déconnexion
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const corps = (mobile = false) => (
    <>
      {/* Logo + repli */}
      <div className="flex items-center gap-2 px-3 h-16 flex-shrink-0">
        <NavLink to="/" data-tour="sidebar" className="flex items-center gap-2 min-w-0 flex-1" onClick={() => setDrawerOuvert(false)}>
          <div
            className={`w-8 h-8 flex items-center justify-center flex-shrink-0 ${hasCustomLogo ? 'rounded-md bg-gradient-to-br from-docuflow-secondary to-blue-600 overflow-hidden' : ''}`}
          >
            <img
              src={logoSrc}
              className={hasCustomLogo ? 'w-full h-full object-cover' : 'w-full h-full object-contain'}
              alt="Logo"
            />
          </div>
          <span className={`font-bold text-sm truncate ${repliee && !mobile ? 'hidden' : ''}`} style={{ color: tText }}>
            {settings.site_name || 'DocuFlow'}
          </span>
        </NavLink>
        {!mobile && (
          <button
            onClick={() => setRepliee(!repliee)}
            className="p-1.5 rounded-lg transition-colors flex-shrink-0"
            style={{ color: tMuted }}
            title={repliee ? 'Déplier la navigation' : 'Replier la navigation'}
          >
            {repliee ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}
        {mobile && (
          <button onClick={() => setDrawerOuvert(false)} className="p-1.5 rounded-lg" style={{ color: tMuted }} aria-label="Fermer le menu">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
        {sections.map((s) => renduSection(s, mobile))}
      </nav>

      {/* Utilisateur */}
      <div className={`${repliee ? 'px-1' : 'px-2'} pb-3 border-t`} style={{ borderColor: tBorder }}>
        {blocUtilisateur}
      </div>
    </>
  );

  return (
    <DrawerContext.Provider value={{ ouvrir: () => setDrawerOuvert(true), tText }}>
      {/* Desktop : colonne fixe */}
      <aside
        className="hidden lg:flex flex-col flex-shrink-0 transition-[width] duration-200 border-r"
        style={{
          width: repliee ? '68px' : '248px',
          backgroundColor: primaryColor,
          borderColor: tBorder,
        }}
      >
        {corps(false)}
      </aside>

      {/* Mobile : drawer coulissant */}
      {drawerOuvert && (
        <div className="lg:hidden fixed inset-0 z-[90] flex">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setDrawerOuvert(false)} />
          <aside
            className="relative flex flex-col w-[270px] h-full shadow-2xl animate-fade-in"
            style={{ backgroundColor: primaryColor }}
          >
            {corps(true)}
          </aside>
        </div>
      )}
    </DrawerContext.Provider>
  );
};

/** Bouton d'ouverture du menu mobile — à rendre dans la barre supérieure.
 *  Posé APRÈS la déclaration : l'assignation s'exécute au chargement du
 *  module, avant elle tombait dans la zone morte de `const Sidebar` et
 *  l'ReferenceError emportait tout l'écran (page blanche). */
Sidebar.MobileButton = () => {
  const { ouvrir } = React.useContext(DrawerContext);
  return (
    <button onClick={ouvrir} className="lg:hidden p-2 rounded-md text-white" aria-label="Menu">
      <Menu size={20} />
    </button>
  );
};

export default Sidebar;
