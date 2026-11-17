import React, { useState, useEffect, useRef, useMemo, useId } from 'react';
import { ChevronDown, Check, Search, Plus, Building2 } from 'lucide-react';
import { VERT } from './styleConnexion';
import { sansAccents, decouper } from './identite';

// ============================================================================
// « Vous êtes… » : le menu déroulant des départements de l'AFGC.
//
// - Il s'ouvre en glissant, les départements apparaissent en cascade, la
//   flèche pivote ; le sigle du département choisi « rebondit » à sa place.
// - On peut taper pour filtrer (« eng », « DE »…) ; si le département manque
//   et que l'organisation le permet, « Créer « … » » l'ajoute.
// - Au clavier : flèches, Entrée, Échap. Le mouvement suit la préférence
//   « réduire les animations » du système (règle globale de index.css).
// ============================================================================

const plat = (s) => sansAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
const DUREE = 200;

/** Monte un panneau puis l'anime : `visible` passe à vrai une image après le montage, et l'inverse à la fermeture. */
function useApparition(ouvert) {
  const [monte, setMonte] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (ouvert) {
      setMonte(true);
      let r2;
      const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setVisible(true)); });
      return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
    }
    setVisible(false);
    const t = setTimeout(() => setMonte(false), DUREE);
    return () => clearTimeout(t);
  }, [ouvert]);
  return { monte, visible };
}

/** Le texte, avec la partie tapée mise en valeur (sans tenir compte des accents). */
function Surligne({ texte, q }) {
  const n = plat(q);
  const i = n ? sansAccents(texte).toLowerCase().indexOf(n) : -1;
  if (i < 0) return texte;
  return (
    <>
      {texte.slice(0, i)}
      <mark className="bg-transparent font-bold" style={{ color: VERT }}>{texte.slice(i, i + n.length)}</mark>
      {texte.slice(i + n.length)}
    </>
  );
}

export const Sigle = ({ sigle, petit = false, rebond = false }) => (
  <span className={`${petit ? 'h-9 min-w-[2.25rem] text-[10px]' : 'h-11 min-w-[2.75rem] text-[11px]'} px-1.5 rounded-xl flex items-center justify-center font-bold flex-shrink-0 tracking-tight ${rebond ? 'animate-pop-in' : ''}`}
    style={{ background: `${VERT}14`, color: VERT }}>
    {sigle || <Building2 size={petit ? 15 : 18} />}
  </span>
);

const ChoixDepartement = ({ departements, creation, valeur, onChange }) => {
  const id = useId();
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState('');
  const [actif, setActif] = useState(0);
  const [saisieLibre, setSaisieLibre] = useState(false);
  const racine = useRef(null);
  const recherche = useRef(null);
  const declencheur = useRef(null);
  const panneau = useRef(null);
  const { monte, visible } = useApparition(ouvert);

  // Le plus probable d'abord : le sigle exact (« DE »), un sigle qui commence
  // par la saisie, un mot de l'intitulé qui commence par elle, puis le reste.
  const trouves = useMemo(() => {
    const n = plat(q);
    if (!n) return departements;
    const rang = (d) => {
      const { sigle, intitule } = decouper(d.name);
      const s = plat(sigle || '');
      if (s && s === n) return 0;
      if (s && s.startsWith(n)) return 1;
      if (plat(intitule).split(/[\s'’-]+/).some((m) => m.startsWith(n))) return 2;
      return plat(d.name).includes(n) ? 3 : 9;
    };
    return departements.map((d, i) => ({ d, i, r: rang(d) })).filter((x) => x.r < 9)
      .sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.d);
  }, [q, departements]);
  // Rien ne correspond : le département manque, on propose de le créer.
  const peutCreer = creation && plat(q).length >= 2 && !trouves.length;
  const options = [...trouves.map((d) => ({ type: 'departement', d })), ...(peutCreer ? [{ type: 'creer' }] : [])];

  useEffect(() => { setActif(0); }, [q]);
  useEffect(() => {
    if (!ouvert) { setQ(''); setSaisieLibre(false); return undefined; }
    const t = setTimeout(() => recherche.current?.focus(), 40);
    // Le département déjà choisi est mis en avant à l'ouverture.
    const i = valeur && !valeur.nouveau ? departements.findIndex((d) => d.name === valeur.name) : -1;
    setActif(i >= 0 ? i : 0);
    return () => clearTimeout(t);
  }, [ouvert, valeur, departements]);

  // Un clic hors du menu le referme.
  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e) => { if (!racine.current?.contains(e.target)) setOuvert(false); };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, [ouvert]);

  useEffect(() => {
    if (ouvert) document.getElementById(`${id}-opt-${actif}`)?.scrollIntoView({ block: 'nearest' });
  }, [actif, ouvert, id]);

  // Sur un petit écran, le menu ouvert est ramené dans la fenêtre.
  useEffect(() => {
    if (!monte || !ouvert) return undefined;
    const r = requestAnimationFrame(() => {
      const doux = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      panneau.current?.scrollIntoView({ block: 'nearest', behavior: doux ? 'smooth' : 'auto' });
    });
    return () => cancelAnimationFrame(r);
  }, [monte, ouvert]);

  const choisir = (opt) => {
    if (!opt) return;
    if (opt.type === 'creer') onChange({ name: q.trim().replace(/\s+/g, ' '), nouveau: true });
    else onChange({ name: opt.d.name });
    setOuvert(false);
    declencheur.current?.focus();
  };

  const clavier = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActif((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActif((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choisir(options[actif]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOuvert(false); declencheur.current?.focus(); }
    else if (e.key === 'Tab') setOuvert(false);
  };

  const choisi = valeur ? decouper(valeur.name) : null;
  // Cascade à l'ouverture seulement : pendant la frappe, la liste se filtre sans attendre.
  const cascade = (i) => (q ? undefined : { animationDelay: `${60 + Math.min(i, 12) * 28}ms` });

  return (
    <div ref={racine} className="relative">
      <button ref={declencheur} type="button" aria-haspopup="listbox" aria-expanded={ouvert} aria-controls={`${id}-liste`}
        aria-label={choisi ? `Département : ${valeur.name}. Changer` : 'Choisir votre département'}
        onClick={() => setOuvert((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOuvert(true); } }}
        className={`group w-full flex items-center gap-3 rounded-lg border bg-white px-3.5 py-3 text-left transition-[border-color,box-shadow,transform] duration-200 active:scale-[0.995] ${
          ouvert ? 'border-[#2C9C0A]' : 'border-slate-200 hover:border-slate-400'}`}>
        {choisi
          ? <Sigle key={valeur.name} sigle={choisi.sigle} rebond />
          : <span className="h-11 w-11 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0 transition-colors group-hover:text-slate-500"><Building2 size={18} /></span>}
        <span className="min-w-0 flex-1">
          {choisi ? (
            <span key={valeur.name} className="block animate-fade-in-left">
              <span className="block font-bold text-slate-900 leading-snug">
                {choisi.intitule}
                {valeur.nouveau && <span className="ml-2 align-middle text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">nouveau</span>}
              </span>
              {choisi.sigle && <span className="block text-xs font-semibold text-slate-400">Département {choisi.sigle}</span>}
            </span>
          ) : (
            <span className="block font-semibold text-slate-400">Votre département</span>
          )}
        </span>
        <ChevronDown size={20} className={`flex-shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${ouvert ? 'rotate-180' : 'text-slate-400'}`}
          style={ouvert ? { color: VERT } : undefined} />
      </button>

      {monte && (
        <div ref={panneau} className={`absolute z-30 left-0 right-0 mt-2 origin-top rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-400/25 overflow-hidden transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
          visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-2 scale-[0.97]'}`}>
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input ref={recherche} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={clavier}
                role="combobox" aria-expanded="true" aria-controls={`${id}-liste`} aria-autocomplete="list"
                aria-activedescendant={options[actif] ? `${id}-opt-${actif}` : undefined} aria-label="Rechercher un département"
                placeholder={saisieLibre ? 'Tapez le nom de votre département' : creation ? 'Rechercher ou saisir un nom' : 'Rechercher un département'}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-50 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-green-100 transition-colors" />
            </div>
          </div>

          <ul id={`${id}-liste`} role="listbox" aria-label="Départements" className="max-h-[min(20rem,50vh)] overflow-y-auto overscroll-contain p-1.5">
            {options.map((opt, i) => {
              const surbrillance = i === actif;
              if (opt.type === 'creer') {
                return (
                  <li key="creer" id={`${id}-opt-${i}`} role="option" aria-selected="false"
                    onMouseEnter={() => setActif(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choisir(opt)}
                    className={`mt-1 flex items-center gap-3 rounded-xl px-2.5 py-2 cursor-pointer border border-dashed transition-colors animate-fade-in-up ${surbrillance ? 'bg-green-50 border-green-300' : 'border-slate-200'}`}>
                    <span className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${VERT}14`, color: VERT }}><Plus size={16} /></span>
                    <span className="min-w-0 text-sm">
                      <span className="block font-bold text-slate-800 truncate">Créer « {q.trim()} »</span>
                      <span className="block text-xs text-slate-400">Il rejoindra la liste des départements de l'AFGC</span>
                    </span>
                  </li>
                );
              }
              const { sigle, intitule } = decouper(opt.d.name);
              const selectionne = !valeur?.nouveau && valeur?.name === opt.d.name;
              return (
                <li key={opt.d.id} id={`${id}-opt-${i}`} role="option" aria-selected={selectionne}
                  onMouseEnter={() => setActif(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choisir(opt)}
                  style={cascade(i)}
                  className={`flex items-center gap-3 rounded-xl px-2.5 py-2 cursor-pointer transition-colors animate-fade-in-up ${surbrillance ? 'bg-green-50' : ''}`}>
                  <Sigle sigle={sigle} petit />
                  <span className={`flex-1 text-sm leading-snug ${selectionne ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                    <Surligne texte={intitule} q={q} />
                    {sigle && plat(q) && plat(sigle).includes(plat(q)) && <span className="ml-1.5 text-xs text-slate-400">({sigle})</span>}
                  </span>
                  <Check size={16} className={`flex-shrink-0 transition-all duration-200 ${selectionne ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} style={{ color: VERT }} />
                </li>
              );
            })}
            {!options.length && (
              <li className="px-3 py-6 text-center text-sm text-slate-400 animate-fade-in">
                Aucun département ne correspond{creation ? '.' : '. Adressez-vous au service des archives.'}
              </li>
            )}
          </ul>

          {creation && !q && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setSaisieLibre(true); recherche.current?.focus(); }}
              className="w-full border-t border-slate-100 px-4 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 hover:bg-green-50/60 inline-flex items-center justify-center gap-2 transition-colors">
              <Plus size={15} /> Mon département n'est pas dans la liste
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ChoixDepartement;
