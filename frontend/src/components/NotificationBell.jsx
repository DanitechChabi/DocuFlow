import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check } from 'lucide-react';
import { notificationService } from '../services/notificationService';

const NotificationBell = ({ 'data-tour': dataTour, ...rest }) => {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState({ top: 0, right: 16 }); // DEFAULT right:16 (viewport gutter)
  const btnRef = useRef(null);

  const fetchNotifications = async () => {
    try {
      const data = await notificationService.getNotifications();
      setNotifications(data);
    } catch (err) {
      console.error('Erreur notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  const computeCoords = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    // Always anchor to viewport right edge with 16px gutter (responsive)
    // Use rect.top for vertical position
    setCoords({
      top: rect.bottom + 8,
      right: 16,
    });
  }, []);

  const handleToggle = () => {
    if (!isOpen) {
      computeCoords();
    }
    setIsOpen(!isOpen);
  };

  // Recompute position on resize/orientation change while dropdown is open
  useEffect(() => {
    if (!isOpen) return;
    const handleResize = () => computeCoords();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [isOpen, computeCoords]);

  const handleMarkAsRead = async (id) => {
    try {
      await notificationService.markAsRead(id);
      setNotifications(notifications.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error('Erreur markRead:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error('Erreur markAllRead:', err);
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const hasUnread = unreadCount > 0;

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        data-tour={dataTour}
        {...rest}
        className={`p-2.5 relative transition-all duration-200 rounded-xl ${
          isOpen ? 'bg-slate-100 text-afgc-primary' : 'text-slate-400 hover:text-afgc-primary hover:bg-slate-100'
        }`}
        title="Notifications"
      >
        <Bell size={22} />
        {hasUnread && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 border-2 border-white animate-scale-in shadow-md">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && createPortal(
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-[9998]" onClick={() => setIsOpen(false)} />

          {/* Dropdown */}
          <div
            className="fixed z-[9999] w-[min(24rem,calc(100vw-2rem))] bg-white rounded-2xl shadow-elevated border border-slate-100 animate-scale-in overflow-hidden"
            style={{ top: coords.top, right: coords.right }}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800">Notifications</h3>
                <p className="text-xs text-slate-400">{hasUnread ? `${unreadCount} non lue(s)` : 'Tout est à jour'}</p>
              </div>
              {hasUnread && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs font-bold text-afgc-secondary hover:text-blue-700 transition-colors px-3 py-1.5 rounded-lg hover:bg-blue-50"
                >
                  Tout marquer lu
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center">
                  <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin mx-auto"></div>
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-12 text-center">
                  <Bell size={32} className="mx-auto mb-3 text-slate-200" />
                  <p className="text-slate-400 font-medium text-sm">Aucune notification</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`px-5 py-4 border-b border-slate-50 last:border-b-0 transition-colors ${
                      !n.is_read ? 'bg-blue-50/30 border-l-2 border-l-afgc-secondary' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${n.is_read ? 'text-slate-600' : 'text-slate-800 font-bold'}`}>
                          {n.title}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-slate-300 mt-1">
                          {n.created_at ? new Date(n.created_at).toLocaleString('fr-FR') : ''}
                        </p>
                      </div>
                      {!n.is_read && (
                        <button
                          onClick={() => handleMarkAsRead(n.id)}
                          className="p-1.5 text-afgc-secondary hover:bg-blue-100 rounded-lg transition-colors flex-shrink-0"
                          title="Marquer comme lu"
                        >
                          <Check size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
};

export default NotificationBell;
