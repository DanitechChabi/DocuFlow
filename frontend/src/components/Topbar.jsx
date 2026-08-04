import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FileSearch, FolderOpen, History, Building2,
  ShieldCheck, Info, ClipboardList, Menu, X, Search, LogOut,
  User as UserIcon, MessageCircle, ChevronDown,
} from 'lucide-react';
import { authService } from '../services/authService';
import { useSettings } from '../contexts/SettingsContext';
import NotificationBell from './NotificationBell';

const DEFAULT_LOGO = 'https://th.bing.com/th/id/R.d7f2f165ad7ca819fe72a5f20a08a7c7?rik=cmptSS4F09F1Hw&riu=http%3a%2f%2fapiga.africa%2fimg%2fafgc.jpg&ehk=BW9PLt5Ge5oLmVWHbZvaEzZCStjt7IWIJj4n%2bEJym5M%3d&risl=&pid=ImgRaw&r=0';

/**
 * Déterminer si une couleur est claire (nécessite du texte sombre).
 */
function isLight(hex) {
  if (!hex) return false;
  const c = hex.replace('#', '');
  if (c.length < 6) return false;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

/**
 * Topbar horizontale style GitHub — navigation compacte inline,
 * recherche globale, actions admin dans menu avatar.
 * S'adapte aux couleurs du thème configuré par l'admin.
 */
const Topbar = () => {
  const navigate = useNavigate();
  const user = authService.getCurrentUser();
  const settings = useSettings();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const userMenuRef = useRef(null);

  // Couleurs thème pour la topbar
  const primaryColor = settings.primary_color || '#0f172a';
  const secondaryColor = settings.secondary_color || '#3b82f6';
  const topbarLight = isLight(primaryColor);
  const tText = topbarLight ? '#1e293b' : '#ffffff';
  const tMuted = topbarLight ? '#64748b' : 'rgba(255,255,255,0.6)';
  const tBorder = topbarLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)';
  const tHover = topbarLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)';
  const tActiveBg = topbarLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.15)';

  const logoSrc = settings.site_logo_url || DEFAULT_LOGO;
  const isStaff = ['archiviste', 'admin', 'superadmin'].includes(user?.role);
  const isSuperadmin = user?.role === 'superadmin';
  const isOwner = isSuperadmin && user?.tenant_id === 1;

  // Navigation principale — style GitHub inline compact
  const navItems = [
    { to: '/dashboard', label: 'Tableau de bord', icon: <LayoutDashboard size={16} />, end: true },
    { to: '/dashboard/requests', label: 'Mes demandes', icon: <FileSearch size={16} /> },
    { to: '/documents', label: 'Documents', icon: <FolderOpen size={16} />, tourId: 'documents' },
  ];

  if (isStaff) {
    navItems.push(
      { to: '/dashboard/tasks', label: 'Mes tâches', icon: <ClipboardList size={16} /> },
      { to: '/dashboard/history', label: 'Historique', icon: <History size={16} /> },
      { to: '/dashboard/all', label: 'Toutes les demandes', icon: <Building2 size={16} /> }
    );
  }

  // Fermer le menu utilisateur au clic extérieur
  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Écouter le compteur de messages non lus (diffusé par MessagingFloatingButton)
  useEffect(() => {
    const handler = (e) => setUnreadCount(e.detail?.count || 0);
    window.addEventListener('docuflow:unread-count', handler);
    return () => window.removeEventListener('docuflow:unread-count', handler);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    const q = search.trim();
    if (q) {
      navigate(`/documents?q=${encodeURIComponent(q)}`);
      setMobileOpen(false);
    }
  };

  const handleLogout = () => {
    authService.logout();
    navigate('/login');
  };

  const toggleMessaging = () => window.dispatchEvent(new CustomEvent('docuflow:toggle-messaging'));

  const initial = user?.full_name?.charAt(0)?.toUpperCase() || '?';

  // Lien de navigation inline style GitHub
  const renderNavItem = (item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      data-tour={item.tourId}
      onClick={() => setMobileOpen(false)}
      className={({ isActive }) =>
        `flex items-center gap-1.5 px-2 py-1.5 text-sm font-semibold rounded-md transition-colors ${
          isActive ? '' : ''
        }`
      }
      style={({ isActive }) => ({
        color: isActive ? tText : tMuted,
        backgroundColor: isActive ? tActiveBg : 'transparent',
      })}
    >
      {item.icon}
      <span className="hidden lg:inline">{item.label}</span>
    </NavLink>
  );

  // Lien de navigation mobile (grille 2 colonnes)
  const renderNavItemMobile = (item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      data-tour={item.tourId}
      onClick={() => setMobileOpen(false)}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2.5 text-sm font-semibold rounded-xl transition-colors ${
          isActive ? 'bg-slate-100 text-afgc-primary' : 'text-slate-600 hover:bg-slate-50'
        }`
      }
    >
      {item.icon}
      {item.label}
    </NavLink>
  );

  return (
    <header className="relative z-40 flex-shrink-0" style={{ backgroundColor: primaryColor, borderBottom: `1px solid ${tBorder}` }}>
      <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center gap-3">
        {/* Burger mobile */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="lg:hidden p-2 rounded-md transition-colors"
          style={{ color: tText }}
          aria-label="Menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        {/* Logo + nom du site */}
        <NavLink
          to="/dashboard"
          data-tour="sidebar"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2 flex-shrink-0"
        >
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-afgc-secondary to-blue-600 flex items-center justify-center overflow-hidden flex-shrink-0">
            <img src={logoSrc} className="w-full h-full object-cover" alt="Logo" />
          </div>
          <span className="hidden sm:block font-bold text-sm" style={{ color: tText }}>{settings.site_name || 'DocuFlow'}</span>
        </NavLink>

        {/* Spacer gauche — pousse la navigation au centre */}
        <div className="hidden lg:block flex-1"></div>

        {/* Navigation principale — centrée style GitHub */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => renderNavItem(item))}
        </nav>

        {/* Spacer droit — équilibre avec le spacer gauche */}
        <div className="flex-1"></div>

        {/* Actions — recherche, messagerie, notifications, menu utilisateur */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Recherche globale → GED (desktop uniquement, cachée sur mobile) */}
          <form onSubmit={handleSearch} className="hidden xl:flex items-center relative">
            <Search size={16} className="absolute left-3 pointer-events-none" style={{ color: tMuted }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un document…"
              className="w-64 pl-9 pr-3 py-1.5 rounded-md border focus:outline-none focus:ring-2 text-sm transition-all"
              style={{ backgroundColor: topbarLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.1)', borderColor: tBorder, color: tText }}
            />
          </form>

          <button
            onClick={toggleMessaging}
            className="relative p-2 rounded-md transition-colors hover:opacity-80"
            style={{ color: tText }}
            title="Messagerie"
          >
            <MessageCircle size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[11px] font-bold leading-none animate-pulse">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          <NotificationBell data-tour="notifications" />

          {/* Menu utilisateur — style GitHub avec dropdown */}
          <div className="relative ml-1" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 p-1 rounded-md transition-colors hover:opacity-80"
              aria-label="Menu utilisateur"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-afgc-secondary to-blue-600 flex items-center justify-center text-white font-bold text-xs shadow-sm flex-shrink-0">
                {initial}
              </div>
              <ChevronDown size={14} className="hidden sm:block" style={{ color: tMuted }} />
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-xl border border-slate-200 py-2 animate-fade-in-down z-50">
                {/* Header utilisateur */}
                <div className="px-4 py-3 border-b border-slate-100">
                  <p className="text-sm font-bold text-slate-900 truncate">{user?.full_name || 'Utilisateur'}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{user?.email || user?.username}</p>
                  <p className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider mt-1">{user?.role}</p>
                </div>

                {/* Actions */}
                <div className="py-1">
                  <button
                    onClick={() => { navigate('/profile'); setUserMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <UserIcon size={16} /> Mon profil
                  </button>

                  {isSuperadmin && (
                    <button
                      onClick={() => { navigate(isOwner ? '/super-admin-portal' : '/admin-portal'); setUserMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      data-tour="super-admin"
                    >
                      <ShieldCheck size={16} /> {isOwner ? 'Gestion système' : 'Administration'}
                    </button>
                  )}

                  <button
                    onClick={() => { navigate('/about'); setUserMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Info size={16} /> À propos
                  </button>
                </div>

                {/* Déconnexion */}
                <div className="border-t border-slate-100 py-1">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut size={16} /> Déconnexion
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Menu mobile overlay — apparaît sous la topbar */}
      {mobileOpen && (
        <div className="lg:hidden border-t backdrop-blur-xl" style={{ borderColor: tBorder, backgroundColor: topbarLight ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.3)' }}>
          {/* Recherche mobile */}
          <form onSubmit={handleSearch} className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <Search size={18} className="text-slate-400 flex-shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un document…"
              className="flex-1 bg-transparent text-sm text-slate-800 focus:outline-none"
            />
          </form>

          {/* Navigation mobile en grille */}
          <nav className="p-3 grid grid-cols-2 gap-1">
            {navItems.map((item) => renderNavItemMobile(item))}
          </nav>
        </div>
      )}
    </header>
  );
};

export default Topbar;
