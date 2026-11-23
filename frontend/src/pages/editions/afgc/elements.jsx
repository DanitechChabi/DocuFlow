import React from 'react';
import { TONS } from './vocabulaire';

// Petits éléments communs aux écrans de l'édition AFGC.

export const Pastille = ({ ton = 'gris', children, className = '' }) => (
  <span className={`px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap ${TONS[ton] || TONS.gris} ${className}`}>
    {children}
  </span>
);

/** Chargement : quelques lignes grises qui scintillent, à la forme d'une liste. */
export const Chargement = ({ lignes = 4 }) => (
  <div className="py-4 space-y-3" role="status" aria-label="Chargement">
    {Array.from({ length: lignes }, (_, i) => (
      <div key={i} className="flex items-center gap-3">
        <div className="squelette w-9 h-9 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="squelette h-3.5" style={{ width: `${70 - i * 9}%` }} />
          <div className="squelette h-3" style={{ width: `${45 - i * 5}%` }} />
        </div>
      </div>
    ))}
  </div>
);

/** Un nombre qui monte jusqu'à sa valeur (tableaux de bord) ; immédiat si les animations sont réduites. */
export const Compteur = ({ valeur }) => {
  const [n, setN] = React.useState(typeof valeur === 'number' ? 0 : valeur);
  React.useEffect(() => {
    if (typeof valeur !== 'number') { setN(valeur); return undefined; }
    const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduit || valeur <= 1) { setN(valeur); return undefined; }
    let image;
    const debut = performance.now();
    const pas = (t) => {
      const k = Math.min((t - debut) / 600, 1);
      setN(Math.round(valeur * (1 - (1 - k) ** 3)));
      if (k < 1) image = requestAnimationFrame(pas);
    };
    image = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(image);
  }, [valeur]);
  return n;
};

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
    {/* Sur téléphone, les boutons passent sous le titre : il garde toute la largeur. */}
    {children && <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">{children}</div>}
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
