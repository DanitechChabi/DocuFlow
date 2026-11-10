import React, { useState, useEffect, useCallback } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { authService } from '../services/authService';
import { messageService } from '../services/messageService';
import MessagingPanel from './MessagingPanel';

const MessagingFloatingButton = () => {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const user = authService.getCurrentUser();

  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const data = await messageService.getUnreadCount();
      setUnreadCount(data.count);
      // Diffuser le compteur pour la Topbar
      window.dispatchEvent(new CustomEvent('docuflow:unread-count', { detail: { count: data.count } }));
    } catch (err) {
      // Silent fail
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [user, fetchUnreadCount]);

  // Icône messagerie de la topbar → ouvre le même panneau
  useEffect(() => {
    const handler = () => setIsPanelOpen((o) => !o);
    window.addEventListener('docuflow:toggle-messaging', handler);
    return () => window.removeEventListener('docuflow:toggle-messaging', handler);
  }, []);

  const handleClosePanel = () => {
    setIsPanelOpen(false);
    fetchUnreadCount();
  };

  if (!user) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsPanelOpen(!isPanelOpen)}
        className={`fixed bottom-3 right-3 sm:bottom-5 sm:right-5 z-30 w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center rounded-2xl shadow-lg transition-all duration-300 hover:scale-105 active:scale-95 group ${
          isPanelOpen
            ? 'bg-slate-800 rotate-90 shadow-lg'
            : 'bg-gradient-to-br from-docuflow-secondary to-blue-600 hover:shadow-glow-blue'
        }`}
        title="Messagerie"
      >
        {isPanelOpen ? (
          <X size={20} className="text-white" />
        ) : (
          <>
            <MessageCircle size={20} className="text-white" />
            {unreadCount > 0 && (
              <span
                key={unreadCount}
                className="absolute -top-2 -right-2 min-w-[20px] h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 border-2 border-white animate-pop-in shadow-lg"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </>
        )}
      </button>

      <MessagingPanel isOpen={isPanelOpen} onClose={handleClosePanel} />
    </>
  );
};

export default MessagingFloatingButton;
