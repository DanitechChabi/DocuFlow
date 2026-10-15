import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import Modal from './ui/Modal';

/**
 * Modal de confirmation élégant remplaçant window.confirm()
 * @param {boolean} isOpen
 * @param {string} title
 * @param {string} message
 * @param {string} confirmLabel - Texte du bouton de confirmation
 * @param {string} type - 'danger' | 'warning' | 'info'
 * @param {boolean} loading
 * @param {function} onConfirm
 * @param {function} onClose
 */
const ConfirmDialog = ({ isOpen, title, message, confirmLabel = 'Confirmer', type = 'danger', loading = false, onConfirm, onClose }) => {
  const typeStyles = {
    danger: {
      icon: Trash2,
      iconBg: 'bg-red-100',
      iconColor: 'text-red-500',
      btnBg: 'bg-red-600 hover:bg-red-700',
    },
    warning: {
      icon: AlertTriangle,
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-500',
      btnBg: 'bg-amber-600 hover:bg-amber-700',
    },
    info: {
      icon: AlertTriangle,
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-500',
      btnBg: 'bg-docuflow-secondary hover:bg-blue-700',
    },
  };

  const style = typeStyles[type] || typeStyles.danger;
  const Icon = style.icon;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      zIndex="z-[9998]"
      panelClassName="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden"
    >
      <div className="p-8 text-center">
        <div className={`w-16 h-16 ${style.iconBg} rounded-full flex items-center justify-center mx-auto mb-5`}>
          <Icon size={28} className={style.iconColor} />
        </div>
        <h3 className="text-lg font-black text-slate-900 mb-2">{title}</h3>
        <p className="text-sm text-slate-500 leading-relaxed">{message}</p>
      </div>

      <div className="px-8 pb-8 flex gap-3">
        <button
          onClick={onClose}
          disabled={loading}
          className="btn-secondary flex-1 py-3"
        >
          Annuler
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`flex-1 py-3 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 ${style.btnBg} disabled:opacity-50`}
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : null}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;
