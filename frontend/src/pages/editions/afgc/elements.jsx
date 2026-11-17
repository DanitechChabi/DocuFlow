import React from 'react';
import { TONS } from './vocabulaire';

// Petits éléments communs aux écrans de l'édition AFGC.

export const Pastille = ({ ton = 'gris', children, className = '' }) => (
  <span className={`px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap ${TONS[ton] || TONS.gris} ${className}`}>
    {children}
  </span>
);

export const Chargement = () => (
  <div className="py-8 text-center">
    <div className="w-6 h-6 border border-slate-200 border-t-docuflow-secondary rounded-full animate-spin mx-auto" />
  </div>
);

/** En-tête de page : titre, phrase d'aide, actions à droite. */
export const EnTete = ({ titre, aide, icone: Icone, children }) => (
  <div className="flex flex-wrap items-start gap-4 mb-6 animate-fade-in-up">
    {Icone && (
      <div className="w-12 h-12 rounded-lg bg-green-50 text-docuflow-secondary flex items-center justify-center flex-shrink-0">
        <Icone size={22} />
      </div>
    )}
    <div className="min-w-0 flex-1">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">{titre}</h1>
      {aide && <p className="text-sm text-slate-500 mt-1">{aide}</p>}
    </div>
    {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
  </div>
);

/**
 * Choix d'un motif (consultation, solde créditeur…) : en pastilles s'ils sont
 * peu nombreux, sinon en liste déroulante. `tous` : filtre (« Tous les motifs »).
 */
export const ChoixCadre = ({ cadres, valeur, onChange, tous = false }) => (cadres.length > 6 ? (
  <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500">
    {tous && 'Motif'}
    <select value={valeur} onChange={(e) => onChange(e.target.value)} aria-label="Motif"
      className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 focus:outline-none focus:border-docuflow-secondary max-w-full">
      {tous && <option value="">Tous les motifs</option>}
      {cadres.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
    </select>
  </label>
) : (
  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Motif">
    {tous && (
      <button type="button" role="radio" aria-checked={!valeur} onClick={() => onChange('')}
        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${!valeur ? 'bg-docuflow-secondary text-white border-docuflow-secondary' : 'bg-white text-slate-600 border-slate-200 hover:border-docuflow-secondary'}`}>
        Tous les motifs
      </button>
    )}
    {cadres.map((c) => (
      <button key={c.value} type="button" role="radio" aria-checked={valeur === c.value} onClick={() => onChange(c.value)}
        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${valeur === c.value ? 'bg-docuflow-secondary text-white border-docuflow-secondary' : 'bg-white text-slate-600 border-slate-200 hover:border-docuflow-secondary'}`}>
        {c.label}
      </button>
    ))}
  </div>
));

/** Barre d'avancement d'une liste : retournés / transmis / à transmettre. */
export const Avancement = ({ total, transmis, retournes }) => {
  const pc = (n) => (total ? `${(n / total) * 100}%` : '0%');
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex" aria-hidden="true">
      <div className="bg-slate-400" style={{ width: pc(retournes) }} />
      <div className="bg-docuflow-secondary" style={{ width: pc(transmis) }} />
    </div>
  );
};
