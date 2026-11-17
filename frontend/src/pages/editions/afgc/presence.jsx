import React, { useEffect, useMemo, useState } from 'react';
import { Archive, AlertTriangle, SearchX, ChevronDown } from 'lucide-react';
import { entreeService } from '../../../services/entreeService';

// ============================================================================
// Présence d'un dossier aux archives : entré ou non, et QUAND — la semaine
// de production (vendredi → jeudi) et la date exacte du point. C'est ce que
// l'archiviste suit pour aller le chercher ; le demandeur le voit en demandant.
// ============================================================================

const date = (iso, options) => {
  const [a, m, j] = String(iso || '').split('-').map(Number);
  return a ? new Date(Date.UTC(a, m - 1, j)).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...options }) : '';
};

/** « mar. 5 janv. 2026 » */
export const jourLisible = (iso) => date(iso, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** « du ven. 2 au jeu. 8 janv. 2026 » (le mois et l'année du début seulement s'ils diffèrent). */
export const semaineLisible = (debut, au) => {
  const [a1, m1] = String(debut).split('-');
  const [a2, m2] = String(au).split('-');
  const opt = a1 !== a2 ? { year: 'numeric', month: 'short' } : m1 !== m2 ? { month: 'short' } : {};
  return `du ${date(debut, { weekday: 'short', day: 'numeric', ...opt })} au ${jourLisible(au)}`;
};

const cleDe = (d) => [d.nom_entreprise, d.num_acte, d.annee].map((x) => String(x ?? '').trim()).join('|');
const cherchable = (d) => Boolean(String(d?.num_acte ?? '').trim()) || String(d?.nom_entreprise ?? '').trim().length >= 3;

/** Présence de plusieurs dossiers (une demande par dossier, identifiée par son id). */
export function usePresences(dossiers) {
  const [res, setRes] = useState({});
  // Ne relancer que si les dossiers changent vraiment.
  const signature = useMemo(() => (dossiers || []).filter(cherchable).map((d) => `${d.id}:${cleDe(d)}`).join('¤'), [dossiers]);
  useEffect(() => {
    const liste = (dossiers || []).filter(cherchable).slice(0, 200);
    if (!liste.length) { setRes({}); return undefined; }
    let actif = true;
    entreeService.presences(liste.map((d) => ({ cle: d.id, nom_entreprise: d.nom_entreprise, num_acte: d.num_acte, annee: d.annee })))
      .then((r) => { if (actif) setRes(r || {}); })
      .catch(() => { if (actif) setRes({}); });
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return res;
}

/** Présence d'un dossier en cours de saisie (attente de 400 ms entre deux frappes). */
export function usePresence(dossier) {
  const [res, setRes] = useState(null);
  const cle = dossier && cherchable(dossier) ? cleDe(dossier) : '';
  useEffect(() => {
    if (!cle) { setRes(null); return undefined; }
    let actif = true;
    const minuteur = setTimeout(() => {
      entreeService.presence({ nom_entreprise: dossier.nom_entreprise || '', num_acte: dossier.num_acte || '', annee: dossier.annee || '' })
        .then((r) => { if (actif) setRes({ cle, ...r }); })
        .catch(() => { if (actif) setRes(null); });
    }, 400);
    return () => { actif = false; clearTimeout(minuteur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);
  return res && res.cle === cle ? res : null;
}

const Detail = ({ e, archiviste }) => (
  <span className="text-sm text-slate-700">
    Semaine {semaineLisible(e.semaine, e.au)}, point du <strong className="text-slate-900">{jourLisible(e.date_point)}</strong>
    {archiviste && e.lettre && <>, lettre <strong className="text-slate-900">{e.lettre}</strong></>}
    {archiviste && e.armoire && <>, <strong className="text-slate-900">{e.armoire.split(' · ')[0]}{e.armoire.includes(' ou ') ? ` ou ${e.armoire.split(' ou ')[1].split(' · ')[0]}` : ''}</strong></>}
  </span>
);

/**
 * Le résultat : « Aux archives » avec la semaine et la date du point, « Pas
 * trouvé dans les entrées », ou, pour un n° d'acte entré sous un autre nom,
 * à vérifier. Il s'allume à son arrivée (lumière, halo). `archiviste` ajoute
 * la lettre de classement et le n° d'acte tel qu'écrit.
 */
export const Presence = ({ resultat, archiviste = false, className = '' }) => {
  const [ouvert, setOuvert] = useState(false);
  if (!resultat?.recherche) return null;
  const { total, entrees } = resultat;
  if (!total) {
    return (
      <div className={`flex items-center gap-2 border-l-4 border-slate-300 bg-slate-50 rounded-r-md px-3 py-2 text-sm text-slate-700 ${className}`}>
        <SearchX size={16} className="flex-shrink-0 text-slate-500" />
        <span>Pas trouvé dans les entrées des archives{archiviste ? '' : ' : l\'archive vérifiera'}.</span>
      </div>
    );
  }
  const [e, ...autres] = entrees;
  const douteux = !e.nom_concorde;
  return (
    // Nouvelle clé à chaque nouveau résultat : la lumière rejoue.
    <div key={`${e.date_point}-${e.num_actes}-${e.denomination}`}
      className={`animate-fade-in border-l-4 ${douteux ? 'border-amber-500 bg-amber-50/70' : 'border-[#2C9C0A] bg-slate-50'} rounded-r-md px-3 py-2 ${className}`}>
      <div className={`flex items-start gap-2 ${douteux ? 'text-amber-900' : 'text-slate-900'}`}>
        {douteux ? <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" /> : <Archive size={15} className="mt-0.5 flex-shrink-0 text-[#2C9C0A]" />}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-sm leading-snug">
            {e.approche
              ? <><strong className="font-bold">Nom proche, à vérifier</strong> : « <strong>{e.denomination}</strong> »{archiviste && e.num_actes ? `, acte ${e.num_actes}` : ''}</>
              : douteux
              ? <><strong className="font-bold">À vérifier</strong> : acte {e.num_actes} entré au nom de « <strong>{e.denomination}</strong> »</>
              : <><strong className="font-bold">Aux archives</strong>{archiviste || total > 1 ? <span className="font-semibold"> : {e.denomination}{archiviste && e.num_actes ? `, acte ${e.num_actes}` : ''}</span> : null}</>}
          </div>
          <Detail e={e} archiviste={archiviste} />
          {total > 1 && (
            <button type="button" onClick={() => setOuvert((v) => !v)} className="ml-2 text-sm font-semibold text-slate-600 underline decoration-dotted inline-flex items-center gap-1">
              {total - 1} autre{total > 2 ? 's' : ''} entrée{total > 2 ? 's' : ''} <ChevronDown size={13} className={ouvert ? 'rotate-180' : ''} />
            </button>
          )}
        </div>
      </div>
      {ouvert && autres.length > 0 && (
        <ul className="mt-2 ml-9 space-y-2 text-sm text-slate-800 animate-fade-in-up">
          {autres.map((x) => (
            <li key={`${x.date_point}-${x.num_actes}-${x.denomination}`}>
              <div className="font-semibold">{x.denomination}{x.num_actes ? `, acte ${x.num_actes}` : ''}{!x.nom_concorde && <span className="text-amber-700"> ({x.approche ? 'nom proche' : 'autre nom'})</span>}</div>
              <Detail e={x} archiviste={archiviste} />
            </li>
          ))}
          {archiviste && total > entrees.length && <li className="text-slate-600">… et {total - entrees.length} de plus (Entrée des dossiers → Rechercher)</li>}
        </ul>
      )}
    </div>
  );
};
