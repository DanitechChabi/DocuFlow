import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Star, BellRing, MessageSquare, FileText } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { collaborationService } from '../services/collaborationService';
import { useTitrePage } from '../hooks/useTitrePage';
import { toast } from '../components/Toast';

/**
 * Mes favoris et documents suivis (migration 033) — les deux listes
 * personnelles de la collaboration, bornées au périmètre de l'utilisateur.
 */
const FavorisPage = () => {
  useTitrePage('Mes favoris');
  const [params, setParams] = useSearchParams();
  const vue = params.get('vue') === 'suivis' ? 'suivis' : 'favoris';
  const [docs, setDocs] = useState(null);

  const charger = useCallback(() => {
    setDocs(null);
    (vue === 'suivis' ? collaborationService.suivis() : collaborationService.favoris())
      .then(setDocs)
      .catch((err) => { toast.error(err.response?.data?.message || 'Chargement impossible'); setDocs([]); });
  }, [vue]);
  useEffect(() => { charger(); }, [charger]);

  const retirer = async (d) => {
    try {
      if (vue === 'suivis') await collaborationService.suivi(d.id, false);
      else await collaborationService.favori(d.id, false);
      setDocs((l) => l.filter((x) => x.id !== d.id));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action impossible');
    }
  };

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1100px] mx-auto">
      <PageHeader title="Mes favoris" subtitle="Vos documents marqués d'une étoile, et ceux que vous suivez"
        icon={Star} breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Mes favoris' }]} />
      <div className="segmented mb-5">
        <button type="button" aria-pressed={vue === 'favoris'} onClick={() => setParams({}, { replace: true })}><Star size={13} className="inline mr-1" /> Favoris</button>
        <button type="button" aria-pressed={vue === 'suivis'} onClick={() => setParams({ vue: 'suivis' }, { replace: true })}><BellRing size={13} className="inline mr-1" /> Suivis</button>
      </div>
      {docs === null ? <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-2xl skeleton" />)}</div>
        : docs.length === 0 ? (
          <div className="glass-card-premium p-12 text-center">
            {vue === 'suivis' ? <BellRing size={36} className="mx-auto text-slate-300 mb-3" /> : <Star size={36} className="mx-auto text-slate-300 mb-3" />}
            <p className="font-bold text-slate-800">{vue === 'suivis' ? 'Aucun document suivi' : 'Aucun favori'}</p>
            <p className="text-sm text-slate-500 mt-1">{vue === 'suivis'
              ? 'Depuis la fiche d\'un document, la cloche vous abonne : nouvelles versions, statut, commentaires.'
              : 'Depuis la fiche d\'un document, l\'étoile le garde à portée de main.'}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {docs.map((d) => (
              <li key={d.id} className="glass-card-premium p-4 flex items-center gap-3">
                <FileText size={18} className="text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <Link to={`/documents/liste?doc=${d.id}`} className="font-bold text-docuflow-secondary hover:underline">{d.reference_mfile}</Link>
                  <p className="text-xs text-slate-500 truncate">{d.nom_entreprise} · {d.type_document || 'Document'} · {d.annee}{d.dossier_name ? ` · ${d.dossier_name}` : ''}</p>
                </div>
                {d.nb_commentaires > 0 && <span className="text-xs text-slate-500 flex items-center gap-1"><MessageSquare size={12} /> {d.nb_commentaires}</span>}
                <button type="button" onClick={() => retirer(d)} className="btn btn-secondary btn-sm">{vue === 'suivis' ? 'Ne plus suivre' : 'Retirer'}</button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
};

export default FavorisPage;
