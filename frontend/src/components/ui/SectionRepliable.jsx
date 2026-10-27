import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

// ============================================================================
// SectionRepliable — regroupe des cartes sous un titre que l'on replie.
// L'état (ouvert/fermé) est une préférence de l'utilisateur, mémorisée par clé :
// qui ne s'occupe pas de conservation n'a plus à faire défiler ses cartes.
// ============================================================================

const lire = (cle, defaut) => {
  try {
    const v = localStorage.getItem(`docuflow:section:${cle}`);
    return v === null ? defaut : v === '1';
  } catch { return defaut; }
};

const SectionRepliable = ({ cle, titre, resume, ouvertParDefaut = false, children }) => {
  const [ouvert, setOuvert] = useState(() => lire(cle, ouvertParDefaut));
  const basculer = () => {
    setOuvert((o) => {
      try { localStorage.setItem(`docuflow:section:${cle}`, o ? '0' : '1'); } catch { /* privé */ }
      return !o;
    });
  };
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={basculer}
        aria-expanded={ouvert}
        className="w-full flex items-center gap-2 text-left text-sm font-bold text-slate-700 hover:text-docuflow-secondary"
      >
        <ChevronRight size={16} className={`text-slate-400 transition-transform ${ouvert ? 'rotate-90' : ''}`} />
        {titre}
        {!ouvert && resume && <span className="ml-auto text-xs font-medium text-slate-400 truncate">{resume}</span>}
      </button>
      {/* Replié, le contenu reste monté : les cartes gardent leur état et leurs
          chargements, seul l'affichage change. */}
      <div className={ouvert ? 'space-y-5' : 'hidden'}>{children}</div>
    </section>
  );
};

export default SectionRepliable;
