import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Plus, Search, Printer, Inbox, Send, AlertTriangle, UserCheck, Lock, Zap, Loader2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import PastilleStatut from '../components/courrier/PastilleStatut';
import { courrierService, SENS, dateFr } from '../services/courrierService';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Courrier — le registre du bureau d'ordre (migration 041). Les vues sont des
 * filtres du même registre : ce qui m'attend, ce qui reste à affecter, les
 * retards. Chacun n'y voit que son périmètre (courrierService, côté serveur).
 */
const Chiffre = ({ icone: Icone, valeur, libelle, ton, actif, onClick }) => (
  <button type="button" onClick={onClick}
    className={`glass-card-premium p-4 text-left transition-shadow hover:shadow-elevated ${actif ? 'ring-2 ring-docuflow-secondary' : ''}`}>
    <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5"><Icone size={13} /> {libelle}</p>
    <p className={`text-2xl font-black mt-1 ${ton}`}>{valeur ?? '—'}</p>
  </button>
);

const CourrierPage = () => {
  useTitrePage('Courrier');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const vue = params.get('vue') || 'tous';
  const sens = params.get('sens') || '';
  const q = params.get('q') || '';
  const page = Number(params.get('page')) || 1;
  const [saisie, setSaisie] = useState(q);
  const [syn, setSyn] = useState(null);
  const [liste, setListe] = useState(null);

  const regler = (cle, valeur) => {
    const p = new URLSearchParams(params);
    if (valeur) p.set(cle, valeur); else p.delete(cle);
    if (cle !== 'page') p.delete('page');
    setParams(p, { replace: true });
  };

  useEffect(() => { courrierService.synthese().then(setSyn).catch(() => setSyn({})); }, []);
  const charger = useCallback(() => {
    setListe(null);
    courrierService.lister({ vue, sens: sens || undefined, q: q || undefined, page }).then(setListe).catch(() => setListe({ courriers: [], total: 0 }));
  }, [vue, sens, q, page]);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => {
    const t = setTimeout(() => { if (saisie !== q) regler('q', saisie.trim()); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saisie]);

  const peutEnregistrer = syn?.droits?.enregistrer;
  const registre = syn?.droits?.registre;
  const pages = liste ? Math.ceil(liste.total / liste.taille) : 0;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Courrier"
        subtitle="Le registre du courrier arrivée, départ et interne"
        icon={Mail}
        breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Courrier' }]}
        actions={(
          <div className="flex items-center gap-2">
            {registre && <Link to={`/courrier/registre${sens ? `?sens=${sens}` : ''}`} className="btn-secondary flex items-center gap-1.5"><Printer size={15} /> Registre</Link>}
            {peutEnregistrer && <Link to="/courrier/nouveau" className="btn-primary flex items-center gap-1.5" data-tour="courrier-nouveau"><Plus size={16} /> Enregistrer un courrier</Link>}
          </div>
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5" data-tour="courrier-synthese">
        <Chiffre icone={UserCheck} valeur={syn?.a_moi} libelle="À traiter par moi" ton="text-docuflow-secondary" actif={vue === 'a_moi'} onClick={() => regler('vue', vue === 'a_moi' ? '' : 'a_moi')} />
        {registre && <Chiffre icone={Inbox} valeur={syn?.a_affecter} libelle="À affecter" ton="text-amber-600" actif={vue === 'a_affecter'} onClick={() => regler('vue', vue === 'a_affecter' ? '' : 'a_affecter')} />}
        <Chiffre icone={AlertTriangle} valeur={syn?.en_retard} libelle="En retard" ton={syn?.en_retard ? 'text-red-600' : 'text-slate-900'} actif={vue === 'en_retard'} onClick={() => regler('vue', vue === 'en_retard' ? '' : 'en_retard')} />
        <div className="glass-card-premium p-4">
          <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5"><Send size={13} /> Ce mois-ci</p>
          <p className="text-sm font-bold text-slate-800 mt-2">{syn?.arrivees_mois ?? '—'} arrivée(s) · {syn?.departs_mois ?? '—'} départ(s)</p>
          {syn?.delai_reponse_jours != null && <p className="text-xs text-slate-500">Réponse en {syn.delai_reponse_jours} j en moyenne</p>}
        </div>
      </div>

      <div className="glass-card-premium overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-100">
          <div className="flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Sens du courrier">
            {[['', 'Tout'], ['arrivee', 'Arrivée'], ['depart', 'Départ'], ['interne', 'Interne']].map(([cle, libelle]) => (
              <button key={cle} type="button" role="tab" aria-selected={sens === cle} onClick={() => regler('sens', cle)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${sens === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{libelle}</button>
            ))}
          </div>
          {vue !== 'tous' && (
            <button type="button" onClick={() => regler('vue', '')} className="px-2.5 py-1 rounded-full bg-blue-50 text-docuflow-secondary text-xs font-bold">
              {{ a_moi: 'À traiter par moi', a_affecter: 'À affecter', en_retard: 'En retard', copies: 'En copie' }[vue]} ✕
            </button>
          )}
          <div className="relative ml-auto w-full sm:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input-premium pl-9" placeholder="Numéro, objet, correspondant…" value={saisie} onChange={(e) => setSaisie(e.target.value)} aria-label="Rechercher un courrier" />
          </div>
        </div>
        {liste === null ? <div className="p-16 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto" /></div>
          : liste.courriers.length === 0 ? (
            <div className="p-14 text-center">
              <Mail size={32} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-600">{q || vue !== 'tous' || sens ? 'Aucun courrier ne correspond.' : 'Le registre est vide.'}</p>
              {peutEnregistrer && !q && vue === 'tous' && <Link to="/courrier/nouveau" className="btn-primary inline-flex items-center gap-1.5 mt-4"><Plus size={15} /> Enregistrer le premier courrier</Link>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-3">Numéro</th><th className="px-4 py-3">Objet</th><th className="px-4 py-3">Correspondant</th>
                    <th className="px-4 py-3">Chargé</th><th className="px-4 py-3">Échéance</th><th className="px-4 py-3">État</th>
                  </tr>
                </thead>
                <tbody>
                  {liste.courriers.map((c) => (
                    <tr key={c.id} onClick={() => navigate(`/courrier/${c.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/courrier/${c.id}`)}
                      className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50 cursor-pointer focus:outline-none focus:bg-blue-50/50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-bold text-slate-800 font-mono text-[13px]">{c.numero}</span>
                        <span className="block text-[11px] text-slate-400">{SENS[c.sens]} · {new Date(c.created_at).toLocaleDateString('fr-FR')}</span>
                      </td>
                      <td className="px-4 py-3 max-w-[340px]">
                        <span className="font-semibold text-slate-800 line-clamp-2">{c.objet}</span>
                        <span className="flex gap-1.5 mt-0.5">
                          {c.urgent && <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-red-600"><Zap size={11} /> Urgent</span>}
                          {c.confidentiel && <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-slate-500"><Lock size={11} /> Confidentiel</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3"><span className="text-slate-700">{c.correspondant}</span>{c.organisme && <span className="block text-[11px] text-slate-400">{c.organisme}</span>}</td>
                      <td className="px-4 py-3 text-slate-600">{c.assigne_nom || <span className="text-slate-300">—</span>}</td>
                      <td className={`px-4 py-3 whitespace-nowrap ${c.en_retard ? 'text-red-600 font-bold' : 'text-slate-600'}`}>{c.echeance ? dateFr(c.echeance) : <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3"><PastilleStatut c={c} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {pages > 1 && (
          <div className="p-3 flex items-center justify-between border-t border-slate-100 text-xs text-slate-500">
            <span>{liste.total} courrier(s)</span>
            <span className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => regler('page', String(page - 1))} className="btn-secondary disabled:opacity-40">Précédent</button>
              Page {page} / {pages}
              <button type="button" disabled={page >= pages} onClick={() => regler('page', String(page + 1))} className="btn-secondary disabled:opacity-40">Suivant</button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default CourrierPage;
