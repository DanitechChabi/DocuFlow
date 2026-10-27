import React, { useCallback, useEffect, useState } from 'react';
import { Globe, Stamp, Loader2, CheckCircle2, Phone, Mail } from 'lucide-react';
import api from '../services/api';
import { serviceArchivesService } from '../services/serviceArchivesService';
import ChoixDocument from './archives/ChoixDocument';
import { usePermissions } from '../hooks/usePermissions';
import { toast } from './Toast';

/**
 * Demande déposée sur le portail citoyen (migration 040), vue du personnel :
 * qui demande, quoi, et les deux gestes qui font avancer l'usager —
 * délivrer la copie certifiée (l'usager est prévenu), constater le retrait.
 */
const DemandeCitoyennePanel = ({ request, onDone }) => {
  const { can } = usePermissions();
  const [dc, setDc] = useState(null);
  const [doc, setDoc] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    api.get(`/requests/${request.id}/citoyen`).then((r) => setDc(r.data?.aucune ? false : r.data)).catch(() => setDc(false));
  }, [request.id]);
  useEffect(() => { charger(); }, [charger]);

  if (!dc) return null;
  const delivrer = async () => {
    if (!doc) { toast.error('Choisissez d\'abord l\'acte dans la GED.'); return; }
    setEnvoi(true);
    try {
      const c = await serviceArchivesService.delivrer(doc.id, {
        destinataire: `${dc.demandeur_prenoms} ${dc.demandeur_nom}`, request_id: request.id, motif: dc.motif || undefined,
      });
      toast.success(`Copie ${c.numero} délivrée : l'usager voit son acte « prêt »`);
      await serviceArchivesService.telecharger(c.numero);
      charger();
      if (onDone) onDone();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Délivrance impossible');
    } finally { setEnvoi(false); }
  };
  const retrait = async () => {
    setEnvoi(true);
    try {
      setDc(await api.post(`/requests/${request.id}/citoyen/retrait`).then((r) => r.data));
      toast.success('Retrait enregistré : demande livrée');
      if (onDone) onDone();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Enregistrement impossible');
    } finally { setEnvoi(false); }
  };

  return (
    <div className="p-4 sm:p-5 rounded-2xl border border-blue-200 bg-blue-50/40 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-widest flex items-center gap-2"><Globe size={14} /> Demande déposée en ligne</h3>
        <span className="text-xs font-bold text-slate-700 font-mono">{dc.code_suivi}</span>
      </div>
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-500">Acte</dt><dd className="font-semibold">{dc.type_libelle} de {dc.personne_concernee}</dd>
        <dt className="text-slate-500">Événement</dt><dd>{dc.date_evenement ? new Date(dc.date_evenement).toLocaleDateString('fr-FR') : dc.annee_evenement}{dc.lieu_evenement ? ` à ${dc.lieu_evenement}` : ''}{dc.numero_acte ? ` · acte n° ${dc.numero_acte}` : ''}</dd>
        <dt className="text-slate-500">Demandeur</dt><dd>{dc.demandeur_prenoms} {dc.demandeur_nom} ({dc.lien_libelle.toLowerCase()})</dd>
        <dt className="text-slate-500">Contact</dt>
        <dd className="flex flex-wrap gap-x-4">
          <a href={`tel:${dc.telephone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 text-docuflow-secondary"><Phone size={13} /> {dc.telephone}</a>
          {dc.email && <a href={`mailto:${dc.email}`} className="inline-flex items-center gap-1 text-docuflow-secondary"><Mail size={13} /> {dc.email}</a>}
        </dd>
        <dt className="text-slate-500">Vu par l'usager</dt><dd className="font-semibold">{dc.statut_citoyen.libelle}</dd>
      </dl>
      {dc.copies.length > 0 && (
        <p className="text-xs text-slate-600">Copie(s) délivrée(s) : {dc.copies.map((c) => `${c.numero} (${c.document_reference})`).join(', ')}</p>
      )}
      {!dc.copies.length && can('archives.communicate') && (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-slate-600">Retrouvez l'acte dans la GED (voir la recherche automatique ci-dessous), puis délivrez la copie certifiée : l'usager est prévenu qu'il peut venir la retirer.</p>
          <ChoixDocument valeur={doc} onChange={setDoc} placeholder="Référence ou nom sur l'acte…" />
          <button type="button" onClick={delivrer} disabled={envoi || !doc} className="btn-primary w-full flex items-center justify-center gap-2">
            {envoi ? <Loader2 size={15} className="animate-spin" /> : <Stamp size={15} />} Délivrer la copie certifiée
          </button>
        </div>
      )}
      {dc.copies.length > 0 && !dc.retire_at && (
        <button type="button" onClick={retrait} disabled={envoi} className="btn-secondary w-full flex items-center justify-center gap-2">
          <CheckCircle2 size={15} /> L'usager a retiré son acte
        </button>
      )}
      {dc.retire_at && <p className="text-xs text-emerald-700 font-semibold">Retiré le {new Date(dc.retire_at).toLocaleDateString('fr-FR')}{dc.retire_par_nom ? `, remis par ${dc.retire_par_nom}` : ''}.</p>}
    </div>
  );
};

export default DemandeCitoyennePanel;
