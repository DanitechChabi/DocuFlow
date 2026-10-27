import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Loader2, Send, Ban, Printer, Download, PackageCheck, Plus } from 'lucide-react';
import {
  archivageService, STATUTS_VERSEMENT, DESTINATIONS, COMMUNICABILITE, dateFr, taille,
} from '../../services/archivageService';
import { usePermissions } from '../../hooks/usePermissions';
import ChoixDocument from './ChoixDocument';
import { toast } from '../Toast';

/**
 * Onglet « Versements » de la page Archivage (migration 036) : bordereaux de
 * versement au dépôt de pré-archivage ou aux archives publiques (décret
 * n° 2007-532, art. 42-47). Brouillon → transmis (liste figée, empreinte) →
 * pris en charge (récépissé du service d'archives).
 */
const Statut = ({ statut }) => {
  const [l, c] = STATUTS_VERSEMENT[statut] || [statut, 'bg-slate-100'];
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c}`}>{l}</span>;
};

const PriseEnCharge = ({ v, onFait, onAnnuler }) => {
  const [f, setF] = useState({ recepisse_numero: '', recepisse_date: '', pris_en_charge_par_nom: '' });
  const [piece, setPiece] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const maj = (k, x) => setF((y) => ({ ...y, [k]: x }));
  const envoyer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await archivageService.actionVersement(v.id, 'prise-en-charge', { ...f, piece_document_id: piece?.id || null });
      toast.success('Prise en charge enregistrée : les documents sont marqués versés');
      onFait();
    } catch (err) { toast.error(err.response?.data?.message || 'Enregistrement impossible'); } finally { setEnvoi(false); }
  };
  return (
    <form onSubmit={envoyer} className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2"><PackageCheck size={15} /> Récépissé du service d'archives</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs font-semibold text-slate-600 space-y-1">N° du récépissé
          <input className="input-premium text-sm" required maxLength={100} value={f.recepisse_numero} onChange={(e) => maj('recepisse_numero', e.target.value)} /></label>
        <label className="text-xs font-semibold text-slate-600 space-y-1">Date
          <input type="date" className="input-premium text-sm" required value={f.recepisse_date} onChange={(e) => maj('recepisse_date', e.target.value)} /></label>
        <label className="text-xs font-semibold text-slate-600 space-y-1">Agent qui a pris en charge
          <input className="input-premium text-sm" maxLength={150} value={f.pris_en_charge_par_nom} onChange={(e) => maj('pris_en_charge_par_nom', e.target.value)} placeholder="Facultatif" /></label>
      </div>
      <div className="text-xs font-semibold text-slate-600 space-y-1">Récépissé scanné (facultatif, versé dans la GED)
        <ChoixDocument valeur={piece} onChange={setPiece} /></div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onAnnuler} className="btn btn-secondary btn-sm">Annuler</button>
        <button type="submit" disabled={envoi} className="btn btn-primary btn-sm">{envoi && <Loader2 size={13} className="animate-spin" />} Enregistrer</button>
      </div>
    </form>
  );
};

const Detail = ({ id, onRetour }) => {
  const { can } = usePermissions();
  const [v, setV] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [recepisse, setRecepisse] = useState(false);
  const [ajout, setAjout] = useState(null);
  const charger = useCallback(() => archivageService.versement(id).then(setV).catch((err) => toast.error(err.response?.data?.message || 'Chargement impossible')), [id]);
  useEffect(() => { charger(); }, [charger]);
  const agir = async (action, corps, succes, confirmation) => {
    if (confirmation && !window.confirm(confirmation)) return;
    setEnvoi(true);
    try { await archivageService.actionVersement(id, action, corps); toast.success(succes); charger(); } catch (err) { toast.error(err.response?.data?.message || 'Action impossible'); } finally { setEnvoi(false); }
  };
  const ajouter = async (doc) => {
    if (!doc) return;
    try {
      const r = await archivageService.ajouterVersement(id, [doc.id]);
      if (r.refuses.length) toast.error(r.refuses[0].motif); else toast.success(`${doc.reference} ajouté`);
      setAjout(null);
      charger();
    } catch (err) { toast.error(err.response?.data?.message || 'Ajout impossible'); }
  };
  const paquet = async () => {
    setEnvoi(true);
    try { await archivageService.paquetVersement(id); } catch { toast.error('Export du paquet impossible'); } finally { setEnvoi(false); }
  };
  if (!v) return <div className="h-32 rounded-2xl skeleton" />;
  const gerer = can('archives.manage');
  return (
    <div className="space-y-4">
      <button type="button" onClick={onRetour} className="text-sm text-slate-500 hover:text-slate-800">← Tous les versements</button>
      <div className="glass-card-premium p-5 space-y-2">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-lg text-slate-900">{v.numero}</h3><Statut statut={v.statut} /></div>
        <p className="text-sm text-slate-700">{v.intitule}</p>
        <p className="text-xs text-slate-500">
          Destination : {DESTINATIONS[v.destination]}{v.service_destinataire ? ` — ${v.service_destinataire}` : ''} · préparé par {v.created_by_nom || '—'}
          {v.transmis_at ? ` · transmis le ${dateFr(v.transmis_at)} par ${v.transmis_par_nom}` : ''}
          {v.recepisse_numero ? ` · récépissé n° ${v.recepisse_numero} du ${dateFr(v.recepisse_date)}${v.pris_en_charge_par_nom ? ` (${v.pris_en_charge_par_nom})` : ''}` : ''}
        </p>
        <p className="text-xs text-slate-500">
          {v.totaux.documents} document(s) · {v.totaux.fichiers} fichier(s) · {taille(v.totaux.volume_octets)}
          {v.totaux.dates_extremes && ` · dates extrêmes ${dateFr(v.totaux.dates_extremes.debut)} – ${dateFr(v.totaux.dates_extremes.fin)}`}
        </p>
        {v.empreinte_conforme === false && <p className="text-xs font-bold text-red-700">La liste ne correspond plus à l'empreinte enregistrée à la transmission.</p>}
        <div className="flex flex-wrap gap-2 pt-2">
          {gerer && v.statut === 'brouillon' && <button type="button" onClick={() => setAjout({})} className="btn btn-secondary btn-sm"><Plus size={13} /> Ajouter un document</button>}
          {gerer && v.statut === 'brouillon' && <button type="button" disabled={envoi} onClick={() => agir('transmission', {}, 'Bordereau transmis : la liste est figée', 'Transmettre ce bordereau ? La liste ne pourra plus être modifiée.')} className="btn btn-primary btn-sm"><Send size={13} /> Transmettre</button>}
          {gerer && v.statut === 'transmis' && <button type="button" onClick={() => setRecepisse(true)} className="btn btn-primary btn-sm"><PackageCheck size={13} /> Enregistrer la prise en charge</button>}
          {v.statut !== 'brouillon' && <Link to={`/documents/archivage/versements/${v.id}/imprimer`} target="_blank" className="btn btn-secondary btn-sm"><Printer size={13} /> Imprimer le bordereau</Link>}
          {gerer && v.totaux.documents > 0 && <button type="button" disabled={envoi} onClick={paquet} className="btn btn-secondary btn-sm"><Download size={13} /> Paquet d'archive (ZIP)</button>}
          {gerer && ['brouillon', 'transmis'].includes(v.statut) && <button type="button" disabled={envoi} onClick={() => { const m = window.prompt("Motif de l'annulation :"); if (m) agir('annulation', { motif: m }, 'Bordereau annulé'); }} className="btn btn-secondary btn-sm"><Ban size={13} /> Annuler</button>}
        </div>
        {ajout && <div className="pt-2 max-w-lg"><ChoixDocument valeur={null} onChange={ajouter} placeholder="Chercher le document à ajouter…" /></div>}
      </div>
      {recepisse && <PriseEnCharge v={v} onFait={() => { setRecepisse(false); charger(); }} onAnnuler={() => setRecepisse(false)} />}
      <div className="glass-card-premium overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider"><tr><th className="text-left p-3">Document</th><th className="text-left p-3">Date</th><th className="text-left p-3">Communicabilité</th><th className="text-left p-3">Fichiers</th></tr></thead>
          <tbody>
            {v.lignes.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="p-3">{l.masque ? <span className="text-slate-400">Document hors de votre périmètre</span> : <><strong>{l.reference}</strong> <span className="text-slate-600">{l.intitule}</span><p className="text-xs text-slate-400">{l.classe}{l.dossier ? ` · ${l.dossier}` : ''}</p></>}</td>
                <td className="p-3 text-xs">{dateFr(l.date_document)}</td>
                <td className="p-3 text-xs">{l.masque ? '' : COMMUNICABILITE[l.communicabilite || '']}</td>
                <td className="p-3 text-xs">{l.nb_fichiers} · {taille(l.volume_octets)}
                  {gerer && v.statut === 'brouillon' && !l.masque && l.document_id && <button type="button" onClick={async () => { await archivageService.retirerVersement(v.id, l.document_id).catch((e) => toast.error(e.response?.data?.message || 'Retrait impossible')); charger(); }} className="ml-2 text-red-600 font-semibold">Retirer</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const NouveauVersement = ({ onCree, onAnnuler }) => {
  const [f, setF] = useState({ intitule: '', destination: 'pre_archivage', service_destinataire: '' });
  const [envoi, setEnvoi] = useState(false);
  const envoyer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const r = await archivageService.creerVersement(f);
      toast.success(`Bordereau ${r.versement.numero} créé : ajoutez-y les documents`);
      onCree(r.versement.id);
    } catch (err) { toast.error(err.response?.data?.message || 'Création impossible'); } finally { setEnvoi(false); }
  };
  return (
    <form onSubmit={envoyer} className="glass-card-premium p-4 grid sm:grid-cols-3 gap-3 items-end">
      <label className="text-xs font-semibold text-slate-600 space-y-1">Intitulé
        <input className="input-premium text-sm" maxLength={200} value={f.intitule} onChange={(e) => setF({ ...f, intitule: e.target.value })} placeholder="Ex. Versement annuel 2026 — État civil" /></label>
      <label className="text-xs font-semibold text-slate-600 space-y-1">Destination
        <select className="input-premium text-sm" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })}>
          {Object.entries(DESTINATIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select></label>
      <label className="text-xs font-semibold text-slate-600 space-y-1">Service destinataire
        <input className="input-premium text-sm" maxLength={200} value={f.service_destinataire} onChange={(e) => setF({ ...f, service_destinataire: e.target.value })} placeholder="Ex. Archives départementales du Littoral" /></label>
      <div className="sm:col-span-3 flex justify-end gap-2">
        <button type="button" onClick={onAnnuler} className="btn btn-secondary btn-sm">Annuler</button>
        <button type="submit" disabled={envoi} className="btn btn-primary btn-sm">{envoi && <Loader2 size={13} className="animate-spin" />} Créer</button>
      </div>
    </form>
  );
};

export const OngletVersements = ({ ouvert, setOuvert }) => {
  const { can } = usePermissions();
  const [liste, setListe] = useState(null);
  const [nouveau, setNouveau] = useState(false);
  useEffect(() => { if (!ouvert) archivageService.versements().then(setListe).catch(() => setListe([])); }, [ouvert]);
  if (ouvert) return <Detail id={ouvert} onRetour={() => setOuvert(null)} />;
  if (liste === null) return <div className="h-32 rounded-2xl skeleton" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 max-w-3xl">
          Chaque année, les documents dont la valeur administrative n'est plus immédiate sont versés au dépôt de pré-archivage ; à dix ans, ils sont versés aux archives publiques (décret n° 2007-532, art. 46). Les documents versés restent consultables ici.
        </p>
        {can('archives.manage') && !nouveau && <button type="button" onClick={() => setNouveau(true)} className="btn btn-primary btn-sm"><Plus size={14} /> Nouveau bordereau</button>}
      </div>
      {nouveau && <NouveauVersement onCree={(id) => { setNouveau(false); setOuvert(id); }} onAnnuler={() => setNouveau(false)} />}
      {!liste.length ? (
        <div className="glass-card-premium p-12 text-center"><Archive size={34} className="mx-auto text-slate-300 mb-2" /><p className="font-bold text-slate-800">Aucun bordereau de versement</p><p className="text-sm text-slate-500 mt-1">Créez-en un, ou sélectionnez des documents échus dans l'onglet « Sort final ».</p></div>
      ) : (
        <div className="glass-card-premium overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider"><tr><th className="text-left p-3">Bordereau</th><th className="text-left p-3">Destination</th><th className="text-left p-3">Statut</th><th className="text-left p-3">Documents</th><th className="text-left p-3">Dernière étape</th></tr></thead>
            <tbody>
              {liste.map((v) => (
                <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOuvert(v.id)}>
                  <td className="p-3"><strong>{v.numero}</strong><p className="text-xs text-slate-500">{v.intitule}</p></td>
                  <td className="p-3 text-xs">{DESTINATIONS[v.destination]}</td>
                  <td className="p-3"><Statut statut={v.statut} /></td>
                  <td className="p-3 text-xs">{v.nb_documents} · {taille(v.volume_octets)}</td>
                  <td className="p-3 text-xs">{dateFr(v.enregistre_at || v.transmis_at || v.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
