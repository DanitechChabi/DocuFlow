import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, Check, CalendarPlus, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { rechercheService } from '../services/rechercheService';
import { useTitrePage } from '../hooks/useTitrePage';
import { toast } from '../components/Toast';

/**
 * Échéancier (migration 035) : les dates à surveiller de l'organisation,
 * regroupées par mois — fin de contrat, validité d'une attestation, facture à
 * payer. Rappels envoyés à J-n et le jour même.
 */
const VUES = [['a_venir', 'À venir'], ['en_retard', 'En retard'], ['traitees', 'Traitées'], ['toutes', 'Toutes']];
const SOURCE = { manuelle: 'Ajoutée', metadonnee: 'Propriété', analyse: 'Lue dans le document' };
const dateFr = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('fr-FR') : '');

const EcheancesPage = () => {
  useTitrePage('Échéancier');
  const [params, setParams] = useSearchParams();
  const vue = VUES.some(([v]) => v === params.get('vue')) ? params.get('vue') : 'a_venir';
  const [liste, setListe] = useState(null);

  const charger = useCallback(() => {
    setListe(null);
    rechercheService.echeancier(vue).then(setListe).catch((err) => { toast.error(err.response?.data?.message || 'Chargement impossible'); setListe([]); });
  }, [vue]);
  useEffect(() => { charger(); }, [charger]);

  const parMois = useMemo(() => {
    const m = new Map();
    for (const e of liste || []) {
      const cle = e.date_echeance.slice(0, 7);
      if (!m.has(cle)) m.set(cle, []);
      m.get(cle).push(e);
    }
    return [...m.entries()];
  }, [liste]);

  const agir = async (fn, succes) => {
    try { await fn(); toast.success(succes); charger(); } catch (err) { toast.error(err.response?.data?.message || 'Action impossible'); }
  };

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1100px] mx-auto">
      <PageHeader title="Échéancier" subtitle="Fins de contrat, validités, paiements : les dates à ne pas manquer"
        icon={CalendarClock} breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Échéancier' }]} />
      <div className="segmented mb-5">
        {VUES.map(([v, l]) => <button key={v} type="button" aria-pressed={vue === v} onClick={() => setParams(v === 'a_venir' ? {} : { vue: v }, { replace: true })}>{l}</button>)}
      </div>
      {liste === null ? <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-2xl skeleton" />)}</div>
        : liste.length === 0 ? (
          <div className="glass-card-premium p-12 text-center">
            <CalendarClock size={36} className="mx-auto text-slate-300 mb-3" />
            <p className="font-bold text-slate-800">Aucune échéance</p>
            <p className="text-sm text-slate-500 mt-1">Ajoutez une échéance depuis la fiche d'un document, ou marquez une propriété de date comme « échéance » dans Classes et plan.</p>
          </div>
        ) : parMois.map(([mois, items]) => (
          <section key={mois} className="mb-6">
            <h2 className="text-sm font-bold text-slate-700 mb-2 capitalize">{new Date(`${mois}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</h2>
            <ul className="space-y-2">
              {items.map((e) => (
                <li key={e.id} className={`glass-card-premium p-3 flex flex-wrap items-center gap-3 ${e.en_retard ? 'border-l-4 border-red-400' : ''}`}>
                  <span className={`text-sm font-black w-24 ${e.en_retard ? 'text-red-600' : 'text-slate-900'}`}>{dateFr(e.date_echeance)}</span>
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-semibold text-slate-800">{e.libelle}</p>
                    <p className="text-xs text-slate-500"><Link to={`/documents/liste?doc=${e.document_id}`} className="font-bold text-docuflow-secondary hover:underline">{e.reference_mfile}</Link> · {e.nom_entreprise} · {SOURCE[e.source]}{e.destinataire_nom ? ` · pour ${e.destinataire_nom}` : ''}{e.reporte_au ? ` · reportée au ${dateFr(e.reporte_au)}` : ''}</p>
                  </div>
                  {['a_venir', 'notifiee'].includes(e.statut) ? (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => agir(() => rechercheService.traiterEcheance(e.id), 'Échéance traitée')} className="btn btn-secondary btn-sm"><Check size={13} /> Traitée</button>
                      <button type="button" title="Reporter" onClick={() => { const au = window.prompt('Reporter les rappels au (AAAA-MM-JJ) :'); if (au) agir(() => rechercheService.reporterEcheance(e.id, au), 'Rappels reportés'); }} className="btn btn-secondary btn-sm"><CalendarPlus size={13} /></button>
                      <button type="button" title="Annuler" onClick={() => agir(() => rechercheService.annulerEcheance(e.id), 'Échéance annulée')} className="btn btn-secondary btn-sm"><X size={13} /></button>
                    </div>
                  ) : <span className="text-xs text-slate-500">{e.statut === 'traitee' ? `Traitée par ${e.traitee_par || '—'}` : 'Annulée'}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
};

export default EcheancesPage;
