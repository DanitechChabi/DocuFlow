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

/** Une étiquette bien visible : « SEMAINE  ven. 17 → jeu. 23 avr. 2026 ». */
const Etiquette = ({ titre, children, ton }) => (
  <span className={`inline-flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1 ${ton}`}>
    <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">{titre}</span>
    <span className="text-sm font-black">{children}</span>
  </span>
);

const Detail = ({ e, archiviste }) => (
  <span className="flex flex-wrap gap-1.5">
    <Etiquette titre="Semaine" ton="bg-white border-green-300 text-green-900">{semaineLisible(e.semaine, e.au).replace(/^du /, '').replace(' au ', ' → ')}</Etiquette>
    <Etiquette titre="Point du" ton="bg-amber-50 border-amber-300 text-amber-900">{jourLisible(e.date_point)}</Etiquette>
    {archiviste && e.lettre && <Etiquette titre="Lettre" ton="bg-docuflow-secondary border-docuflow-secondary text-white">{e.lettre}</Etiquette>}
    {archiviste && e.armoire && <Etiquette titre="Armoire" ton="bg-violet-600 border-violet-600 text-white">{e.armoire}</Etiquette>}
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
      <div className={`animate-fade-in-up flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 ${className}`}>
        <SearchX size={16} className="flex-shrink-0 text-slate-500" />
        <span>Pas trouvé dans les entrées des archives{archiviste ? '' : ' — l\'archive vérifiera'}.</span>
      </div>
    );
  }
  const [e, ...autres] = entrees;
  const douteux = !e.nom_concorde;
  return (
    // Nouvelle clé à chaque nouveau résultat : la lumière rejoue.
    <div key={`${e.date_point}-${e.num_actes}-${e.denomination}`}
      className={`resultat-lumiere ${douteux ? 'ambre border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'} rounded-xl border-2 px-3 py-2.5 ${className}`}>
      <div className={`flex items-start gap-2 ${douteux ? 'text-amber-900' : 'text-green-900'}`}>
        <span className={`lumiere-pastille mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-white ${douteux ? 'bg-amber-500' : 'bg-docuflow-secondary'}`}>
          {douteux ? <AlertTriangle size={15} /> : <Archive size={15} />}
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-sm leading-snug">
            {douteux
              ? <><strong className="font-black">À vérifier</strong> : acte {e.num_actes} entré au nom de « <strong>{e.denomination}</strong> »</>
              : <><strong className="font-black text-base">Aux archives</strong>{archiviste || total > 1 ? <span className="font-semibold"> — {e.denomination}{archiviste && e.num_actes ? `, acte ${e.num_actes}` : ''}</span> : null}</>}
          </div>
          <Detail e={e} archiviste={archiviste} />
          {total > 1 && (
            <button type="button" onClick={() => setOuvert((v) => !v)} className="text-sm font-bold underline decoration-dotted inline-flex items-center gap-1">
              {total - 1} autre{total > 2 ? 's' : ''} entrée{total > 2 ? 's' : ''} <ChevronDown size={13} className={ouvert ? 'rotate-180' : ''} />
            </button>
          )}
        </div>
      </div>
      {ouvert && autres.length > 0 && (
        <ul className="mt-2 ml-9 space-y-2 text-sm text-slate-800 animate-fade-in-up">
          {autres.map((x) => (
            <li key={`${x.date_point}-${x.num_actes}-${x.denomination}`}>
              <div className="font-semibold">{x.denomination}{x.num_actes ? `, acte ${x.num_actes}` : ''}{!x.nom_concorde && <span className="text-amber-700"> (autre nom)</span>}</div>
              <Detail e={x} archiviste={archiviste} />
            </li>
          ))}
          {archiviste && total > entrees.length && <li className="text-slate-600">… et {total - entrees.length} de plus (Entrée des dossiers → Rechercher)</li>}
        </ul>
      )}
    </div>
  );
};
