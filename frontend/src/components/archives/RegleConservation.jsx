import React, { useEffect, useState } from 'react';
import { Hourglass, Loader2 } from 'lucide-react';
import { archivageService, SORTS, POINTS } from '../../services/archivageService';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../Toast';

/**
 * Règle de conservation d'une classe (migration 032) : durée d'utilité
 * administrative, point de départ, sort final, référence du tableau de
 * gestion. Sans DUA, aucune échéance : une destruction repose toujours sur
 * une règle explicite.
 */
const RegleConservation = ({ classe, onEnregistree }) => {
  const { can } = usePermissions();
  const [r, setR] = useState({});
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    setR({
      dua_annees: classe.dua_annees ?? '', dua_point_depart: classe.dua_point_depart || 'date_document',
      sort_final: classe.sort_final || '', dua_reference: classe.dua_reference || '',
    });
  }, [classe]);
  if (!can('archives.view')) return null;
  const modifiable = can('archives.manage');

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      await archivageService.definirDua(classe.id, { ...r, dua_annees: r.dua_annees === '' ? null : Number(r.dua_annees) });
      toast.success('Règle de conservation enregistrée');
      onEnregistree?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Enregistrement impossible');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="glass-card-premium p-5 space-y-3">
      <h4 className="font-bold text-slate-800 flex items-center gap-2"><Hourglass size={16} /> Conservation (DUA et sort final)</h4>
      <p className="text-sm text-slate-500">Combien de temps les documents de cette classe sont gardés, à compter de quand, et ce qu'il advient d'eux ensuite. Laissez la durée vide si la classe n'a pas de règle.</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block"><span className="block text-xs font-bold text-slate-500 mb-1">Durée (années)</span>
          <input type="number" min={0} max={200} disabled={!modifiable} className="input-premium" value={r.dua_annees} onChange={(e) => setR({ ...r, dua_annees: e.target.value })} /></label>
        <label className="block"><span className="block text-xs font-bold text-slate-500 mb-1">À compter de</span>
          <select disabled={!modifiable} className="input-premium" value={r.dua_point_depart} onChange={(e) => setR({ ...r, dua_point_depart: e.target.value })}>
            {Object.entries(POINTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        <label className="block"><span className="block text-xs font-bold text-slate-500 mb-1">Sort final</span>
          <select disabled={!modifiable} className="input-premium" value={r.sort_final} onChange={(e) => setR({ ...r, sort_final: e.target.value })}>
            <option value="">—</option>
            {Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
      </div>
      <input disabled={!modifiable} className="input-premium text-sm" maxLength={2000} value={r.dua_reference} onChange={(e) => setR({ ...r, dua_reference: e.target.value })} placeholder="Référence : tableau de gestion, texte de loi…" />
      {modifiable && (
        <div className="flex justify-end">
          <button type="button" onClick={enregistrer} disabled={envoi} className="btn btn-primary btn-sm">{envoi && <Loader2 size={13} className="animate-spin" />} Enregistrer la règle</button>
        </div>
      )}
    </div>
  );
};

export default RegleConservation;
