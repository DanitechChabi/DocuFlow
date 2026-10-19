import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronRight, ChevronLeft, Lightbulb, Sparkles } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';

/**
 * Système de tooltips contextuels amélioré.
 * Affiche des info-bulles éducatives quand l'utilisateur survole ou interagit pour la première fois.
 * Plus léger qu'un tour complet — juste des conseils au bon moment.
 */
const TOOLTIP_CONFIGS = [
  {
    id: 'topbar-search',
    selector: '[data-tour="topbar-search"]',
    title: 'Recherche rapide',
    content: 'Utilisez Ctrl+K pour une recherche globale instantanée. Trouvez documents, demandes et plus en quelques frappes.',
    position: 'bottom',
  },
  {
    id: 'docubot',
    selector: 'button[title*="DocuBot"]',
    title: 'Assistant intelligent',
    content: 'DocuBot répond à vos questions sur les documents. Essayez : "Trouve tous les contrats de 2026"',
    position: 'right',
  },
  {
    id: 'new-request',
    selector: '[data-tour="new-request"]',
    title: 'Créer une demande',
    content: 'Une phrase suffit : décrivez le document ou le dossier, les archives s\'occupent du reste. Vous serez prévenu à chaque étape.',
    position: 'bottom',
    permission: 'requests.create',
  },
];

/**
 * @param {boolean} enabled false pendant une visite guidée (ou juste avant
 *        qu'elle démarre) : un seul guide à la fois. Les conseils lus sont
 *        enregistrés sur le compte (migration 026), comme les visites.
 */
const ContextualTooltips = ({ enabled = true }) => {
  const [activeTooltip, setActiveTooltip] = useState(null);
  const { can, charge, conseilVu, marquerConseil } = usePermissions();
  const timeoutsRef = useRef([]);

  const markSeen = useCallback((id) => { marquerConseil(id); }, [marquerConseil]);

  const showTooltip = useCallback((config) => {
    setActiveTooltip(config);
  }, []);

  const dismiss = useCallback(() => {
    if (activeTooltip) markSeen(activeTooltip.id);
    setActiveTooltip(null);
  }, [activeTooltip, markSeen]);

  // Auto-fermeture : un conseil qui reste affiché devient du mobilier. Surtout,
  // il ne doit JAMAIS s'installer en voile bloquant — l'ancien overlay
  // plein écran (inset-0) avalait chaque tap du téléphone sans prévenir : le
  // tooltip se rendait souvent hors champ, l'utilisateur ne voyait que le
  // bout de la page… et « le menu hamburger n'ouvrait pas ». Le tooltip est
  // un conseil passif : il se lit, se ferme, ou s'en va tout seul.
  useEffect(() => {
    if (!activeTooltip) return undefined;
    const t = setTimeout(() => dismiss(), 10000);
    return () => clearTimeout(t);
  }, [activeTooltip, dismiss]);

  // Afficher les tooltips non vus après un délai
  // Une visite qui démarre ferme le conseil en cours (sans le marquer lu).
  useEffect(() => { if (!enabled) setActiveTooltip(null); }, [enabled]);

  useEffect(() => {
    if (!enabled || !charge) return;

    // Nettoyer les timeouts précédents
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    TOOLTIP_CONFIGS.forEach((config, index) => {
      if (conseilVu(config.id)) return;
      if (config.permission && !can(config.permission)) return;

      const timeout = setTimeout(() => {
        const el = document.querySelector(config.selector);
        if (el && !activeTooltip) {
          showTooltip(config);
        }
      }, 3000 + index * 2000); // Stagger : 3s, 5s, 7s...

      timeoutsRef.current.push(timeout);
    });

    return () => timeoutsRef.current.forEach(clearTimeout);
  }, [enabled, charge, conseilVu, can, activeTooltip, showTooltip]);

  if (!activeTooltip) return null;

  const tooltip = activeTooltip;
  const targetEl = document.querySelector(tooltip.selector);
  let pos = { top: 100, left: 200 };

  if (targetEl) {
    const rect = targetEl.getBoundingClientRect();
    if (tooltip.position === 'bottom') {
      pos = { top: rect.bottom + 12, left: Math.max(16, rect.left - 20) };
    } else if (tooltip.position === 'right') {
      pos = { top: rect.top - 10, left: rect.right + 12 };
    } else if (tooltip.position === 'left') {
      pos = { top: rect.top - 10, left: rect.left - 330 };
    }
  }

  const tooltipIndex = TOOLTIP_CONFIGS.findIndex(c => c.id === tooltip.id);
  const totalTooltips = TOOLTIP_CONFIGS.length;

  return (
    <>
      {/* Tooltip — NON MODAL : aucun voile plein écran. Un conseil passif ne
          mérite pas de capturer les clics de toute la page. */}
      <div
        className="fixed z-[95] w-80 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-fade-in-up"
        style={{
          top: Math.min(Math.max(16, pos.top), window.innerHeight - 180),
          left: Math.max(16, Math.min(pos.left, window.innerWidth - 340)),
        }}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 bg-gradient-to-r from-docuflow-secondary/5 to-blue-500/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-docuflow-secondary/10">
              <Lightbulb size={14} className="text-docuflow-secondary" />
            </div>
            <h4 className="text-sm font-bold text-slate-800">{tooltip.title}</h4>
          </div>
          <button onClick={dismiss} className="w-6 h-6 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-3">
          <p className="text-sm text-slate-600 leading-relaxed">{tooltip.content}</p>
        </div>

        {/* Footer */}
        <div className="px-5 pb-3 flex items-center justify-between">
          <span className="text-[10px] text-slate-400 font-medium">
            {tooltipIndex + 1} / {totalTooltips}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={dismiss}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors"
              style={{ color: '#3b82f6', backgroundColor: '#3b82f610' }}
            >
              <Sparkles size={12} />
              Compris
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ContextualTooltips;
