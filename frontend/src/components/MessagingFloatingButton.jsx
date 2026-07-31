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
        className={`fixed bottom-6 right-6 z-30 p-4 rounded-2xl shadow-2xl transition-all duration-300 hover:scale-110 active:scale-95 group ${
          isPanelOpen
            ? 'bg-slate-800 rotate-90 shadow-lg'
            : 'bg-gradient-to-br from-afgc-secondary to-blue-600 hover:shadow-glow-blue'
        }`}
        title="Messagerie"
      >
        {isPanelOpen ? (
          <X size={24} className="text-white" />
        ) : (
          <>
            <MessageCircle size={24} className="text-white" />
            {unreadCount > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[24px] h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center px-1.5 border-2 border-white animate-float shadow-lg">
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
