import React from 'react';
import { LayoutDashboard, FileSearch, History, LogOut, Building2, ShieldCheck, X, Info, ClipboardList, FolderOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import { useSettings } from '../contexts/SettingsContext';

const Sidebar = ({ activeTab, setActiveTab, isMobileOpen, onToggleMobile }) => {
  const navigate = useNavigate();
  const user = authService.getCurrentUser();
  const settings = useSettings();
  const logoSrc = settings.site_logo_url || 'https://th.bing.com/th/id/R.d7f2f165ad7ca819fe72a5f20a08a7c7?rik=cmptSS4F09F1Hw&riu=http%3a%2f%2fapiga.africa%2fimg%2fafgc.jpg&ehk=BW9PLt5Ge5oLmVWHbZvaEzZCStjt7IWIJj4n%2bEJym5M%3d&risl=&pid=ImgRaw&r=0';

  const menuItems = [
    { id: 'dashboard', label: 'Tableau de bord', icon: <LayoutDashboard size={20} />, tourId: 'sidebar' },
    { id: 'requests', label: 'Mes demandes', icon: <FileSearch size={20} /> },
    { id: 'documents', label: 'Documents', icon: <FolderOpen size={20} />, tourId: 'documents' },
  ];

  if (user?.role === 'archiviste' || user?.role === 'admin' || user?.role === 'superadmin') {
    menuItems.push({ id: 'my_tasks', label: 'Mes tâches', icon: <ClipboardList size={20} /> });
    menuItems.push({ id: 'history', label: 'Historique', icon: <History size={20} /> });
    menuItems.push({ id: 'all_requests', label: 'Toutes les demandes', icon: <Building2 size={20} /> });
  }

  if (user?.role === 'superadmin') {
    // Seul le propriétaire de la plateforme (tenant 1) accède au portail global.
    // Les superadmins d'entreprise accèdent à l'administration de LEUR entreprise.
    if (user?.tenant_id === 1) {
      menuItems.push({ id: 'super_admin', label: 'Gestion système', icon: <ShieldCheck size={20} />, tourId: 'super-admin' });
    } else {
      menuItems.push({ id: 'company_admin', label: 'Administration', icon: <ShieldCheck size={20} /> });
    }
  }

  menuItems.push({ id: 'about', label: 'À propos', icon: <Info size={20} /> });

  const initial = user?.full_name?.charAt(0).toUpperCase() || '?';

  const handleNav = (item) => {
    if (item.id === 'super_admin') {
      navigate('/super-admin-portal');
    } else if (item.id === 'company_admin') {
      navigate('/admin-portal');
    } else if (item.id === 'about') {
      navigate('/about');
    } else if (item.id === 'documents') {
      navigate('/documents');
    } else {
      setActiveTab(item.id);
    }
    if (onToggleMobile) onToggleMobile();
  };

  const sidebarContent = (
    <div className="h-full bg-gradient-to-b from-afgc-primary to-slate-900 text-white flex flex-col relative overflow-hidden">
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-afgc-secondary/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-blue-600/5 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute top-1/3 right-0 w-0.5 h-32 bg-gradient-to-b from-transparent via-afgc-secondary/20 to-transparent pointer-events-none"></div>

      {/* Mobile close button */}
      <div className="lg:hidden flex justify-end p-4 relative z-10">
        <button onClick={onToggleMobile} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
          <X size={22} className="text-white/70" />
        </button>
      </div>

      {/* Logo */}
      <div className="px-8 pb-6 flex flex-col items-center space-y-3 border-b border-white/[0.06] relative z-10 cursor-pointer group flex-shrink-0" onClick={() => { navigate('/dashboard'); onToggleMobile?.(); }}>
        <div className="relative">
          <div className="absolute -inset-2 bg-gradient-to-r from-afgc-secondary to-blue-400 rounded-full blur-md opacity-0 group-hover:opacity-30 transition-opacity duration-500"></div>
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-afgc-secondary to-blue-600 shadow-lg flex items-center justify-center text-white font-bold text-xl border-2 border-white/10 group-hover:border-white/20 transition-all">
            <img
              src={logoSrc}
              alt="Logo"
              className="w-14 h-14 rounded-full border-2 border-white/20 shadow-inner object-cover"
            />
          </div>
        </div>
        <div className="text-center">
          <h1 className="text-xl font-extrabold tracking-tight text-white group-hover:text-afgc-secondary transition-colors">{settings.site_name || 'DocuFlow'}</h1>
          <span className="text-[9px] uppercase tracking-[0.2em] text-afgc-secondary/70 font-bold">{settings.site_description || 'Enterprise Edition'}</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-6 space-y-1 relative z-10 overflow-y-auto min-h-0">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleNav(item)}
            data-tour={item.tourId}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative ${
              activeTab === item.id
                ? 'bg-gradient-to-r from-afgc-secondary/20 to-blue-500/10 text-white shadow-sm'
                : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            {activeTab === item.id && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-afgc-secondary rounded-r-full shadow-glow-blue"></div>
            )}
            <div className={`${activeTab === item.id ? 'text-afgc-secondary' : 'text-slate-400 group-hover:text-white'} transition-colors flex-shrink-0`}>
              {item.icon}
            </div>
            <span className="font-medium tracking-wide text-sm">{item.label}</span>
            {activeTab === item.id && (
              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-afgc-secondary animate-pulse-soft"></div>
            )}
          </button>
        ))}
      </nav>

      {/* Bottom */}
      <div className="p-4 border-t border-white/[0.06] relative z-10 space-y-3 flex-shrink-0">
        <button
          onClick={() => { navigate('/profile'); onToggleMobile?.(); }}
          className="w-full flex items-center gap-3 p-3 bg-white/[0.04] hover:bg-white/[0.08] rounded-xl transition-all cursor-pointer text-left group"
        >
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-afgc-secondary to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-sm group-hover:shadow-md transition-shadow">
              {initial}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-slate-900"></div>
          </div>
          <div className="overflow-hidden flex-1 min-w-0">
            <p className="text-sm font-bold truncate text-white/90 group-hover:text-white transition-colors">{user?.full_name || 'Utilisateur'}</p>
            <p className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider">{user?.role}</p>
          </div>
        </button>

        <button
          onClick={() => { authService.logout(); navigate('/login'); }}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl transition-all duration-200 font-semibold text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/10 group"
        >
          <LogOut size={15} className="group-hover:translate-x-0.5 transition-transform" />
          <span>Déconnexion</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden lg:flex h-full w-72 flex-shrink-0">
        {sidebarContent}
      </div>

      {/* Mobile drawer */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onToggleMobile} />
          {/* Drawer */}
          <div className="relative w-72 max-w-[85vw] h-full animate-fade-in-left shadow-2xl">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;
