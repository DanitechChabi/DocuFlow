import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDelayedUnmount } from '../../hooks/useDelayedUnmount';

const VARIANTS = {
  scale: {
    container: 'items-center justify-center p-4',
    enter: 'animate-scale-in',
    exit: 'animate-scale-out',
    duration: 180,
  },
  'drawer-left': {
    container: 'items-stretch justify-start',
    enter: 'animate-fade-in-left',
    exit: 'animate-slide-out-left',
    duration: 240,
  },
  'drawer-right': {
    container: 'items-stretch justify-end',
    enter: 'animate-slide-in-right',
    exit: 'animate-slide-out-right',
    duration: 240,
  },
};

// Backdrop + panneau partagés par toutes les modales/tiroirs de l'app : avant
// ce composant, chaque appelant réimplémentait son propre `fixed inset-0` et
// aucun ne jouait d'animation de fermeture (démontage instantané). `open`
// peut rester vrai en continu tant que l'appelant garde le composant monté —
// c'est `Modal` qui gère le délai de sortie, pas l'appelant.
const Modal = ({
  open,
  onClose,
  children,
  variant = 'scale',
  panelClassName = '',
  backdropClassName = '',
  zIndex = 'z-[9998]',
  closeOnBackdrop = true,
  closeOnEscape = true,
}) => {
  const { container, enter, exit, duration } = VARIANTS[variant] || VARIANTS.scale;
  const [rendered, closing] = useDelayedUnmount(open, duration);

  useEffect(() => {
    if (!rendered || !closeOnEscape) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [rendered, closeOnEscape, onClose]);

  if (!rendered) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndex} flex ${container} bg-slate-900/40 backdrop-blur-sm ${closing ? 'animate-fade-out' : 'animate-fade-in'} ${backdropClassName}`}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className={`${closing ? exit : enter} ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};

export default Modal;
