import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Search, MessageCircle, Menu } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import DocumentChatbot from '../components/DocumentChatbot';
import GlobalSearch from '../components/GlobalSearch';
import ContextualTooltips from '../components/ContextualTooltips';
import NotificationBell from '../components/NotificationBell';
import { useSettings } from '../contexts/SettingsContext';

/**
 * Layout partagé de la plateforme à deux modules :
 *
 *   sidebar verticale (navigation, repliable) à gauche,
 *   barre supérieure mince (recherche, messagerie, notifications) au-dessus
 *   du contenu, zone défilante au centre.
 *
 * La navigation — qui était la Topbar — vit dans la Sidebar : la barre
 * supérieure ne garde que les outils transverses. En mobile, la sidebar se
 * replie en drawer ; son bouton d'ouverture vit ICI, dans la barre — l'état
 * du drawer appartient donc au layout, qui le passe à la Sidebar. (Un contexte
 * exporté par la Sidebar ne l'atteignait pas : le bouton est son FRÈRE dans
 * l'arbre React, hors de son Provider — le clic appelait le no-op par défaut
 * et le menu n'ouvrait jamais.)
 */
const AppLayout = () => {
  const navigate = useNavigate();
  const settings = useSettings();
  const [search, setSearch] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [drawerOuvert, setDrawerOuvert] = useState(false);

  useEffect(() => {
    const handler = (e) => setUnreadCount(e.detail?.count || 0);
    window.addEventListener('docuflow:unread-count', handler);
    return () => window.removeEventListener('docuflow:unread-count', handler);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    const q = search.trim();
    if (q) navigate(`/documents/liste?q=${encodeURIComponent(q)}`);
  };

  const toggleMessaging = () => window.dispatchEvent(new CustomEvent('docuflow:toggle-messaging'));

  return (
    <div className="h-dvh bg-slate-50 flex overflow-hidden">
      <Sidebar
        unreadCount={unreadCount}
        drawerOuvert={drawerOuvert}
        onDrawerChange={setDrawerOuvert}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Barre supérieure — outils transverses, plus de navigation.
            TROIS ZONES équilibrées : gauche (menu mobile), centre (recherche,
            centrée quel que soit le contenu des zones latérales), droite
            (messagerie, notifications). */}
        <header
          className="relative flex-shrink-0 h-14 flex items-center gap-2 sm:gap-3 px-2 sm:px-4 border-b"
          style={{
            backgroundColor: settings.primary_color || '#0f172a',
            borderColor: 'rgba(255,255,255,0.1)',
          }}
        >
          {/* Zone gauche — même largeur que la droite : c'est ce qui maintient
              la recherche au centre exact. */}
          <div className="flex-1 flex items-center">
            <button
              onClick={() => setDrawerOuvert(true)}
              className="lg:hidden p-2 -ml-1 rounded-lg transition-colors hover:bg-white/10 text-white"
              aria-label="Ouvrir le menu"
            >
              <Menu size={20} />
            </button>
          </div>

          {/* Zone centrale — la recherche, centrée. Sous md, le champ cède la
              place à une loupe : le champ écrasait la barre sur téléphone, et
              Ctrl+K n'y existe pas (pas de clavier) — la loupe ouvre la
              recherche globale, tactile elle. */}
          <div className="w-full max-w-md flex items-center justify-center">
            <form onSubmit={handleSearch} className="hidden md:flex w-full items-center relative">
              <Search size={15} className="absolute left-3 pointer-events-none text-white/50" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un document… (Ctrl+K)"
                className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-white/10 bg-white/10 text-sm text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
              />
            </form>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('docuflow:open-search'))}
              className="md:hidden p-2 rounded-lg transition-colors hover:bg-white/10 text-white"
              aria-label="Rechercher"
            >
              <Search size={19} />
            </button>
          </div>

          {/* Zone droite — équilibre la gauche, porte les outils */}
          <div className="flex-1 flex items-center justify-end gap-1">
            <button
              onClick={toggleMessaging}
              className="relative p-2 rounded-lg transition-colors hover:bg-white/10 text-white"
              title="Messagerie"
            >
              <MessageCircle size={19} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[11px] font-bold leading-none animate-pulse">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            <NotificationBell data-tour="notifications" />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto relative">
          <Outlet />
        </main>
      </div>

      <DocumentChatbot />
      <GlobalSearch />
      <ContextualTooltips />
    </div>
  );
};

export default AppLayout;
