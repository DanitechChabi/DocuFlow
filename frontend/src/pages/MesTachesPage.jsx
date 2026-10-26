import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ListChecks, Clock, CheckCircle2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import DecisionTache from '../components/circuits/DecisionTache';
import { circuitService, quand } from '../services/circuitService';
import { useTitrePage } from '../hooks/useTitrePage';
import { toast } from '../components/Toast';

/**
 * « Mes tâches » (migration 034) : les visas et prises de connaissance qui
 * m'attendent dans les circuits de validation, les retards d'abord ; et mes
 * dernières décisions.
 */
const MesTachesPage = () => {
  useTitrePage('Mes tâches');
  const [params, setParams] = useSearchParams();
  const vue = params.get('vue') === 'traitees' ? 'traitees' : 'a_traiter';
  const [taches, setTaches] = useState(null);

  const charger = useCallback(() => {
    setTaches(null);
    circuitService.mesTaches(vue).then(setTaches).catch((err) => { toast.error(err.response?.data?.message || 'Chargement impossible'); setTaches([]); });
    window.dispatchEvent(new Event('docuflow:taches'));
  }, [vue]);
  useEffect(() => { charger(); }, [charger]);

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1100px] mx-auto">
      <PageHeader title="Mes tâches" subtitle="Les documents qui attendent votre visa dans les circuits de validation"
        icon={ListChecks} breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Mes tâches' }]} />
      <div className="segmented mb-5">
        <button type="button" aria-pressed={vue === 'a_traiter'} onClick={() => setParams({}, { replace: true })}>À traiter</button>
        <button type="button" aria-pressed={vue === 'traitees'} onClick={() => setParams({ vue: 'traitees' }, { replace: true })}>Traitées</button>
      </div>
      {taches === null ? <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-2xl skeleton" />)}</div>
        : taches.length === 0 ? (
          <div className="glass-card-premium p-12 text-center">
            <CheckCircle2 size={36} className="mx-auto text-emerald-500 mb-3" />
            <p className="font-bold text-slate-800">{vue === 'a_traiter' ? 'Rien à viser pour l\'instant' : 'Aucune décision récente'}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {taches.map((t) => (
              <li key={t.id} className={`glass-card-premium p-4 space-y-2 ${t.en_retard ? 'border-l-4 border-red-400' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    {t.peut_ouvrir
                      ? <Link to={`/documents/liste?doc=${t.document_id}`} className="font-bold text-docuflow-secondary hover:underline">{t.reference}</Link>
                      : <span className="font-bold text-slate-800">{t.reference}</span>}
                    <p className="text-xs text-slate-500 truncate">{t.nom_entreprise}{t.classe_nom ? ` · ${t.classe_nom}` : ''} · version {t.document_version}</p>
                  </div>
                  {t.echeance_at && vue === 'a_traiter' && (
                    <span className={`text-xs font-semibold flex items-center gap-1 ${t.en_retard ? 'text-red-600' : 'text-slate-500'}`}>
                      <Clock size={12} /> {t.en_retard ? 'En retard depuis le' : 'Avant le'} {quand(t.echeance_at)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-700">« {t.circuit_nom} » · étape {t.etape_rang}/{t.nb_etapes} : <strong>{t.etape_libelle}</strong>
                  {t.pour_le_compte_de ? ` (pour le compte de ${t.pour_le_compte_de})` : ''}</p>
                <p className="text-xs text-slate-400">Lancé par {t.demarre_par_nom || '—'} le {quand(t.demarre_at)}</p>
                {vue === 'a_traiter'
                  ? <DecisionTache tache={t} onDone={charger} />
                  : <p className="text-xs text-slate-600">{t.statut} le {quand(t.traite_at)}{t.commentaire ? ` — « ${t.commentaire} »` : ''}</p>}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
};

export default MesTachesPage;
