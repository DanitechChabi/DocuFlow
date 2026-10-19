import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles, Send, ExternalLink, Loader2, RefreshCw, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { requestService } from '../services/requestService';
import { usePermissions } from '../hooks/usePermissions';
import { toast } from './Toast';

/**
 * GedMatchPanel — « Ce document est-il déjà dans la GED ? » (migration 027).
 *
 * Affiché à l'archive (requests.process + documents.view) sur la fiche d'une
 * demande non close : les documents qui correspondent, avec leur score et ses
 * raisons, dans la limite des dossiers que l'utilisateur peut lire. « Transmettre
 * ce document » joint la version courante à la demande et la livre — le
 * dossier papier n'a pas à sortir.
 */
const ton = (score, seuil) => (score >= seuil
  ? { libelle: 'Très probable', classe: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  : { libelle: 'Possible', classe: 'bg-amber-50 text-amber-800 border-amber-200' });

const GedMatchPanel = ({ request, onDone }) => {
  const { can } = usePermissions();
  const visible = can('requests.process') && can('documents.view')
    && !['livré', 'rejete', 'annulé'].includes(request?.statut);

  const [etat, setEtat] = useState({ chargement: true, candidats: [], seuil: 60, indisponible: null });
  const [envoi, setEnvoi] = useState(null);

  const charger = useCallback(async () => {
    setEtat((e) => ({ ...e, chargement: true }));
    try {
      const r = await requestService.getGedMatches(request.id);
      setEtat({ chargement: false, candidats: r.candidats || [], seuil: r.seuilProbable || 60, indisponible: null });
    } catch (err) {
      setEtat({ chargement: false, candidats: [], seuil: 60, indisponible: err.response?.data?.message || 'Recherche indisponible' });
    }
  }, [request?.id]);

  useEffect(() => { if (visible) charger(); }, [visible, charger]);

  if (!visible) return null;

  const transmettre = async (c) => {
    if (!window.confirm(`Transmettre ${c.reference} au demandeur ? Une copie sera jointe à la demande, qui passera « Livré ».`)) return;
    setEnvoi(c.document_id);
    try {
      const r = await requestService.transmettreDepuisGed(request.id, c.document_id);
      toast.success(r.message || 'Document transmis');
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Transmission impossible');
    } finally {
      setEnvoi(null);
    }
  };

  return (
    <div className="space-y-2" data-tour="ged-matches">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-500 ml-1 flex items-center gap-1.5">
          <Sparkles size={13} /> Déjà dans la GED ?
        </label>
        <button onClick={charger} disabled={etat.chargement} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" title="Relancer la recherche">
          <RefreshCw size={14} className={etat.chargement ? 'animate-spin' : undefined} />
        </button>
      </div>

      {etat.chargement && !etat.candidats.length ? (
        <div className="h-16 rounded-xl skeleton" />
      ) : etat.indisponible ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">{etat.indisponible}</p>
      ) : !etat.candidats.length ? (
        <p className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3 flex items-center gap-2">
          <SearchX size={14} /> Aucun document correspondant dans les dossiers qui vous sont ouverts. Il faudra sans doute sortir le dossier papier.
        </p>
      ) : (
        <ul className="space-y-2">
          {etat.candidats.map((c) => {
            const t = ton(c.score, etat.seuil);
            return (
              <li key={c.document_id} className="p-3 rounded-xl border border-slate-200 bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{c.nom_entreprise && c.nom_entreprise !== 'À indexer' ? c.nom_entreprise : (c.description || c.reference)}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{c.reference}{c.annee ? ` · ${c.annee}` : ''}{c.type_document ? ` · ${c.type_document}` : ''}</p>
                  </div>
                  <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border ${t.classe}`} title={`Score ${c.score}/100`}>
                    {t.libelle} · {c.score}
                  </span>
                </div>
                <ul className="mt-1.5 text-[11px] text-slate-500 list-disc ml-4">
                  {c.raisons.map((r) => <li key={r}>{r}</li>)}
                </ul>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => transmettre(c)} disabled={envoi !== null}
                    className="btn-primary flex-1 flex items-center justify-center gap-1.5 py-2 text-xs">
                    {envoi === c.document_id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Transmettre ce document
                  </button>
                  <Link to={`/documents/liste?q=${encodeURIComponent(c.reference)}`} className="btn-secondary px-3 py-2 text-xs flex items-center gap-1" title="Voir dans la GED">
                    <ExternalLink size={14} /> Voir
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default GedMatchPanel;
