import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';

// Étapes par défaut pour tous les utilisateurs (Dashboard)
export const DEFAULT_TOUR_STEPS = [
  {
    id: 'sidebar',
    selector: '[data-tour="sidebar"]',
    title: 'Navigation principale',
    content: 'La barre de navigation vous donne accès à toutes les sections : Tableau de bord, Mes demandes, Documents, et plus selon votre rôle.',
    position: 'bottom',
  },
  {
    id: 'new_request',
    selector: '[data-tour="new-request"]',
    title: 'Nouvelle demande',
    content: 'Cliquez ici pour créer une demande de document. Remplissez le formulaire : entreprise, dossier, type, motif, priorité.',
    position: 'bottom',
  },
  {
    id: 'notifications',
    selector: '[data-tour="notifications"]',
    title: 'Notifications',
    content: 'La cloche affiche vos notifications en temps réel : nouvelles demandes assignées, changements de statut, messages.',
    position: 'bottom',
  },
  {
    id: 'documents',
    selector: '[data-tour="documents"]',
    title: 'Documents (GED)',
    content: 'Le référentiel documentaire : créez des dossiers, uploadez des fichiers, gérez les versions et les statuts (Disponible / Prêt / Archivé).',
    position: 'bottom',
  },
  {
    id: 'profile',
    selector: '[data-tour="profile"]',
    title: 'Votre profil',
    content: 'Modifiez vos informations, changez votre mot de passe, gérez vos préférences.',
    position: 'left',
  },
];

// Étapes supplémentaires pour superadmin
export const SUPERADMIN_TOUR_STEPS = [
  {
    id: 'super_admin',
    selector: '[data-tour="super-admin"]',
    title: 'Gestion système',
    content: 'Accès au portail superadmin : gestion des utilisateurs, sections, branding, entreprises.',
    position: 'bottom',
  },
];

const STORAGE_KEY_PREFIX = 'docuflow_tour_done_';

const OnboardingTour = ({
  steps = DEFAULT_TOUR_STEPS,
  userId,
  onComplete,
  autoStart = true,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [targetRect, setTargetRect] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const tourCompletedRef = useRef(false);

  // Vérifier si le tour a déjà été fait pour cet utilisateur
  const checkTourStatus = useCallback(() => {
    if (!userId) return false;
    const done = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`);
    return done === 'true';
  }, [userId]);

  const markTourDone = useCallback(() => {
    if (!userId) return;
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, 'true');
    tourCompletedRef.current = true;
  }, [userId]);

  const findTargetElement = useCallback((selector) => {
    if (!selector) return null;
    // Support pour data-tour attributes
    if (selector.startsWith('[')) {
      return document.querySelector(selector);
    }
    // Support pour IDs
    return document.getElementById(selector.replace('#', ''));
  }, []);

  const computeTooltipPosition = useCallback((element, position) => {
    if (!element) return { top: 0, left: 0 };

    const rect = element.getBoundingClientRect();
    const tooltipWidth = 320; // w-80
    const tooltipHeight = 180; // estimation
    const gap = 12;
    const viewportPadding = 16;

    let top = 0;
    let left = 0;

    switch (position) {
      case 'right':
        left = rect.right + gap;
        top = rect.top + (rect.height - tooltipHeight) / 2;
        if (left + tooltipWidth > window.innerWidth - viewportPadding) {
          left = rect.left - tooltipWidth - gap;
        }
        break;
      case 'left':
        left = rect.left - tooltipWidth - gap;
        top = rect.top + (rect.height - tooltipHeight) / 2;
        if (left < viewportPadding) {
          left = rect.right + gap;
        }
        break;
      case 'bottom':
        left = rect.left + (rect.width - tooltipWidth) / 2;
        top = rect.bottom + gap;
        if (left < viewportPadding) left = viewportPadding;
        if (left + tooltipWidth > window.innerWidth - viewportPadding) {
          left = window.innerWidth - tooltipWidth - viewportPadding;
        }
        break;
      case 'top':
      default:
        left = rect.left + (rect.width - tooltipWidth) / 2;
        top = rect.top - tooltipHeight - gap;
        if (left < viewportPadding) left = viewportPadding;
        if (left + tooltipWidth > window.innerWidth - viewportPadding) {
          left = window.innerWidth - tooltipWidth - viewportPadding;
        }
        if (top < viewportPadding) {
          top = rect.bottom + gap;
        }
        break;
    }

    // Clamp vertical
    top = Math.max(viewportPadding, Math.min(top, window.innerHeight - tooltipHeight - viewportPadding));

    return { top, left };
  }, []);

  const goToStep = useCallback((stepIndex) => {
    if (stepIndex < 0 || stepIndex >= steps.length) return;

    const step = steps[stepIndex];
    const element = findTargetElement(step.selector);

    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        const newRect = element.getBoundingClientRect();
        setTargetRect(newRect);
        const pos = computeTooltipPosition(element, step.position);
        setTooltipPosition(pos);
        setCurrentStep(stepIndex);
      }, 300);
    } else {
      // Élément non trouvé, passer au suivant
      goToStep(stepIndex + 1);
    }
  }, [steps, findTargetElement, computeTooltipPosition]);

  const finishTour = useCallback(() => {
    markTourDone();
    setIsOpen(false);
    setTargetRect(null);
    onComplete?.();
  }, [markTourDone, onComplete]);

  const nextStep = useCallback(() => {
    if (currentStep < steps.length - 1) {
      goToStep(currentStep + 1);
    } else {
      finishTour();
    }
  }, [currentStep, steps.length, goToStep, finishTour]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  }, [currentStep, goToStep]);

  const skipTour = useCallback(() => {
    markTourDone();
    setIsOpen(false);
    setTargetRect(null);
    onComplete?.();
  }, [markTourDone, onComplete]);

  // Auto-start
  useEffect(() => {
    if (autoStart && userId && !checkTourStatus() && !tourCompletedRef.current) {
      // Attendre que le DOM soit prêt et que les éléments soient rendus
      const timer = setTimeout(() => {
        const firstStep = steps[0];
        const element = findTargetElement(firstStep.selector);
        if (element) {
          setIsOpen(true);
          goToStep(0);
        } else {
          // Élément non trouvé, ne pas démarrer le tour
          console.log('OnboardingTour: first step element not found, skipping tour');
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [autoStart, userId, checkTourStatus, goToStep, steps]);

  // Recalculer la position au resize
  useEffect(() => {
    if (!isOpen || !targetRect) return;
    const handleResize = () => {
      const step = steps[currentStep];
      const element = findTargetElement(step.selector);
      if (element) {
        const newRect = element.getBoundingClientRect();
        setTargetRect(newRect);
        const pos = computeTooltipPosition(element, step.position);
        setTooltipPosition(pos);
      }
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [isOpen, currentStep, steps, targetRect, findTargetElement, computeTooltipPosition]);

  if (!isOpen || !targetRect) return null;

  const step = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;

  // Overlay spotlight (masque avec "trou") - only if targetRect is valid
  let spotlightStyle = null;
  if (targetRect && targetRect.width > 0 && targetRect.height > 0) {
    spotlightStyle = {
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      pointerEvents: 'none',
      zIndex: 9997,
      clipPath: `
        polygon(
          0 0, 100vw 0, 100vw 100vh, 0 100vh,
          ${Math.max(0, targetRect.left - 8)}px ${Math.max(0, targetRect.top - 8)}px,
          ${Math.min(window.innerWidth, targetRect.right + 8)}px ${Math.max(0, targetRect.top - 8)}px,
          ${Math.min(window.innerWidth, targetRect.right + 8)}px ${Math.min(window.innerHeight, targetRect.bottom + 8)}px,
          ${Math.max(0, targetRect.left - 8)}px ${Math.min(window.innerHeight, targetRect.bottom + 8)}px
        )
      `,
      transition: 'clip-path 0.3s ease-out',
    };
  }

  // Flèche du tooltip
  const getArrowPosition = (position) => {
    switch (position) {
      case 'right': return { top: '50%', left: '-8px', transform: 'translateY(-50%) rotate(90deg)' };
      case 'left': return { top: '50%', right: '-8px', transform: 'translateY(-50%) rotate(-90deg)' };
      case 'bottom': return { top: '-8px', left: '50%', transform: 'translateX(-50%) rotate(180deg)' };
      default: return { bottom: '-8px', left: '50%', transform: 'translateX(-50%)' };
    }
  };

  return createPortal(
    <>
      {/* Spotlight overlay */}
      {spotlightStyle && <div style={spotlightStyle} aria-hidden="true" />}

      {/* Tooltip */}
      <div
        className="fixed z-[9999] pointer-events-auto animate-fade-in-up"
        style={{
          top: tooltipPosition.top,
          left: tooltipPosition.left,
          width: '320px', // w-80
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
      >
        {/* Flèche */}
        <div
          className="absolute w-3 h-3 bg-white rotate-45 shadow-lg"
          style={{
            ...getArrowPosition(step.position),
            boxShadow: '4px 4px 8px rgba(0,0,0,0.1)',
          }}
        />

        {/* Carte tooltip */}
        <div className="bg-white rounded-2xl shadow-elevated border border-slate-100 overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 id="tour-title" className="font-bold text-slate-900 text-base">{step.title}</h3>
              <p className="text-sm text-slate-500 mt-1 leading-relaxed">{step.content}</p>
            </div>
            <button
              onClick={skipTour}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0"
              aria-label="Passer le tour"
            >
              <X size={18} />
            </button>
          </div>

          {/* Footer avec progression et boutons */}
          <div className="px-5 py-4 border-t border-slate-100">
            {/* Barre de progression */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span>Étape {currentStep + 1} sur {steps.length}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-afgc-secondary to-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Points de progression */}
            <div className="flex items-center justify-center gap-1.5 mb-4">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goToStep(i)}
                  disabled={i === currentStep}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === currentStep
                      ? 'bg-afgc-secondary w-6'
                      : i < currentStep
                      ? 'bg-emerald-500'
                      : 'bg-slate-300 hover:bg-slate-400'
                  }`}
                  aria-label={`Aller à l'étape ${i + 1}`}
                  aria-current={i === currentStep ? 'step' : undefined}
                />
              ))}
            </div>

            {/* Boutons navigation */}
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={prevStep}
                disabled={currentStep === 0}
                className="btn-secondary flex-1 justify-center opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} className="mr-1" /> Précédent
              </button>
              <div className="flex-1" />
              {currentStep === steps.length - 1 ? (
                <button
                  onClick={finishTour}
                  className="btn-primary flex-1 justify-center"
                >
                  Terminer <Check size={16} className="ml-1" />
                </button>
              ) : (
                <button
                  onClick={nextStep}
                  className="btn-primary flex-1 justify-center"
                >
                  Suivant <ChevronRight size={16} className="ml-1" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};

export default OnboardingTour;