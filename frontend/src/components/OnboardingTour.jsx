import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';

// Le contenu des visites vit dans ./onboarding/visites.js (une visite par
// module, construite d'après les permissions). Ce composant ne fait que les
// jouer : il ne décide ni QUAND une visite démarre, ni si elle a déjà été vue
// — c'est VisiteGuidee qui pilote, avec la progression enregistrée sur le
// compte (migration 026).

// Événement permettant de rejouer le tour depuis le menu utilisateur. Sans lui,
// le tour n'était visible qu'une fois par navigateur : `docuflow_tour_done_*`
// posé, plus aucun moyen de le revoir sans vider le stockage local.
export const RESTART_TOUR_EVENT = 'docuflow:restart-tour';

const TOOLTIP_WIDTH = 320;      // w-80
const FALLBACK_HEIGHT = 268;    // hauteur réelle de la carte, mesurée ensuite
const GAP = 14;                 // écart bulle ↔ cible, laisse la place à la flèche
const PAD = 16;                 // marge minimale avec le bord de l'écran
const ARROW = 14;               // côté du carré pivoté à 45°

/** Un élément masqué par une media query n'a ni surface ni boîte de rendu. */
function isVisible(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
}

/**
 * Place la bulle autour de la cible et calcule la position de la flèche.
 *
 * `position` n'est qu'un souhait : si le côté demandé n'offre pas la place, on
 * bascule sur son opposé, puis à défaut sur le côté le plus dégagé. Auparavant
 * la hauteur de la bulle était devinée (180 px pour ~268 réels) et le recadrage
 * se contentait d'un `Math.min` : la bulle recouvrait l'élément qu'elle était
 * censée désigner.
 */
function computeLayout(rect, requested, tipHeight) {
  const tipW = TOOLTIP_WIDTH;
  const tipH = tipHeight || FALLBACK_HEIGHT;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const room = {
    top: rect.top - GAP - PAD,
    bottom: vh - rect.bottom - GAP - PAD,
    left: rect.left - GAP - PAD,
    right: vw - rect.right - GAP - PAD,
  };
  const need = { top: tipH, bottom: tipH, left: tipW, right: tipW };
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

  let placement = requested && room[requested] !== undefined ? requested : 'bottom';
  if (room[placement] < need[placement]) {
    const other = opposite[placement];
    placement = room[other] >= need[other]
      ? other
      : Object.keys(room).reduce((a, b) => (room[a] - need[a] >= room[b] - need[b] ? a : b));
  }

  let top;
  let left;
  if (placement === 'bottom') {
    top = rect.bottom + GAP;
    left = rect.left + (rect.width - tipW) / 2;
  } else if (placement === 'top') {
    top = rect.top - tipH - GAP;
    left = rect.left + (rect.width - tipW) / 2;
  } else if (placement === 'right') {
    left = rect.right + GAP;
    top = rect.top + (rect.height - tipH) / 2;
  } else {
    left = rect.left - tipW - GAP;
    top = rect.top + (rect.height - tipH) / 2;
  }

  left = Math.max(PAD, Math.min(left, vw - tipW - PAD));
  top = Math.max(PAD, Math.min(top, vh - tipH - PAD));

  // La flèche suit la CIBLE, pas le centre de la bulle : près d'un bord, le
  // recadrage ci-dessus décale la bulle de plusieurs dizaines de pixels et une
  // flèche centrée ne désignerait plus rien.
  const vertical = placement === 'top' || placement === 'bottom';
  const center = vertical ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
  const start = vertical ? left : top;
  const span = vertical ? tipW : tipH;
  const margin = ARROW + 8; // la flèche ne doit pas mordre sur les angles arrondis
  const arrowOffset = Math.max(margin, Math.min(center - start, span - margin));

  return { top, left, placement, arrowOffset };
}

/**
 * Attend la fin du défilement fluide avant de mesurer.
 *
 * `scrollIntoView({ behavior: 'smooth' })` dure de 200 à 700 ms selon la
 * distance : le délai fixe de 300 ms mesurait la cible EN COURS de déplacement,
 * d'où un anneau posé à côté de l'élément. On observe la position jusqu'à ce
 * qu'elle se stabilise, avec un plafond pour ne jamais rester bloqué.
 */
function whenSettled(element, cb) {
  let previous = null;
  let stable = 0;
  let frames = 0;
  const tick = () => {
    const rect = element.getBoundingClientRect();
    if (previous && Math.abs(rect.top - previous.top) < 0.5 && Math.abs(rect.left - previous.left) < 0.5) {
      stable += 1;
    } else {
      stable = 0;
    }
    previous = rect;
    frames += 1;
    if (stable >= 3 || frames > 60) cb(element.getBoundingClientRect());
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Repère d'une étape sans cible : la bulle se centre à l'écran.
const CENTRE = { centre: true, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };

/**
 * @param {Array}    steps    étapes ({ id, selector?, title, content, position?, inMenu? })
 * @param {boolean}  actif    passe à true → la visite démarre à l'étape 1
 * @param {Function} onFermer (terminee: boolean) → appelé à la fin ou à l'abandon
 */
const OnboardingTour = ({ steps = [], actif = false, onFermer }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [targetRect, setTargetRect] = useState(null);
  const [layout, setLayout] = useState({ top: 0, left: 0, placement: 'bottom', arrowOffset: 160 });

  const tooltipRef = useRef(null);

  // `steps` est un littéral recréé à chaque rendu par Dashboard.jsx. S'en servir
  // comme dépendance recréait les rappels à chaque rendu, ce qui relançait
  // l'effet de démarrage : son `clearTimeout` annulait sans cesse le compte à
  // rebours de 1 s, et une fois ouvert le tour était ramené à l'étape 1 dès le
  // moindre rafraîchissement du tableau de bord. On lit la valeur via une réf.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // Réfs de fonctions : `goToStep` doit pouvoir terminer le tour et s'appeler
  // lui-même sans créer de cycle de dépendances entre useCallback.
  const goToStepRef = useRef(null);
  const finishTourRef = useRef(null);

  const onFermerRef = useRef(onFermer);
  onFermerRef.current = onFermer;

  const findTargetElement = useCallback((selector) => {
    if (!selector) return null;
    if (!selector.startsWith('[')) return document.getElementById(selector.replace('#', ''));
    // Plusieurs éléments portent le même `data-tour` : la barre de navigation
    // desktop ET le menu mobile. `querySelector` renvoie le premier du DOM,
    // c'est-à-dire souvent celui que la media query masque — l'étape était
    // alors sautée sur petit écran. On retient le premier réellement visible.
    const all = document.querySelectorAll(selector);
    for (const el of all) if (isVisible(el)) return el;
    return all[0] || null;
  }, []);

  const closeTour = useCallback((terminee = false) => {
    window.dispatchEvent(new CustomEvent('docuflow:set-user-menu', { detail: false }));
    setIsOpen(false);
    setTargetRect(null);
    onFermerRef.current?.(terminee);
  }, []);

  finishTourRef.current = closeTour;

  const goToStep = useCallback((stepIndex, direction = 1) => {
    const list = stepsRef.current;
    if (stepIndex < 0) return;
    if (stepIndex >= list.length) {
      // Plus aucune cible jusqu'à la fin : on termine proprement au lieu de
      // laisser la bulle figée sur l'étape précédente, bouton « Suivant » inerte.
      finishTourRef.current?.(true);
      return;
    }

    const step = list[stepIndex];

    // Étape sans cible : bulle centrée, rien à faire défiler ni à éclairer.
    if (!step.selector) {
      window.dispatchEvent(new CustomEvent('docuflow:set-user-menu', { detail: false }));
      setTargetRect(CENTRE);
      setCurrentStep(stepIndex);
      return;
    }

    const settle = (element) => {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      whenSettled(element, (rect) => {
        setTargetRect(rect);
        setCurrentStep(stepIndex);
      });
    };

    if (step.inMenu) {
      window.dispatchEvent(new CustomEvent('docuflow:set-user-menu', { detail: true }));
      setTimeout(() => {
        const el = findTargetElement(step.selector);
        if (el && isVisible(el)) settle(el);
        else goToStepRef.current?.(stepIndex + direction, direction);
      }, 350);
      return;
    }

    // Étape hors menu : refermer le menu avatar s'il a été ouvert par une
    // étape précédente, sinon il recouvre la cible suivante.
    window.dispatchEvent(new CustomEvent('docuflow:set-user-menu', { detail: false }));

    const element = findTargetElement(step.selector);
    if (element && isVisible(element)) settle(element);
    else goToStepRef.current?.(stepIndex + direction, direction);
  }, [findTargetElement]);

  goToStepRef.current = goToStep;

  const nextStep = useCallback(() => {
    if (currentStep < stepsRef.current.length - 1) goToStep(currentStep + 1, 1);
    else closeTour(true);
  }, [currentStep, goToStep, closeTour]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) goToStep(currentStep - 1, -1);
  }, [currentStep, goToStep]);

  // Démarrage piloté par le parent : chaque passage de `actif` à true rejoue
  // la visite depuis le début. Une étape 1 dont la cible manque est sautée par
  // goToStep, comme les autres.
  useEffect(() => {
    if (!actif || !stepsRef.current.length) return;
    setIsOpen(true);
    goToStep(0, 1);
  }, [actif, goToStep]);

  // Position de la bulle : recalculée après le rendu, une fois sa hauteur
  // RÉELLE connue. La deviner décalait la flèche de plusieurs dizaines de pixels.
  useLayoutEffect(() => {
    if (!isOpen || !targetRect || targetRect.centre) return;
    const height = tooltipRef.current?.offsetHeight || FALLBACK_HEIGHT;
    setLayout(computeLayout(targetRect, stepsRef.current[currentStep]?.position, height));
  }, [isOpen, targetRect, currentStep]);

  // Défilement et redimensionnement : sans écoute du défilement, l'anneau et la
  // flèche restaient à leur place tandis que la cible, elle, remontait.
  useEffect(() => {
    if (!isOpen) return;
    const handler = () => {
      const step = stepsRef.current[currentStep];
      const element = findTargetElement(step?.selector);
      if (element && isVisible(element)) setTargetRect(element.getBoundingClientRect());
    };
    window.addEventListener('scroll', handler, { passive: true, capture: true });
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    return () => {
      window.removeEventListener('scroll', handler, { capture: true });
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
    };
  }, [isOpen, currentStep, findTargetElement]);

  // Échap ferme le tour — un panneau modal sans sortie clavier piège l'utilisateur.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeTour(false);
      else if (e.key === 'ArrowRight') nextStep();
      else if (e.key === 'ArrowLeft') prevStep();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeTour, nextStep, prevStep]);

  if (!isOpen || !targetRect) return null;

  const step = stepsRef.current[currentStep];
  if (!step) return null;
  const total = stepsRef.current.length;
  const progress = ((currentStep + 1) / total) * 100;
  const { top, left, placement, arrowOffset } = layout;

  const centre = targetRect.centre === true;
  const valid = !centre && targetRect.width > 0 && targetRect.height > 0;

  // Masque sombre percé d'un « trou » sur la cible.
  const spotlightStyle = valid ? {
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
    transition: 'clip-path 0.3s var(--df-ease)',
  } : null;

  // Flèche : carré blanc pivoté à 45°, bordé sur les deux faces tournées vers la
  // cible. Elle est SŒUR de la carte, pas enfant : la carte porte
  // `overflow-hidden` pour ses angles arrondis et l'aurait rognée.
  const half = ARROW / 2;
  const arrowStyle = {
    position: 'absolute',
    width: ARROW,
    height: ARROW,
    backgroundColor: '#ffffff',
    transform: 'rotate(45deg)',
    zIndex: 1,
    ...(placement === 'bottom' && {
      top: -half, left: arrowOffset - half,
      borderTop: '1px solid #e2e8f0', borderLeft: '1px solid #e2e8f0',
    }),
    ...(placement === 'top' && {
      bottom: -half, left: arrowOffset - half,
      borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0',
    }),
    ...(placement === 'right' && {
      left: -half, top: arrowOffset - half,
      borderLeft: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0',
    }),
    ...(placement === 'left' && {
      right: -half, top: arrowOffset - half,
      borderTop: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0',
    }),
  };

  return createPortal(
    <>
      {spotlightStyle && (
        <>
          <div style={spotlightStyle} aria-hidden="true" />
          {/* Anneau lumineux — met la cible en évidence sous le masque */}
          <div
            className="docuflow-ring pointer-events-none fixed rounded-xl"
            style={{
              top: targetRect.top - 8,
              left: targetRect.left - 8,
              width: targetRect.width + 16,
              height: targetRect.height + 16,
              zIndex: 9998,
            }}
            aria-hidden="true"
          />
        </>
      )}

      {/* Étape centrée : voile uni, sans trou ni anneau */}
      {centre && (
        <div className="fixed inset-0 z-[9997]" style={{ backgroundColor: 'rgba(15, 23, 42, 0.6)' }} aria-hidden="true" />
      )}

      {/* Bulle d'explication */}
      <div
        ref={tooltipRef}
        className="fixed z-[9999] pointer-events-auto animate-fade-in-up"
        style={centre
          ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: `${TOOLTIP_WIDTH}px`, maxWidth: 'calc(100vw - 32px)' }
          : { top, left, width: `${TOOLTIP_WIDTH}px` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
      >
        {/* Flèche pointant vers l'élément mis en avant */}
        {!centre && <div style={arrowStyle} aria-hidden="true" />}

        <div className="relative bg-white rounded-2xl shadow-elevated border border-slate-200 overflow-hidden">
          {/* En-tête */}
          <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 id="tour-title" className="font-bold text-slate-900 text-base">{step.title}</h3>
              <p className="text-sm text-slate-500 mt-1 leading-relaxed">{step.content}</p>
            </div>
            <button
              onClick={() => closeTour(false)}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0"
              aria-label="Passer le tour"
            >
              <X size={18} />
            </button>
          </div>

          {/* Progression et navigation */}
          <div className="px-5 py-4 border-t border-slate-100">
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span>Étape {currentStep + 1} sur {total}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-docuflow-secondary to-blue-500 rounded-full transition-all duration-300 ease-[var(--df-ease)]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-center gap-1.5 mb-4">
              {stepsRef.current.map((s, i) => (
                <button
                  key={s.id || i}
                  onClick={() => goToStep(i, i < currentStep ? -1 : 1)}
                  disabled={i === currentStep}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === currentStep
                      ? 'bg-docuflow-secondary w-6'
                      : i < currentStep
                      ? 'bg-emerald-500'
                      : 'bg-slate-300 hover:bg-slate-400'
                  }`}
                  aria-label={`Aller à l'étape ${i + 1}`}
                  aria-current={i === currentStep ? 'step' : undefined}
                />
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              {/* `opacity-50` était appliqué en permanence : le bouton semblait
                  inactif même quand il l'était. Il ne s'estompe que désactivé. */}
              <button
                onClick={prevStep}
                disabled={currentStep === 0}
                className="btn-secondary flex-1 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} className="mr-1" /> Précédent
              </button>
              <div className="flex-1" />
              {currentStep === total - 1 ? (
                <button onClick={() => closeTour(true)} className="btn-primary flex-1 justify-center">
                  Terminer <Check size={16} className="ml-1" />
                </button>
              ) : (
                <button onClick={nextStep} className="btn-primary flex-1 justify-center">
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
