import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Loader2 } from 'lucide-react';
import { physiqueService, SUPPORTS, NATURES_PRET } from '../../services/physiqueService';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../Toast';

/**
 * Carte « Localisation » de la fiche (migration 038) : support du document,
 * boîte et cote de l'original papier, prêt en cours.
 */
const LocalisationDocument = ({ documentId, onChanged }) => {
  const { can } = usePermissions();
  const [loc, setLoc] = useState(null);
  const [boites, setBoites] = useState([]);
  const [edition, setEdition] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const charger = useCallback(() => physiqueService.localisation(documentId).then(setLoc).catch(() => setLoc({ indisponible: true })), [documentId]);
  useEffect(() => { charger(); }, [charger]);
  const editer = async () => {
    setEdition({ support: loc.support === 'numerique' ? 'papier' : loc.support, emplacement_id: loc.emplacement_id || '', cote_physique: loc.cote_physique || '' });
    if (!boites.length) physiqueService.emplacements().then((l) => setBoites(l.filter((e) => ['boite', 'tablette'].includes(e.type)))).catch(() => {});
  };
  const enregistrer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await physiqueService.placer(documentId, { ...edition, emplacement_id: edition.emplacement_id ? Number(edition.emplacement_id) : null });
      toast.success('Localisation enregistrée');
      setEdition(null);
      charger();
      onChanged?.();
    } catch (err) { toast.error(err.response?.data?.message || 'Enregistrement impossible'); } finally { setEnvoi(false); }
  };
  if (!loc || loc.indisponible) return null;
  if (loc.support === 'numerique' && !can('documents.edit')) return null;
  return (
    <div className="glass-card-premium p-5 space-y-2">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5"><MapPin size={14} /> Localisation</span>
        {can('documents.edit') && !edition && <button type="button" onClick={editer} className="text-[11px] font-bold text-docuflow-secondary normal-case tracking-normal">{loc.support === 'numerique' ? 'Déclarer un original papier' : 'Modifier'}</button>}
      </h3>
      {!edition ? (
        loc.support === 'numerique' ? <p className="text-xs text-slate-500">Document numérique : aucun original papier déclaré.</p> : (
          <div className="text-sm text-slate-700 space-y-1">
            <p>{SUPPORTS[loc.support]}</p>
            {loc.cote_topographique
              ? <p>Original en <Link to="/documents/magasins" className="font-mono font-bold text-docuflow-secondary hover:underline">{loc.cote_topographique}</Link>{loc.cote_physique ? ` · ${loc.cote_physique}` : ''}</p>
              : <p className="text-amber-700 text-xs">Original papier non localisé : indiquez sa boîte.</p>}
            {loc.pret && <p className="text-xs text-blue-700">{NATURES_PRET[loc.pret.nature]} remis(e) à {loc.pret.emprunteur || '—'} le {new Date(loc.pret.remis_at).toLocaleDateString('fr-FR')} · retour prévu le {new Date(loc.pret.retour_prevu).toLocaleDateString('fr-FR')}</p>}
          </div>
        )
      ) : (
        <form onSubmit={enregistrer} className="space-y-2 text-sm">
          <select className="input-premium text-sm" value={edition.support} onChange={(e) => setEdition({ ...edition, support: e.target.value })}>
            {Object.entries(SUPPORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {edition.support !== 'numerique' && (
            <>
              <select className="input-premium text-sm" value={edition.emplacement_id} onChange={(e) => setEdition({ ...edition, emplacement_id: e.target.value })}>
                <option value="">— Boîte —</option>
                {boites.map((b) => <option key={b.id} value={b.id}>{b.cote}{b.libelle ? ` — ${b.libelle}` : ''}</option>)}
              </select>
              <input className="input-premium text-sm" maxLength={60} placeholder="Cote dans la boîte (ex. pièce 12)" value={edition.cote_physique} onChange={(e) => setEdition({ ...edition, cote_physique: e.target.value })} />
            </>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEdition(null)} className="btn btn-secondary btn-sm">Annuler</button>
            <button type="submit" disabled={envoi} className="btn btn-primary btn-sm">{envoi && <Loader2 size={13} className="animate-spin" />} Enregistrer</button>
          </div>
        </form>
      )}
    </div>
  );
};

export default LocalisationDocument;
