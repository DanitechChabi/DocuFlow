import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, EyeOff, RotateCcw, Lightbulb, FileText, Loader2 } from 'lucide-react';
import { SEVERITES, STATUTS_ALERTE, conformiteService } from '../../services/conformiteService';
import { toast } from '../Toast';

/**
 * Une alerte de conformité : sévérité, description, documents en cause,
 * suggestion, et le geste de traitement (traiter / ignorer avec une note,
 * rouvrir). Une alerte ignorée ou traitée le reste aux recalculs suivants.
 */
const AlerteCarte = ({ alerte, peutGerer, onChange, compact = false }) => {
  const [note, setNote] = useState('');
  const [saisie, setSaisie] = useState(null); // 'traitee' | 'ignoree'
  const [envoi, setEnvoi] = useState(false);
  const sev = SEVERITES[alerte.severite] || SEVERITES.faible;

  const changer = async (statut) => {
    setEnvoi(true);
    try {
      const a = await conformiteService.traiterAlerte(alerte.id, statut, statut === 'ouverte' ? null : note || null);
      toast.success(statut === 'ouverte' ? 'Alerte rouverte' : statut === 'traitee' ? 'Alerte marquée comme traitée' : 'Alerte ignorée');
      setSaisie(null);
      setNote('');
      onChange?.(a);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action impossible');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <article className={`rounded-2xl border bg-white p-4 ${alerte.statut === 'ouverte' ? 'border-slate-200' : 'border-slate-100 opacity-80'}`} data-alerte={alerte.id}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-bold ${sev.classe}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${sev.point}`} /> {sev.libelle}
        </span>
        <span className="text-xs font-bold text-slate-700">{alerte.type_libelle}</span>
        {alerte.statut !== 'ouverte' && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{STATUTS_ALERTE[alerte.statut]}</span>
        )}
        <span className="ml-auto text-[11px] text-slate-400">{new Date(alerte.detectee_at).toLocaleDateString('fr-FR')}</span>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed">{alerte.description}</p>
      {!compact && alerte.suggestion && (
        <p className="mt-2 text-xs text-slate-500 flex items-start gap-1.5"><Lightbulb size={13} className="mt-0.5 flex-shrink-0 text-amber-500" /> {alerte.suggestion}</p>
      )}
      {alerte.note && <p className="mt-2 text-xs text-slate-500 italic">Note : {alerte.note}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!compact && alerte.document_ids.map((id) => (
          <Link key={id} to={`/documents/liste?doc=${id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-docuflow-secondary hover:underline">
            <FileText size={12} /> Document n° {id}
          </Link>
        ))}
        {peutGerer && (
          <span className="ml-auto flex items-center gap-1.5">
            {alerte.statut === 'ouverte' || alerte.statut === 'resolue' ? (
              <>
                <button type="button" onClick={() => setSaisie(saisie === 'traitee' ? null : 'traitee')} className="btn btn-secondary text-xs py-1.5"><Check size={13} /> Traitée</button>
                <button type="button" onClick={() => setSaisie(saisie === 'ignoree' ? null : 'ignoree')} className="btn btn-secondary text-xs py-1.5"><EyeOff size={13} /> Ignorer</button>
              </>
            ) : (
              <button type="button" disabled={envoi} onClick={() => changer('ouverte')} className="btn btn-secondary text-xs py-1.5"><RotateCcw size={13} /> Rouvrir</button>
            )}
          </span>
        )}
      </div>
      {saisie && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="input-premium flex-1 min-w-[200px] text-sm py-2" placeholder={saisie === 'ignoree' ? 'Pourquoi ignorer ? (ex. avenant signé)' : 'Ce qui a été fait (facultatif)'}
            value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <button type="button" disabled={envoi} onClick={() => changer(saisie)} className="btn btn-primary text-xs">
            {envoi ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Confirmer
          </button>
        </div>
      )}
    </article>
  );
};

export default AlerteCarte;
