import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Loader2 } from 'lucide-react';
import { physiqueService, SUPPORTS, NATURES_PRET, COULEURS } from '../../services/physiqueService';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../Toast';

/**
 * Carte « Original papier » de la fiche (migrations 038 et 043) : support du
 * document, boîte et cote de l'original, dates extrêmes du dossier, qui l'a
 * rangé et quand, prêt en cours.
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
    setEdition({
      support: loc.support === 'numerique' ? 'papier' : loc.support, emplacement_id: loc.emplacement_id || '', cote_physique: loc.cote_physique || '',
      annee_debut: loc.annee_debut ?? '', annee_fin: loc.annee_fin ?? '',
    });
    if (!boites.length) physiqueService.emplacements().then((l) => setBoites(l.filter((e) => ['boite', 'tablette'].includes(e.type)))).catch(() => {});
  };
  const enregistrer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await physiqueService.placer(documentId, {
        ...edition, emplacement_id: edition.emplacement_id ? Number(edition.emplacement_id) : null,
        annee_debut: edition.annee_debut === '' ? null : Number(edition.annee_debut), annee_fin: edition.annee_fin === '' ? null : Number(edition.annee_fin),
      });
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
        <span className="flex items-center gap-1.5"><MapPin size={14} /> Original papier</span>
        {can('documents.edit') && !edition && <button type="button" onClick={editer} className="text-[11px] font-bold text-docuflow-secondary normal-case tracking-normal">{loc.support === 'numerique' ? 'Déclarer un original papier' : 'Modifier'}</button>}
      </h3>
      {!edition ? (
        loc.support === 'numerique' ? <p className="text-xs text-slate-500">Document numérique : aucun original papier déclaré.</p> : (
          <div className="text-sm text-slate-700 space-y-1">
            <p>{SUPPORTS[loc.support]}</p>
            {loc.cote_topographique
              ? (
                <>
                  <p className="flex flex-wrap items-center gap-x-1.5">
                    Original en <Link to="/documents/magasins" className="font-mono font-bold text-docuflow-secondary hover:underline">{loc.cote_topographique}</Link>{loc.cote_physique ? ` · ${loc.cote_physique}` : ''}
                    {loc.boite?.couleur_etiquette && <span className="w-3 h-3 rounded-sm border border-slate-400" style={{ background: COULEURS[loc.boite.couleur_etiquette]?.[1] }} title={`Étiquette ${COULEURS[loc.boite.couleur_etiquette]?.[0].toLowerCase()}`} />}
                  </p>
                  {(loc.boite?.libelle || loc.boite?.fonds) && <p className="text-xs text-slate-500">{[loc.boite.libelle, loc.boite.fonds && `fonds ${loc.boite.fonds}`, loc.boite.type_boite].filter(Boolean).join(' · ')}</p>}
                  {loc.range_par_nom && <p className="text-xs text-slate-500">Rangé par {loc.range_par_nom}{loc.range_at ? ` le ${new Date(loc.range_at).toLocaleDateString('fr-FR')}` : ''}</p>}
                </>
              )
              : <p className="text-amber-700 text-xs">Original papier non localisé : indiquez sa boîte.</p>}
            {(loc.annee_debut || loc.annee_fin) && <p className="text-xs text-slate-600">Dates extrêmes : <span className="font-bold">{loc.dates_extremes}</span></p>}
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
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="font-semibold whitespace-nowrap">Dates extrêmes</span>
                <input type="number" min={1000} max={2200} className="input-premium text-sm w-24" placeholder="de (année)" aria-label="Date extrême de début (année)" value={edition.annee_debut} onChange={(e) => setEdition({ ...edition, annee_debut: e.target.value })} />
                <span>à</span>
                <input type="number" min={1000} max={2200} className="input-premium text-sm w-24" placeholder="à (année)" aria-label="Date extrême de fin (année)" value={edition.annee_fin} onChange={(e) => setEdition({ ...edition, annee_fin: e.target.value })} />
              </div>
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
