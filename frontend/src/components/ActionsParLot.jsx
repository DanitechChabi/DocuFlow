import React, { useState } from 'react';
import { FolderInput, Tag, Trash2, X, Loader2 } from 'lucide-react';
import { documentService } from '../services/documentService';
import { usePermissions } from '../hooks/usePermissions';
import { toast } from './Toast';

/**
 * Actions par lot sur les documents sélectionnés : déplacer, étiqueter, mettre
 * à la corbeille. Chaque document passe par la même route que l'action
 * unitaire : périmètres, verrous et gels s'appliquent un par un, et le bilan
 * dit combien ont réussi.
 */
const ActionsParLot = ({ selection, dossiers = [], peutSupprimer = false, onTermine, onVider }) => {
  const { can } = usePermissions();
  const [mode, setMode] = useState(null); // deplacer | etiqueter | supprimer
  const [dossier, setDossier] = useState('');
  const [etiquette, setEtiquette] = useState('');
  const [cours, setCours] = useState(null);
  if (!selection.length) return null;

  const appliquer = async (fn, verbe) => {
    let faits = 0;
    const refus = [];
    for (let i = 0; i < selection.length; i += 1) {
      setCours(`${i + 1} / ${selection.length}`);
      try { await fn(selection[i]); faits += 1; } catch (err) { refus.push(`${selection[i].reference_mfile} : ${err.response?.data?.message || 'refusé'}`); }
    }
    setCours(null);
    setMode(null);
    if (faits) toast.success(`${faits} document(s) ${verbe}`);
    if (refus.length) toast.error(`${refus.length} refus — ${refus.slice(0, 2).join(' ; ')}${refus.length > 2 ? '…' : ''}`, 9000);
    onTermine();
  };
  const deplacer = () => appliquer((d) => documentService.updateDocument(d.id, { dossier_id: Number(dossier) }), 'déplacé(s)');
  const etiqueter = () => {
    const t = etiquette.trim();
    return appliquer((d) => {
      const actuelles = Array.isArray(d.tags) ? d.tags : [];
      return actuelles.includes(t) ? Promise.resolve() : documentService.updateDocument(d.id, { tags: [...actuelles, t] });
    }, 'étiqueté(s)');
  };
  const supprimer = () => appliquer((d) => documentService.deleteDocument(d.id), 'mis à la corbeille');

  return (
    <div className="sticky bottom-4 z-30 mx-auto w-fit max-w-full mt-4 px-4 py-3 rounded-2xl bg-slate-900 text-white shadow-2xl flex flex-wrap items-center gap-3 animate-fade-in-up" role="region" aria-label="Actions sur la sélection">
      <span className="text-sm font-bold">{selection.length} sélectionné(s)</span>
      {cours ? <span className="flex items-center gap-2 text-sm"><Loader2 size={15} className="animate-spin" /> {cours}</span> : mode === 'deplacer' ? (
        <>
          <select className="rounded-lg bg-slate-800 border border-slate-600 text-sm px-2 py-1.5" value={dossier} onChange={(e) => setDossier(e.target.value)} aria-label="Dossier de destination">
            <option value="">Dossier de destination…</option>
            {dossiers.map((f) => <option key={f.id} value={f.id}>{f.path || f.name}</option>)}
          </select>
          <button type="button" disabled={!dossier} onClick={deplacer} className="px-3 py-1.5 rounded-lg bg-white text-slate-900 text-sm font-bold disabled:opacity-40">Déplacer</button>
        </>
      ) : mode === 'etiqueter' ? (
        <>
          <input className="rounded-lg bg-slate-800 border border-slate-600 text-sm px-2 py-1.5 placeholder-slate-400" placeholder="Étiquette à ajouter" value={etiquette} maxLength={40}
            onChange={(e) => setEtiquette(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && etiquette.trim() && etiqueter()} aria-label="Étiquette" autoFocus />
          <button type="button" disabled={!etiquette.trim()} onClick={etiqueter} className="px-3 py-1.5 rounded-lg bg-white text-slate-900 text-sm font-bold disabled:opacity-40">Ajouter</button>
        </>
      ) : mode === 'supprimer' ? (
        <>
          <span className="text-sm">Mettre ces documents à la corbeille ? Ils restent restaurables.</span>
          <button type="button" onClick={supprimer} className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-bold">Confirmer</button>
        </>
      ) : (
        <>
          {can('documents.move') && <button type="button" onClick={() => setMode('deplacer')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-slate-700 text-sm font-semibold"><FolderInput size={15} /> Déplacer</button>}
          {can('documents.edit') && <button type="button" onClick={() => setMode('etiqueter')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-slate-700 text-sm font-semibold"><Tag size={15} /> Étiqueter</button>}
          {peutSupprimer && <button type="button" onClick={() => setMode('supprimer')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-slate-700 text-sm font-semibold text-red-300"><Trash2 size={15} /> Corbeille</button>}
        </>
      )}
      {!cours && (
        <button type="button" onClick={() => (mode ? setMode(null) : onVider())} className="ml-1 p-1.5 rounded-lg hover:bg-slate-700" aria-label={mode ? 'Annuler' : 'Désélectionner tout'} title={mode ? 'Annuler' : 'Désélectionner tout'}><X size={16} /></button>
      )}
    </div>
  );
};

export default ActionsParLot;
