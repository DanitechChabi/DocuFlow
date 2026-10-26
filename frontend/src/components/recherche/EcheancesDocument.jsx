import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Plus, Check, Loader2 } from 'lucide-react';
import { rechercheService } from '../../services/rechercheService';
import { toast } from '../Toast';

/**
 * Carte « Échéances » de la fiche (migration 035) : dates à surveiller —
 * posées à la main, tirées d'une propriété « échéance » ou lues par l'analyse.
 */
const SOURCE = { manuelle: 'ajoutée', metadonnee: 'propriété', analyse: 'lue dans le document' };
const dateFr = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('fr-FR') : '');

const EcheancesDocument = ({ documentId }) => {
  const [liste, setListe] = useState(null);
  const [formulaire, setFormulaire] = useState(false);
  const [e, setE] = useState({ libelle: '', date_echeance: '', rappel_jours_avant: '' });
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    rechercheService.echeancesDocument(documentId).then(setListe).catch(() => setListe(null));
  }, [documentId]);
  useEffect(() => { charger(); }, [charger]);
  if (liste === null) return null;

  const ajouter = async (ev) => {
    ev.preventDefault();
    setEnvoi(true);
    try {
      await rechercheService.creerEcheance(documentId, { ...e, rappel_jours_avant: e.rappel_jours_avant === '' ? undefined : Number(e.rappel_jours_avant) });
      setFormulaire(false);
      setE({ libelle: '', date_echeance: '', rappel_jours_avant: '' });
      charger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Ajout impossible');
    } finally {
      setEnvoi(false);
    }
  };
  const traiter = async (x) => {
    try { await rechercheService.traiterEcheance(x.id); charger(); } catch (err) { toast.error(err.response?.data?.message || 'Action impossible'); }
  };

  return (
    <div className="glass-card-premium p-5 space-y-3">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5"><CalendarClock size={14} /> Échéances</span>
        {!formulaire && <button type="button" onClick={() => setFormulaire(true)} className="text-[11px] font-bold text-docuflow-secondary flex items-center gap-1 normal-case tracking-normal"><Plus size={12} /> Ajouter</button>}
      </h3>
      {formulaire && (
        <form onSubmit={ajouter} className="space-y-2">
          <input className="input-premium text-sm" required maxLength={200} value={e.libelle} onChange={(x) => setE({ ...e, libelle: x.target.value })} placeholder="Renouvellement du contrat…" />
          <div className="flex gap-2">
            <input type="date" className="input-premium text-sm" required value={e.date_echeance} onChange={(x) => setE({ ...e, date_echeance: x.target.value })} />
            <input type="number" min={0} max={365} className="input-premium text-sm w-28" value={e.rappel_jours_avant} onChange={(x) => setE({ ...e, rappel_jours_avant: x.target.value })} placeholder="Rappel J-" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setFormulaire(false)} className="btn btn-secondary btn-sm">Annuler</button>
            <button type="submit" disabled={envoi} className="btn btn-primary btn-sm">{envoi && <Loader2 size={13} className="animate-spin" />} Ajouter</button>
          </div>
        </form>
      )}
      {liste.length === 0 && !formulaire && <p className="text-xs text-slate-500">Aucune date à surveiller.</p>}
      <ul className="space-y-1.5">
        {liste.map((x) => (
          <li key={x.id} className={`text-xs flex items-center gap-2 ${['traitee', 'annulee'].includes(x.statut) ? 'opacity-50' : ''}`}>
            <span className={`font-bold w-20 flex-shrink-0 ${x.en_retard ? 'text-red-600' : 'text-slate-800'}`}>{dateFr(x.date_echeance)}</span>
            <span className="flex-1 min-w-0 truncate" title={x.note || x.libelle}>{x.libelle} <span className="text-slate-400">· {SOURCE[x.source]}</span></span>
            {['a_venir', 'notifiee'].includes(x.statut)
              ? <button type="button" onClick={() => traiter(x)} title="Marquer comme traitée" className="text-slate-400 hover:text-emerald-600"><Check size={14} /></button>
              : <span className="text-slate-400">{x.statut === 'traitee' ? 'traitée' : 'annulée'}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default EcheancesDocument;
