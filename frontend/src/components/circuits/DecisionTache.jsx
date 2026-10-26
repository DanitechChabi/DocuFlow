import React, { useState } from 'react';
import { Check, X, Eye, Loader2, UserRoundCog } from 'lucide-react';
import { circuitService } from '../../services/circuitService';
import { toast } from '../Toast';

/**
 * Actions d'une tâche de validation (migration 034) : approuver, refuser
 * (motif obligatoire), prendre connaissance, déléguer. Partagée par la fiche
 * du document et la page « Mes tâches ».
 */
const DecisionTache = ({ tache, onDone }) => {
  const [mode, setMode] = useState(null); // 'refuser' | 'deleguer' | null
  const [commentaire, setCommentaire] = useState('');
  const [personnes, setPersonnes] = useState([]);
  const [cible, setCible] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const agir = async (fn, succes) => {
    setEnvoi(true);
    try {
      await fn();
      toast.success(succes);
      setMode(null);
      setCommentaire('');
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action impossible');
    } finally {
      setEnvoi(false);
    }
  };

  const ouvrirDelegation = async () => {
    setMode('deleguer');
    try { setPersonnes(await circuitService.delegataires(tache.id)); } catch { setPersonnes([]); }
  };

  if (mode === 'refuser' || mode === 'deleguer') {
    return (
      <div className="space-y-2">
        {mode === 'deleguer' && (
          <select className="input-premium text-sm" value={cible} onChange={(e) => setCible(e.target.value)}>
            <option value="">Déléguer à…</option>
            {personnes.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}
          </select>
        )}
        <textarea className="input-premium text-sm min-h-[56px]" maxLength={2000} value={commentaire} onChange={(e) => setCommentaire(e.target.value)}
          placeholder={mode === 'refuser' ? 'Motif du refus (obligatoire)' : 'Message (facultatif)'} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setMode(null)} className="btn btn-secondary btn-sm">Annuler</button>
          {mode === 'refuser' ? (
            <button type="button" disabled={envoi || !commentaire.trim()} className="btn btn-danger btn-sm"
              onClick={() => agir(() => circuitService.decider(tache.id, 'refuser', commentaire), 'Refus enregistré')}>
              {envoi && <Loader2 size={13} className="animate-spin" />} Refuser
            </button>
          ) : (
            <button type="button" disabled={envoi || !cible} className="btn btn-primary btn-sm"
              onClick={() => agir(() => circuitService.deleguer(tache.id, Number(cible), commentaire), 'Tâche déléguée')}>
              {envoi && <Loader2 size={13} className="animate-spin" />} Déléguer
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tache.action === 'information' ? (
        <button type="button" disabled={envoi} className="btn btn-primary btn-sm"
          onClick={() => agir(() => circuitService.decider(tache.id, 'prendre_connaissance'), 'Pris connaissance')}><Eye size={13} /> J'ai pris connaissance</button>
      ) : (
        <>
          <button type="button" disabled={envoi} className="btn btn-primary btn-sm"
            onClick={() => agir(() => circuitService.decider(tache.id, 'approuver', commentaire || undefined), 'Visa enregistré')}>
            {envoi ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approuver
          </button>
          <button type="button" onClick={() => setMode('refuser')} className="btn btn-secondary btn-sm text-red-600"><X size={13} /> Refuser</button>
        </>
      )}
      <button type="button" onClick={ouvrirDelegation} className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"><UserRoundCog size={13} /> Déléguer</button>
    </div>
  );
};

export default DecisionTache;
