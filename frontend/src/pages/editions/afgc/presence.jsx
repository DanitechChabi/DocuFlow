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
  <>
    semaine <strong>{semaineLisible(e.semaine, e.au)}</strong> · point du <strong>{jourLisible(e.date_point)}</strong>
    {archiviste && e.lettre && <> · lettre <strong>{e.lettre}</strong></>}
  </>
);

/**
 * Le résultat : « Aux archives · semaine du … · point du … », « Pas trouvé
 * dans les entrées », ou, pour un n° d'acte entré sous un autre nom, à vérifier.
 * `archiviste` ajoute la lettre de classement et le n° d'acte tel qu'écrit.
 */
export const Presence = ({ resultat, archiviste = false, className = '' }) => {
  const [ouvert, setOuvert] = useState(false);
  if (!resultat?.recherche) return null;
  const { total, entrees } = resultat;
  if (!total) {
    return (
      <div className={`flex items-start gap-1.5 text-xs text-slate-500 ${className}`}>
        <SearchX size={13} className="mt-0.5 flex-shrink-0" />
        <span>Pas trouvé dans les entrées des archives{archiviste ? '' : ' — l\'archive vérifiera'}.</span>
      </div>
    );
  }
  const [e, ...autres] = entrees;
  const douteux = !e.nom_concorde;
  return (
    <div className={`text-xs ${className}`}>
      <div className={`flex items-start gap-1.5 ${douteux ? 'text-amber-700' : 'text-green-800'}`}>
        {douteux ? <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> : <Archive size={13} className="mt-0.5 flex-shrink-0" />}
        <span className="min-w-0">
          {douteux
            ? <>Acte {e.num_actes} entré au nom de « {e.denomination} » — à vérifier · </>
            : <><strong>Aux archives</strong>{archiviste || total > 1 ? <> ({e.denomination}{archiviste && e.num_actes ? `, acte ${e.num_actes}` : ''})</> : null} · </>}
          <Detail e={e} archiviste={archiviste} />
          {total > 1 && (
            <button type="button" onClick={() => setOuvert((v) => !v)} className="ml-1.5 font-bold underline decoration-dotted inline-flex items-center gap-0.5">
              {total - 1} autre{total > 2 ? 's' : ''} entrée{total > 2 ? 's' : ''} <ChevronDown size={11} className={ouvert ? 'rotate-180' : ''} />
            </button>
          )}
        </span>
      </div>
      {ouvert && autres.length > 0 && (
        <ul className="mt-1 ml-5 space-y-0.5 text-slate-600">
          {autres.map((x) => (
            <li key={`${x.date_point}-${x.num_actes}-${x.denomination}`}>
              {x.denomination}{x.num_actes ? `, acte ${x.num_actes}` : ''} · <Detail e={x} archiviste={archiviste} />
              {!x.nom_concorde && <span className="text-amber-700"> (autre nom)</span>}
            </li>
          ))}
          {archiviste && total > entrees.length && <li className="text-slate-400">… et {total - entrees.length} de plus (Entrée des dossiers → Rechercher)</li>}
        </ul>
      )}
    </div>
  );
};
