import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, ShieldAlert, RefreshCw, Loader2, Settings2, Bot, ScrollText, FileStack, Hourglass, Building2,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import AlerteCarte from '../components/conformite/AlerteCarte';
import { conformiteService, SEVERITES, NATURES } from '../services/conformiteService';
import { usePermissions } from '../hooks/usePermissions';
import { useTitrePage } from '../hooks/useTitrePage';
import { toast } from '../components/Toast';

/**
 * Conformité — le contrôle des documents ENTRE EUX.
 *
 * Chaque document versé est lu (émetteur, montants, dates, identifiants) ;
 * les lectures sont rapprochées et les contradictions deviennent des
 * alertes : numéro d'entreprise incohérent, facture hors devis, facture
 * antérieure au devis, attestation expirée, registre officiel.
 */
const FILTRES_STATUT = [
  { valeur: 'ouverte', libelle: 'À traiter' },
  { valeur: 'traitee', libelle: 'Traitées' },
  { valeur: 'ignoree', libelle: 'Ignorées' },
  { valeur: 'resolue', libelle: 'Résolues' },
  { valeur: 'toutes', libelle: 'Toutes' },
];

const Anneau = ({ valeur }) => {
  const r = 52;
  const c = 2 * Math.PI * r;
  const couleur = valeur >= 90 ? '#10b981' : valeur >= 70 ? '#f59e0b' : '#ef4444';
  return (
    <svg viewBox="0 0 120 120" className="w-32 h-32" role="img" aria-label={`Taux de conformité : ${valeur} %`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={couleur} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${(valeur / 100) * c} ${c}`} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray .8s cubic-bezier(.16,1,.3,1)' }} />
      <text x="60" y="58" textAnchor="middle" className="fill-slate-900" style={{ fontSize: 24, fontWeight: 900 }}>{Math.round(valeur)}%</text>
      <text x="60" y="76" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 9, fontWeight: 700 }}>CONFORMES</text>
    </svg>
  );
};

const ConformitePage = () => {
  useTitrePage('Conformité');
  const { can } = usePermissions();
  const peutGerer = can('compliance.manage');
  const [tableau, setTableau] = useState(null);
  const [alertes, setAlertes] = useState(null);
  const [statut, setStatut] = useState('ouverte');
  const [severite, setSeverite] = useState('');
  const [type, setType] = useState('');
  const [calcul, setCalcul] = useState(false);

  const charger = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([
        conformiteService.tableauDeBord(),
        conformiteService.alertes({ statut, severite: severite || undefined, type: type || undefined }),
      ]);
      setTableau(t);
      setAlertes(a);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Chargement de la conformité impossible');
      setAlertes([]);
    }
  }, [statut, severite, type]);
  useEffect(() => { charger(); }, [charger]);

  const relancer = async (analyser) => {
    setCalcul(true);
    try {
      const r = await conformiteService.recalculer({ analyser });
      toast.success(r.message);
      setTimeout(charger, analyser ? 4000 : 0);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Recalcul impossible');
    } finally {
      setCalcul(false);
    }
  };

  const types = useMemo(() => [...new Map((alertes || []).map((a) => [a.type, a.type_libelle])).entries()], [alertes]);
  const cfg = tableau?.configuration;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Conformité"
        subtitle="Les documents contrôlés entre eux : identifiants, montants, chronologie, validité"
        icon={ShieldCheck}
        breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Conformité' }]}
        actions={peutGerer && (
          <>
            <button type="button" disabled={calcul} onClick={() => relancer(false)} className="btn btn-secondary">
              {calcul ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Recalculer
            </button>
            <button type="button" disabled={calcul} onClick={() => relancer(true)} className="btn btn-primary" title="Relire tous les documents puis recalculer">
              <FileStack size={16} /> Relancer l'analyse
            </button>
          </>
        )}
      />

      {!tableau ? (
        <div className="grid md:grid-cols-4 gap-4 mb-6">{[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-2xl skeleton" />)}</div>
      ) : (
        <>
          <div className="grid lg:grid-cols-[auto_1fr] gap-5 mb-6">
            <div className="glass-card-premium p-5 flex items-center gap-5">
              <Anneau valeur={tableau.taux_conformite} />
              <div className="space-y-1 text-sm">
                <p><strong className="text-2xl font-black text-slate-900">{tableau.total_documents}</strong> <span className="text-slate-500">documents analysés</span></p>
                <p className="text-emerald-600 font-semibold">{tableau.documents_conformes} conformes</p>
                <p className="text-red-600 font-semibold">{tableau.documents_non_conformes} à vérifier</p>
                {tableau.documents_en_attente > 0 && <p className="text-slate-400 text-xs flex items-center gap-1"><Hourglass size={12} /> {tableau.documents_en_attente} en attente d'analyse</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {['critique', 'haute', 'moyenne', 'faible'].map((s) => (
                <button key={s} type="button" onClick={() => { setSeverite(severite === s ? '' : s); setStatut('ouverte'); }}
                  className={`glass-card-premium p-4 text-left transition-all ${severite === s ? 'ring-2 ring-docuflow-secondary' : ''}`}>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-bold ${SEVERITES[s].classe}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${SEVERITES[s].point}`} /> {SEVERITES[s].libelle}
                  </span>
                  <p className="text-3xl font-black text-slate-900 mt-2">{tableau[`alertes_${s === 'critique' ? 'critiques' : s === 'haute' ? 'hautes' : s === 'moyenne' ? 'moyennes' : 'faibles'}`]}</p>
                  <p className="text-xs text-slate-500">alerte(s) ouverte(s)</p>
                </button>
              ))}
            </div>
          </div>

          <div className="glass-card-premium p-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
            <span className="flex items-center gap-1.5"><Settings2 size={14} className="text-slate-400" /> Référentiel : <strong>{cfg.referentiel_libelle}</strong></span>
            <span>Tolérance devis/facture : <strong>{cfg.tolerance_montant} %</strong></span>
            <span className="flex items-center gap-1.5"><Bot size={14} className="text-slate-400" /> Lecture : <strong>{cfg.modele ? `modèle ${cfg.modele}` : 'règles intégrées'}</strong></span>
            <span className="flex items-center gap-1.5"><ScrollText size={14} className="text-slate-400" /> Registre officiel : <strong>{cfg.registre_officiel ? 'vérifié' : 'non vérifié'}</strong></span>
            {!cfg.analyse_active && <span className="text-amber-700 font-semibold">Analyse automatique désactivée</span>}
            <span className="ml-auto flex items-center gap-3">
              {Object.entries(tableau.par_nature || {}).map(([nat, nb]) => <span key={nat}>{NATURES[nat] || nat} : <strong>{nb}</strong></span>)}
              <Link to="/documents/fournisseurs" className="font-bold text-docuflow-secondary hover:underline flex items-center gap-1"><Building2 size={13} /> Fournisseurs</Link>
            </span>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="segmented">
          {FILTRES_STATUT.map((f) => (
            <button key={f.valeur} type="button" aria-pressed={statut === f.valeur} onClick={() => setStatut(f.valeur)}>{f.libelle}</button>
          ))}
        </div>
        <select className="input-premium w-auto py-2 text-sm" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type d'alerte">
          <option value="">Tous les types</option>
          {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {severite && <button type="button" onClick={() => setSeverite('')} className="text-xs font-bold text-docuflow-secondary">Sévérité : {SEVERITES[severite].libelle} ✕</button>}
      </div>

      {alertes === null ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-28 rounded-2xl skeleton" />)}</div>
      ) : alertes.length === 0 ? (
        <div className="glass-card-premium p-12 text-center">
          {statut === 'ouverte' ? <ShieldCheck size={36} className="mx-auto text-emerald-500 mb-3" /> : <ShieldAlert size={36} className="mx-auto text-slate-300 mb-3" />}
          <p className="font-bold text-slate-800">{statut === 'ouverte' ? 'Aucune incohérence à traiter' : 'Aucune alerte dans cette liste'}</p>
          <p className="text-sm text-slate-500 mt-1">Les documents versés sont analysés automatiquement, puis contrôlés entre eux.</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {alertes.map((a) => <AlerteCarte key={a.id} alerte={a} peutGerer={peutGerer} onChange={charger} />)}
        </div>
      )}
    </div>
  );
};

export default ConformitePage;
