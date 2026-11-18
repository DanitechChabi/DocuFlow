import React, { useState, useEffect, useMemo } from 'react';
import { BookMarked, Search, Printer } from 'lucide-react';
import api from '../../../services/api';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, Chargement } from './elements';

// ============================================================================
// Plan de classement et calendrier de conservation de l'AFGC (validés le 30
// octobre 2026) : chaque rubrique avec sa cote, sa consigne de classement et
// sa règle (durée au bureau, en archivage, sort final). Recherche par mot ou
// par cote ; imprimable.
// ============================================================================

const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const Sort = ({ sort }) => (sort ? (
  <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${sort === 'C' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}
    title={sort === 'C' ? 'Conservation définitive' : 'Élimination'}>
    {sort === 'C' ? 'Conservation' : 'Élimination'}
  </span>
) : null);

const PlanClassementAfgc = () => {
  useTitrePage('Plan de classement');
  const [plan, setPlan] = useState(null);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('tous');

  useEffect(() => { api.get('/plan-classement').then((r) => setPlan(r.data)).catch(() => setPlan({ departements: [], rubriques: [] })); }, []);

  const visibles = useMemo(() => {
    if (!plan) return [];
    const mots = sansAccents(q).split(/\s+/).filter(Boolean);
    return plan.rubriques.filter((r) => (dept === 'tous' || r.departement === dept)
      && mots.every((m) => sansAccents(`${r.cote} ${r.intitule} ${r.consigne || ''} ${r.observations || ''}`).includes(m)));
  }, [plan, q, dept]);

  if (!plan) return <div className="p-8"><Chargement /></div>;
  const nomDept = Object.fromEntries(plan.departements.map((d) => [d.code, d.nom]));
  const groupes = plan.departements.map((d) => ({ ...d, rubriques: visibles.filter((r) => r.departement === d.code) })).filter((g) => g.rubriques.length);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <EnTete titre="Plan de classement" icone={BookMarked}
        aide="Plan de classement et calendrier de conservation des archives, validés par le Directeur général le 30 octobre 2026. Chaque cote dit où classer un document, combien de temps le garder et son sort final.">
        <button type="button" onClick={() => window.print()} className="px-4 py-2.5 rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-800 inline-flex items-center gap-2 print:hidden">
          <Printer size={16} /> Imprimer
        </button>
      </EnTete>

      <div className="flex flex-wrap gap-2 mb-5 print:hidden">
        <div className="relative flex-1 min-w-60">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Un document (« contrats de travail », « PV »…) ou une cote (« 1B »)"
            className="w-full pl-10 pr-3 py-2.5 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-slate-500" />
        </div>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className="px-3 py-2.5 rounded-md border border-slate-300 text-sm bg-white">
          <option value="tous">Tous les départements</option>
          {plan.departements.map((d) => <option key={d.code} value={d.code}>{d.code} — {d.nom}</option>)}
        </select>
      </div>

      {groupes.length === 0 ? <p className="text-sm text-slate-500">Aucune rubrique ne correspond.</p> : groupes.map((g) => (
        <section key={g.code} className="mb-6 rounded-lg border border-slate-200 bg-white break-inside-avoid-page">
          <h2 className="px-4 py-2.5 border-b border-slate-200 text-sm font-bold text-slate-900">{g.code} — {nomDept[g.code]}</h2>
          <ul className="divide-y divide-slate-100">
            {g.rubriques.map((r, i) => (
              <li key={`${r.cote}-${i}`} className={`px-4 py-2.5 grid gap-x-4 gap-y-0.5 md:grid-cols-[5rem_1fr_17rem] ${r.parent ? '' : 'bg-slate-50/60'}`}>
                <span className={`font-mono text-sm ${r.parent ? 'text-slate-600 pl-3' : 'font-bold text-slate-900'}`}>{r.cote || '—'}</span>
                <div className="min-w-0">
                  <div className={`text-sm ${r.parent ? 'text-slate-800' : 'font-semibold text-slate-900'}`}>{r.intitule}</div>
                  {r.consigne && <div className="text-xs text-slate-500">{r.consigne}</div>}
                  {r.observations && <div className="text-xs text-amber-800 mt-0.5">{r.observations}</div>}
                </div>
                <div className="text-xs text-slate-700">
                  {r.sort ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{r.bureau && r.bureau !== '-' ? `${r.bureau} bureau · ` : ''}{r.archivage} archivage</span>
                      <Sort sort={r.sort} />
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

export default PlanClassementAfgc;
