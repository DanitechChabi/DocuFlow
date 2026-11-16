import React, { useState, useEffect } from 'react';
import { BookOpenCheck, Search } from 'lucide-react';
import { listeService } from '../../../services/listeService';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, ChoixCadre, Pastille, Chargement } from './elements';
import { intitule, references, dateCourte } from './vocabulaire';

// ============================================================================
// Dossiers sortis : le registre des sorties, que l'on interroge — tout ce qui
// est sorti pour les soldes créditeurs, la Liste 3, une entreprise, un agent.
// ============================================================================

const ETATS = [
  ['', 'Tous'],
  ['en_cours', 'Transmis'],
  ['en_retard', 'En retard'],
  ['retourne', 'Retournés'],
];

const etatSortie = (p) => {
  if (p.etat === 'retourne') return { texte: 'Retourné', ton: 'gris' };
  if (p.etat === 'en_retard') return { texte: 'En retard', ton: 'rouge' };
  if (p.etat === 'signale') return { texte: 'Signalé', ton: 'ambre' };
  return { texte: 'Transmis', ton: 'vert' };
};

const SortiesAfgc = () => {
  useTitrePage('Dossiers sortis');
  const [cadres, setCadres] = useState([]);
  const [listes, setListes] = useState([]);
  const [filtres, setFiltres] = useState({ etat: '', cadre: '', liste: '', q: '' });
  const [saisie, setSaisie] = useState('');
  const [sorties, setSorties] = useState(null);

  useEffect(() => {
    listeService.cadres().then(setCadres).catch(() => setCadres([]));
    listeService.lister().then(setListes).catch(() => setListes([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setFiltres((f) => (f.q === saisie.trim() ? f : { ...f, q: saisie.trim() })), 300);
    return () => clearTimeout(t);
  }, [saisie]);

  useEffect(() => {
    setSorties(null);
    const params = Object.fromEntries(Object.entries(filtres).filter(([, v]) => v !== ''));
    listeService.sorties(params).then((l) => setSorties(Array.isArray(l) ? l : [])).catch(() => setSorties([]));
  }, [filtres]);

  const changer = (cle, valeur) => setFiltres((f) => ({ ...f, [cle]: valeur }));
  const listesDuCadre = listes.filter((l) => !filtres.cadre || l.cadre === filtres.cadre);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <EnTete titre="Dossiers sortis" icone={BookOpenCheck} aide="Qui a quel dossier, depuis quand, dans quel cadre et pour quand il doit revenir." />

      <div className="glass-card-premium rounded-3xl p-5 space-y-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex p-1 rounded-2xl bg-slate-100">
            {ETATS.map(([cle, label]) => (
              <button key={cle || 'tous'} type="button" onClick={() => changer('etat', cle)}
                className={`px-3.5 py-1.5 rounded-xl text-sm font-bold transition-colors ${filtres.etat === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
          <select value={filtres.liste} onChange={(e) => changer('liste', e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white text-slate-700" aria-label="Liste">
            <option value="">Toutes les listes</option>
            {listesDuCadre.map((l) => <option key={l.id} value={l.id}>{l.libelle} — {l.cadre}</option>)}
          </select>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={saisie} onChange={(e) => setSaisie(e.target.value)} placeholder="Entreprise, n° de dossier, n° d'acte, agent…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-docuflow-secondary" aria-label="Rechercher" />
          </div>
        </div>
        {cadres.length > 1 && <ChoixCadre cadres={cadres} valeur={filtres.cadre} onChange={(v) => setFiltres((f) => ({ ...f, cadre: v, liste: '' }))} tous />}
      </div>

      {sorties === null ? <Chargement /> : (
        <div className="glass-card-premium rounded-3xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 text-sm font-bold text-slate-500">
            {sorties.length} sortie{sorties.length > 1 ? 's' : ''}
            {sorties.length === 1000 && ' (les 1 000 plus récentes)'}
          </div>
          {sorties.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="px-5 py-2.5 font-black">Dossier</th>
                    <th className="px-3 py-2.5 font-black">Cadre</th>
                    <th className="px-3 py-2.5 font-black">Transmis à</th>
                    <th className="px-3 py-2.5 font-black">Le</th>
                    <th className="px-3 py-2.5 font-black">Retour prévu</th>
                    <th className="px-3 py-2.5 font-black">Retourné le</th>
                    <th className="px-5 py-2.5 font-black">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorties.map((p) => {
                    const e = etatSortie(p);
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3 max-w-[280px]">
                          <div className="font-semibold text-slate-800 truncate">{intitule(p)}</div>
                          <div className="text-xs text-slate-400 truncate">{references(p) || 'Sans référence'}</div>
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {p.cadre || '—'}
                          {p.liste_libelle && <div className="text-xs text-slate-400">{p.liste_libelle}</div>}
                        </td>
                        <td className="px-3 py-3 text-slate-600">{p.emprunteur_name || '—'}</td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{dateCourte(p.remis_at)}</td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{dateCourte(p.date_retour_prevue)}</td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{p.retourne_at ? dateCourte(p.retourne_at) : '—'}</td>
                        <td className="px-5 py-3"><Pastille ton={e.ton}>{e.texte}</Pastille></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-8 text-center text-sm text-slate-400">Aucune sortie pour ces critères.</p>}
        </div>
      )}
    </div>
  );
};

export default SortiesAfgc;
