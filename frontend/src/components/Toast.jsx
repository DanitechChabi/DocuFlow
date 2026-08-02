import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, AlertCircle, X, Info } from 'lucide-react';

let toastId = 0;
let listeners = [];

export const toast = {
  success: (message, duration = 4000) => notify({ type: 'success', message, duration }),
  error: (message, duration = 6000) => notify({ type: 'error', message, duration }),
  info: (message, duration = 4000) => notify({ type: 'info', message, duration }),
};

function notify({ type, message, duration }) {
  const id = ++toastId;
  listeners.forEach((fn) => fn({ id, type, message, duration }));
}

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const COLORS = {
  success: 'bg-green-50 border-green-200 text-green-700',
  error: 'bg-red-50 border-red-200 text-red-600',
  info: 'bg-blue-50 border-blue-200 text-blue-600',
};

const ICON_COLORS = {
  success: 'text-green-500',
  error: 'text-red-500',
  info: 'text-blue-500',
};

const ToastContainer = () => {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (t) => {
      setToasts((prev) => [...prev, t]);
      if (t.duration > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== t.id));
        }, t.duration);
      }
    };
    listeners.push(handler);
    return () => { listeners = listeners.filter((fn) => fn !== handler); };
  }, []);

  const dismiss = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => {
        const Icon = ICONS[t.type];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg animate-fade-in-down max-w-sm ${COLORS[t.type]}`}
          >
            <Icon size={18} className={ICON_COLORS[t.type]} />
            <p className="text-sm font-medium flex-1">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="p-1 hover:bg-black/5 rounded-lg transition-colors flex-shrink-0">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
};

export default ToastContainer;
