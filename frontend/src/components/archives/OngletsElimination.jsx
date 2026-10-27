import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hourglass, Trash2, Archive, Loader2, FileText, Gavel, ShieldAlert, Check, X, Send, Play, Undo2, Ban, Printer, Stamp } from 'lucide-react';
import {
  archivageService, SORTS, STATUTS_BORDEREAU, DECISIONS_VISA, MODES_DESTRUCTION, dateFr, taille,
} from '../../services/archivageService';
import ChoixDocument from './ChoixDocument';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../Toast';

/**
 * Onglets « Sort final » et « Éliminations » de la page Archivage
 * (migration 032) : documents dont la DUA est échue ou proche, décisions de
 * versement ou de conservation, bordereaux d'élimination avec séparation des
 * tâches (préparer et proposer ≠ valider), exécution et procès-verbal.
 */
const Statut = ({ statut }) => {
  const [l, c] = STATUTS_BORDEREAU[statut] || [statut, 'bg-slate-100'];
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c}`}>{l}</span>;
};

export const OngletSortFinal = ({ onBordereauCree, onVersementCree }) => {
  const { can } = usePermissions();
  const [horizon, setHorizon] = useState(0);
  const [vue, setVue] = useState(null);
  const [selection, setSelection] = useState(new Set());
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    setVue(null);
    archivageService.sortFinal({ horizon }).then(setVue).catch((err) => { toast.error(err.response?.data?.message || 'Chargement impossible'); setVue({ groupes: [], resume: {} }); });
    setSelection(new Set());
  }, [horizon]);
  useEffect(() => { charger(); }, [charger]);

  const basculer = (id) => setSelection((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const creerBordereau = async () => {
    setEnvoi(true);
    try {
      const r = await archivageService.creer({ document_ids: [...selection] });
      toast.success(`Bordereau ${r.bordereau.numero} créé (${r.ajoutes.length} document(s))`);
      onBordereauCree?.(r.bordereau.id);
    } catch (err) { toast.error(err.response?.data?.message || 'Création impossible'); } finally { setEnvoi(false); }
  };
  const creerVersement = async () => {
    setEnvoi(true);
    try {
      const r = await archivageService.creerVersement({ destination: 'archives_publiques', document_ids: [...selection] });
      toast.success(`Bordereau de versement ${r.versement.numero} créé (${r.ajoutes.length} document(s))${r.refuses.length ? `, ${r.refuses.length} refusé(s)` : ''}`);
      onVersementCree?.(r.versement.id);
    } catch (err) { toast.error(err.response?.data?.message || 'Création impossible'); } finally { setEnvoi(false); }
  };
  const decider = async (decision) => {
    const note = window.prompt(decision === 'versement' ? 'Note (facultative) — versement aux archives définitives :' : 'Motif de la conservation au-delà de la DUA (obligatoire) :');
    if (note === null) return;
    try {
      await archivageService.decider([...selection], decision, note);
      toast.success('Décision enregistrée');
      charger();
    } catch (err) { toast.error(err.response?.data?.message || 'Décision impossible'); }
  };

  if (!vue) return <div className="h-32 rounded-2xl skeleton" />;
  const r = vue.resume || {};
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[['À éliminer', r.a_eliminer, Trash2], ['À verser', r.a_verser, Archive], ['À trier', r.a_trier, Hourglass], ['Sous gel', r.geles, Gavel], ['Classes sans DUA (docs)', r.sans_dua, ShieldAlert]].map(([l, v, I]) => (
          <div key={l} className="glass-card-premium p-3"><p className="text-xs text-slate-500 flex items-center gap-1"><I size={12} /> {l}</p><p className="text-2xl font-black text-slate-900">{v ?? 0}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600 flex items-center gap-2">Inclure les échéances des
          <select className="input-premium w-auto py-1.5 text-sm" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
            <option value={0}>échues seulement</option><option value={3}>3 prochains mois</option><option value={6}>6 prochains mois</option><option value={12}>12 prochains mois</option>
          </select></label>
        {can('archives.manage') && selection.size > 0 && (
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" disabled={envoi} onClick={creerBordereau} className="btn btn-danger btn-sm">{envoi ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Bordereau d'élimination ({selection.size})</button>
            <button type="button" disabled={envoi} onClick={creerVersement} className="btn btn-secondary btn-sm"><Archive size={13} /> Bordereau de versement</button>
            <button type="button" onClick={() => decider('conservation')} className="btn btn-secondary btn-sm">Conserver</button>
          </span>
        )}
      </div>
      {vue.groupes.length === 0 ? (
        <div className="glass-card-premium p-12 text-center"><Hourglass size={34} className="mx-auto text-slate-300 mb-2" /><p className="font-bold text-slate-800">Aucune échéance à traiter</p>
          <p className="text-sm text-slate-500 mt-1">Définissez la DUA et le sort final de vos classes dans Classes et plan.</p></div>
      ) : vue.groupes.map((g) => (
        <section key={`${g.classe_id}-${g.sort_final}`} className="glass-card-premium overflow-hidden">
          <header className="px-4 py-3 bg-slate-50 flex flex-wrap items-center gap-2 text-sm">
            <strong>{g.classe}</strong><span className="text-slate-500">· DUA {g.dua_annees} an(s) · {SORTS[g.sort_final]}</span>
            {g.dua_reference && <span className="text-xs text-slate-400 truncate">· {g.dua_reference}</span>}
          </header>
          <ul className="divide-y divide-slate-100">
            {g.documents.map((d) => (
              <li key={d.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <input type="checkbox" disabled={!d.eligible && g.sort_final === 'elimination'} checked={selection.has(d.id)} onChange={() => basculer(d.id)} aria-label="Sélectionner" />
                <div className="flex-1 min-w-0">
                  <Link to={`/documents/liste?doc=${d.id}`} className="font-bold text-docuflow-secondary hover:underline">{d.reference}</Link>
                  <span className="text-slate-600"> {d.intitule}</span>
                  {d.motif && <p className="text-xs text-amber-700">{d.motif}</p>}
                  {d.bordereau && <p className="text-xs text-slate-500">Bordereau {d.bordereau.numero} ({STATUTS_BORDEREAU[d.bordereau.statut]?.[0]})</p>}
                </div>
                <span className={`text-xs font-semibold ${d.echu ? 'text-red-600' : 'text-slate-500'}`}>{d.echu ? 'Échu le' : 'Échéance'} {dateFr(d.echeance)}{d.depart_estime ? ' *' : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {vue.groupes.some((g) => g.documents.some((d) => d.depart_estime)) && <p className="text-xs text-slate-400">* Date du document absente : la DUA court depuis l'entrée dans la GED.</p>}
    </div>
  );
};

/** Saisie du visa reçu de l'autorité d'archives (décret n° 2007-532, art. 44). */
const FormulaireVisa = ({ b, onFait, onAnnuler }) => {
  const [f, setF] = useState({ decision: 'accorde', numero: '', date: '', observations: '', autorite: b.visa_autorite || '' });
  const [piece, setPiece] = useState(null);
  const [exclus, setExclus] = useState(new Set());
  const [envoi, setEnvoi] = useState(false);
  const maj = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const envoyer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await archivageService.action(b.id, 'visa', { ...f, piece_document_id: piece?.id || null, exclus: [...exclus] });
      toast.success(f.decision === 'refuse' ? 'Refus de visa enregistré : le bordereau est rejeté' : 'Visa enregistré');
      onFait();
    } catch (err) { toast.error(err.response?.data?.message || 'Enregistrement impossible'); } finally { setEnvoi(false); }
  };
  return (
    <form onSubmit={envoyer} className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2"><Stamp size={15} /> Visa de l'autorité d'archives</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs font-semibold text-slate-600 space-y-1">Décision
          <select className="input-premium text-sm" value={f.decision} onChange={(e) => maj('decision', e.target.value)}>
            {Object.entries(DECISIONS_VISA).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        <label className="text-xs font-semibold text-slate-600 space-y-1">N° du visa
          <input className="input-premium text-sm" required maxLength={100} value={f.numero} onChange={(e) => maj('numero', e.target.value)} placeholder="Ex. DAN/2026/014" /></label>
        <label className="text-xs font-semibold text-slate-600 space-y-1">Date du visa
          <input type="date" className="input-premium text-sm" required value={f.date} onChange={(e) => maj('date', e.target.value)} /></label>
      </div>
      <label className="block text-xs font-semibold text-slate-600 space-y-1">Autorité
        <input className="input-premium text-sm" maxLength={200} value={f.autorite} onChange={(e) => maj('autorite', e.target.value)} /></label>
      <label className="block text-xs font-semibold text-slate-600 space-y-1">Observations de l'autorité{f.decision === 'refuse' ? ' (obligatoires)' : ''}
        <textarea className="input-premium text-sm min-h-[60px]" maxLength={4000} required={f.decision === 'refuse'} value={f.observations} onChange={(e) => maj('observations', e.target.value)} /></label>
      <div className="text-xs font-semibold text-slate-600 space-y-1">Courrier de visa scanné (facultatif, versé dans la GED)
        <ChoixDocument valeur={piece} onChange={setPiece} /></div>
      {f.decision === 'partiel' && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold text-slate-600">Documents exclus par l'autorité (ils seront conservés)</legend>
          {b.lignes.filter((l) => !l.masque && l.document_id).map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={exclus.has(l.document_id)} onChange={() => setExclus((x) => { const n = new Set(x); if (n.has(l.document_id)) n.delete(l.document_id); else n.add(l.document_id); return n; })} />
              <strong>{l.reference}</strong> <span className="text-slate-600 truncate">{l.intitule}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onAnnuler} className="btn btn-secondary btn-sm">Annuler</button>
        <button type="submit" disabled={envoi} className="btn btn-primary btn-sm">{envoi && <Loader2 size={13} className="animate-spin" />} Enregistrer le visa</button>
      </div>
    </form>
  );
};

/** Exécution : mode de destruction et contrôle (décret n° 2007-532, art. 44). */
const FormulaireExecution = ({ b, onFait, onAnnuler }) => {
  const [f, setF] = useState({ mode_destruction: 'sur_place', prestataire: '', controle_par: '' });
  const [envoi, setEnvoi] = useState(false);
  const maj = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const envoyer = async (e) => {
    e.preventDefault();
    if (!window.confirm(`Exécuter l'élimination ? Les fichiers des documents visés seront DÉTRUITS définitivement.`)) return;
    setEnvoi(true);
    try {
      const r = await archivageService.action(b.id, 'execution', f);
      toast.success(`Élimination exécutée : ${r.elimines.length} document(s)${r.ecartes.length ? `, ${r.ecartes.length} écarté(s)` : ''}`);
      onFait();
    } catch (err) { toast.error(err.response?.data?.message || 'Exécution impossible'); } finally { setEnvoi(false); }
  };
  return (
    <form onSubmit={envoyer} className="rounded-xl border border-red-200 bg-red-50/50 p-4 space-y-3">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-2"><Play size={15} /> Exécuter l'élimination</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs font-semibold text-slate-600 space-y-1">Mode de destruction
          <select className="input-premium text-sm" value={f.mode_destruction} onChange={(e) => maj('mode_destruction', e.target.value)}>
            {Object.entries(MODES_DESTRUCTION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        {f.mode_destruction === 'prestataire' && (
          <label className="text-xs font-semibold text-slate-600 space-y-1">Entreprise
            <input className="input-premium text-sm" required maxLength={200} value={f.prestataire} onChange={(e) => maj('prestataire', e.target.value)} /></label>
        )}
        <label className="text-xs font-semibold text-slate-600 space-y-1">Contrôle de l'autorité (nom, qualité)
          <input className="input-premium text-sm" maxLength={200} value={f.controle_par} onChange={(e) => maj('controle_par', e.target.value)} placeholder="Facultatif" /></label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onAnnuler} className="btn btn-secondary btn-sm">Annuler</button>
        <button type="submit" disabled={envoi} className="btn btn-danger btn-sm">{envoi && <Loader2 size={13} className="animate-spin" />} Détruire définitivement</button>
      </div>
    </form>
  );
};

const DetailBordereau = ({ id, onRetour }) => {
  const [b, setB] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [formulaire, setFormulaire] = useState(null); // 'visa' | 'execution' | null
  const charger = useCallback(() => archivageService.bordereau(id).then(setB).catch((err) => toast.error(err.response?.data?.message || 'Chargement impossible')), [id]);
  useEffect(() => { charger(); }, [charger]);
  const agir = async (action, corps, succes, confirmation) => {
    if (confirmation && !window.confirm(confirmation)) return;
    setEnvoi(true);
    try { await archivageService.action(id, action, corps); toast.success(succes); charger(); } catch (err) { toast.error(err.response?.data?.message || 'Action impossible'); } finally { setEnvoi(false); }
  };
  if (!b) return <div className="h-32 rounded-2xl skeleton" />;
  const a = b.actions || {};
  return (
    <div className="space-y-4">
      <button type="button" onClick={onRetour} className="text-sm text-slate-500 hover:text-slate-800">← Tous les bordereaux</button>
      <div className="glass-card-premium p-5 space-y-2">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-lg text-slate-900">{b.numero}</h3><Statut statut={b.statut} /></div>
        <p className="text-sm text-slate-700">{b.intitule}</p>
        <p className="text-xs text-slate-500">
          Préparé par {b.created_by_nom || '—'}{b.propose_par_nom ? ` · proposé par ${b.propose_par_nom} le ${dateFr(b.propose_at)}` : ''}
          {b.valide_par_nom ? ` · ${b.statut === 'rejete' ? 'rejeté' : 'validé'} par ${b.valide_par_nom} le ${dateFr(b.valide_at)}` : ''}
          {b.execute_par_nom ? ` · exécuté par ${b.execute_par_nom} le ${dateFr(b.execute_at)}` : ''}
        </p>
        {b.motif_rejet && <p className="text-sm text-red-700">Motif du rejet : {b.motif_rejet}</p>}
        {b.visa_requis && (
          <p className="text-xs text-slate-600">
            {b.transmis_at ? `Transmis à ${b.visa_autorite || "l'autorité d'archives"} le ${dateFr(b.transmis_at)} par ${b.transmis_par_nom}` : "Le visa de l'autorité d'archives sera requis avant l'exécution (décret n° 2007-532, art. 44)."}
            {b.visa_numero && ` · ${DECISIONS_VISA[b.visa_decision]} n° ${b.visa_numero} du ${dateFr(b.visa_date)}`}
            {b.visa_observations && ` · « ${b.visa_observations} »`}
          </p>
        )}
        {b.mode_destruction && <p className="text-xs text-slate-600">{MODES_DESTRUCTION[b.mode_destruction]}{b.prestataire ? ` : ${b.prestataire}` : ''}{b.controle_par ? ` · sous le contrôle de ${b.controle_par}` : ''}</p>}
        <p className="text-xs text-slate-500">{b.totaux.documents} document(s) · {b.totaux.fichiers} fichier(s) · {taille(b.totaux.volume_octets)}</p>
        {a.separation && <p className="text-xs text-amber-700">Vous avez préparé ou proposé ce bordereau : un autre valideur doit le valider (séparation des tâches).</p>}
        <div className="flex flex-wrap gap-2 pt-2">
          {a.proposer && <button type="button" disabled={envoi} onClick={() => agir('proposition', {}, 'Bordereau proposé à la validation')} className="btn btn-primary btn-sm"><Send size={13} /> Proposer</button>}
          {a.retirer && <button type="button" disabled={envoi} onClick={() => agir('retrait', {}, 'Proposition retirée')} className="btn btn-secondary btn-sm"><Undo2 size={13} /> Retirer la proposition</button>}
          {a.valider && <button type="button" disabled={envoi} onClick={() => agir('validation', {}, 'Bordereau validé', 'Valider ce bordereau ? Les documents pourront être détruits.')} className="btn btn-primary btn-sm"><Check size={13} /> Valider</button>}
          {a.rejeter && <button type="button" disabled={envoi} onClick={() => { const m = window.prompt('Motif du rejet :'); if (m) agir('rejet', { motif: m }, 'Bordereau rejeté'); }} className="btn btn-secondary btn-sm text-red-600"><X size={13} /> Rejeter</button>}
          {a.reprendre && <button type="button" disabled={envoi} onClick={() => agir('reprise', {}, 'Bordereau repris en brouillon')} className="btn btn-secondary btn-sm"><Undo2 size={13} /> Reprendre</button>}
          {a.transmettre && <button type="button" disabled={envoi} onClick={() => agir('transmission', {}, "Bordereau transmis à l'autorité d'archives", "Marquer le bordereau comme transmis à l'autorité d'archives ? Imprimez-le d'abord pour l'envoyer.")} className="btn btn-primary btn-sm"><Send size={13} /> Transmettre pour visa</button>}
          {a.saisir_visa && <button type="button" disabled={envoi} onClick={() => setFormulaire('visa')} className="btn btn-primary btn-sm"><Stamp size={13} /> Enregistrer le visa reçu</button>}
          {a.executer && <button type="button" disabled={envoi} onClick={() => setFormulaire('execution')} className="btn btn-danger btn-sm"><Play size={13} /> Exécuter l'élimination</button>}
          {['valide', 'transmis', 'vise', 'execute'].includes(b.statut) && <Link to={`/documents/archivage/bordereaux/${b.id}/imprimer`} target="_blank" className="btn btn-secondary btn-sm"><Printer size={13} /> Imprimer le bordereau</Link>}
          {a.annuler && <button type="button" disabled={envoi} onClick={() => { const m = window.prompt("Motif de l'annulation :"); if (m) agir('annulation', { motif: m }, 'Bordereau annulé'); }} className="btn btn-secondary btn-sm"><Ban size={13} /> Annuler</button>}
          {b.statut === 'execute' && <Link to={`/documents/archivage/bordereaux/${b.id}/pv`} target="_blank" className="btn btn-secondary btn-sm"><FileText size={13} /> Procès-verbal</Link>}
        </div>
      </div>
      {formulaire === 'visa' && <FormulaireVisa b={b} onFait={() => { setFormulaire(null); charger(); }} onAnnuler={() => setFormulaire(null)} />}
      {formulaire === 'execution' && <FormulaireExecution b={b} onFait={() => { setFormulaire(null); charger(); }} onAnnuler={() => setFormulaire(null)} />}
      <div className="glass-card-premium overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider"><tr><th className="text-left p-3">Document</th><th className="text-left p-3">Échéance</th><th className="text-left p-3">Fichiers</th><th className="text-left p-3">État</th></tr></thead>
          <tbody>
            {b.lignes.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="p-3">{l.masque ? <span className="text-slate-400">Document hors de votre périmètre</span> : <><strong>{l.reference}</strong> <span className="text-slate-600">{l.intitule}</span>{l.alerte && <p className="text-xs text-amber-700">{l.alerte}</p>}</>}</td>
                <td className="p-3 text-xs">{dateFr(l.echeance)}</td>
                <td className="p-3 text-xs">{l.nb_fichiers} · {taille(l.volume_octets)}</td>
                <td className="p-3 text-xs">{l.resultat === 'elimine' ? 'Éliminé' : l.resultat === 'ecarte' ? `Écarté${l.motif_ecart ? ` : ${l.motif_ecart}` : ''}` : 'Inscrit'}
                  {a.modifier && !l.masque && l.document_id && <button type="button" onClick={async () => { await archivageService.retirer(b.id, l.document_id).catch((e) => toast.error(e.response?.data?.message || 'Retrait impossible')); charger(); }} className="ml-2 text-red-600 font-semibold">Retirer</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const OngletEliminations = ({ ouvert, setOuvert }) => {
  const [liste, setListe] = useState(null);
  useEffect(() => { if (!ouvert) archivageService.bordereaux().then(setListe).catch(() => setListe([])); }, [ouvert]);
  if (ouvert) return <DetailBordereau id={ouvert} onRetour={() => setOuvert(null)} />;
  if (liste === null) return <div className="h-32 rounded-2xl skeleton" />;
  if (!liste.length) return <div className="glass-card-premium p-12 text-center"><Trash2 size={34} className="mx-auto text-slate-300 mb-2" /><p className="font-bold text-slate-800">Aucun bordereau</p><p className="text-sm text-slate-500 mt-1">Sélectionnez des documents échus dans l'onglet « Sort final » pour préparer un bordereau d'élimination.</p></div>;
  return (
    <div className="glass-card-premium overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider"><tr><th className="text-left p-3">Bordereau</th><th className="text-left p-3">Statut</th><th className="text-left p-3">Documents</th><th className="text-left p-3">Dernière étape</th></tr></thead>
        <tbody>
          {liste.map((b) => (
            <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOuvert(b.id)}>
              <td className="p-3"><strong>{b.numero}</strong><p className="text-xs text-slate-500">{b.intitule}</p></td>
              <td className="p-3"><Statut statut={b.statut} /></td>
              <td className="p-3 text-xs">{b.nb_documents ?? '—'} · {taille(b.volume_octets)}</td>
              <td className="p-3 text-xs">{dateFr(b.execute_at || b.valide_at || b.propose_at || b.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
