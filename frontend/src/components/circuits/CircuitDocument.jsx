import React, { useCallback, useEffect, useState } from 'react';
import { GitBranch, Play, Loader2, Ban, RotateCcw, AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react';
import { circuitService, STATUT_ETAPE, DECISION, quand } from '../../services/circuitService';
import DecisionTache from './DecisionTache';
import { toast } from '../Toast';

/**
 * Carte « Circuit de validation » de la fiche (migration 034) : démarrer un
 * circuit, suivre ses étapes et leurs visas (avec l'empreinte de la version
 * visée), décider si l'on est destinataire, annuler ou reprendre.
 */
const DESTINATAIRE = { utilisateur: '', role: 'rôle ', groupe: 'groupe ' };

const CircuitDocument = ({ documentId, onChanged }) => {
  const [etat, setEtat] = useState(null);
  const [choix, setChoix] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    circuitService.etatDocument(documentId).then((e) => {
      setEtat(e);
      setChoix(String(e.circuit_par_defaut_id || e.circuits_disponibles?.[0]?.id || ''));
    }).catch(() => setEtat({ disponible: false }));
  }, [documentId]);
  useEffect(() => { charger(); }, [charger]);

  const apres = () => { charger(); onChanged?.(); };
  const agir = async (fn, succes) => {
    setEnvoi(true);
    try {
      await fn();
      toast.success(succes);
      apres();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action impossible');
    } finally {
      setEnvoi(false);
    }
  };

  if (!etat || etat.disponible === false) return null;
  const inst = etat.instance;
  if (!inst && !etat.peut_demarrer && !etat.historique?.length) return null;

  return (
    <div className="glass-card-premium p-5 space-y-3" data-tour="circuit-document">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5"><GitBranch size={14} /> Circuit de validation</span>
        {inst && <span className={`badge ${inst.en_retard ? 'badge-warn' : 'badge-ok'} normal-case tracking-normal`}>{inst.en_retard ? 'En retard' : 'En cours'}</span>}
      </h3>

      {!inst && etat.peut_demarrer && (
        <div className="flex flex-wrap items-center gap-2">
          {etat.circuits_disponibles.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun circuit configuré (Documents › Circuits de validation).</p>
          ) : (
            <>
              <select className="input-premium text-sm flex-1 min-w-[160px]" value={choix} onChange={(e) => setChoix(e.target.value)}>
                {etat.circuits_disponibles.map((c) => <option key={c.id} value={c.id}>{c.nom}{c.par_defaut_classe ? ' (circuit de la classe)' : ''} · {c.nb_etapes} étape(s)</option>)}
              </select>
              <button type="button" disabled={envoi || !choix} className="btn btn-primary btn-sm"
                onClick={() => agir(() => circuitService.demarrer(documentId, Number(choix)), 'Circuit démarré')}>
                {envoi ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Soumettre à validation
              </button>
            </>
          )}
        </div>
      )}

      {inst && (
        <>
          <p className="text-xs text-slate-500">« {inst.circuit_nom} » · lancé par {inst.demarre_par_nom || '—'} le {quand(inst.demarre_at)}{inst.demarrage === 'automatique' ? ' (automatique)' : ''}</p>
          {inst.visas_anterieurs && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 flex gap-1.5">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              {inst.visas_anterieurs.nb} visa(s) portent sur la version {inst.visas_anterieurs.version} ; la version courante est la {inst.visas_anterieurs.version_courante}.
            </p>
          )}
          <ol className="space-y-2">
            {inst.etapes.map((e) => (
              <li key={e.rang} className="flex gap-2.5">
                <span className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${STATUT_ETAPE[e.statut] || 'bg-slate-200'}`} />
                <div className="flex-1 min-w-0 text-xs">
                  <p className="font-semibold text-slate-800">{e.rang}. {e.libelle} <span className="font-normal text-slate-400">· {DESTINATAIRE[e.type_assignation] || ''}{e.assigne_libelle || ''}{e.regle === 'tous' ? ' · tous' : ''}{e.action === 'information' ? ' · pour information' : ''}</span></p>
                  {e.visas.map((v) => (
                    <p key={v.id} className="text-slate-600 flex items-center gap-1">
                      {v.integre ? <ShieldCheck size={11} className="text-emerald-500" /> : <ShieldAlert size={11} className="text-red-500" />}
                      {DECISION[v.decision] || v.decision} par {v.signataire_nom}{v.pour_le_compte_de ? ` (pour ${v.pour_le_compte_de})` : ''} le {quand(v.signe_at)}
                      {v.document_version ? ` · v${v.document_version}` : ''}
                      {v.empreinte_sha256 && <span className="font-mono text-slate-400" title={v.empreinte_sha256}> {v.empreinte_sha256.slice(0, 8)}…</span>}
                    </p>
                  ))}
                  {e.statut === 'en cours' && e.taches.filter((t) => t.statut === 'à traiter').map((t) => (
                    <p key={t.id} className={t.en_retard ? 'text-red-600' : 'text-slate-500'}>
                      En attente : {t.assigne_nom}{t.echeance_at ? ` · échéance ${quand(t.echeance_at)}` : ''}
                    </p>
                  ))}
                  {e.visas.filter((v) => v.commentaire).map((v) => <p key={`c${v.id}`} className="text-slate-500 italic">« {v.commentaire} »</p>)}
                </div>
              </li>
            ))}
          </ol>
          {etat.mes_taches.map((t) => (
            <div key={t.id} className="p-3 rounded-xl bg-blue-50/60 border border-blue-100 space-y-2">
              <p className="text-xs font-bold text-docuflow-secondary">À vous de jouer{t.en_retard ? ' — en retard' : ''}</p>
              <DecisionTache tache={t} onDone={apres} />
            </div>
          ))}
          {etat.peut_annuler && (
            <div className="flex flex-wrap gap-3 pt-1 text-xs">
              <button type="button" className="font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
                onClick={() => { const m = window.prompt('Motif de la reprise (le circuit repart de la première étape) :'); if (m) agir(() => circuitService.reprendre(documentId, m), 'Circuit repris'); }}>
                <RotateCcw size={12} /> Reprendre
              </button>
              <button type="button" className="font-semibold text-red-600 flex items-center gap-1"
                onClick={() => { const m = window.prompt("Motif de l'annulation :"); if (m) agir(() => circuitService.annuler(documentId, m), 'Circuit annulé'); }}>
                <Ban size={12} /> Annuler le circuit
              </button>
            </div>
          )}
        </>
      )}

      {!inst && etat.historique?.length > 0 && (
        <p className="text-[11px] text-slate-400">
          Dernier circuit : « {etat.historique[0].circuit_nom} » — {etat.historique[0].statut}
          {etat.historique[0].termine_at ? ` le ${quand(etat.historique[0].termine_at)}` : ''}{etat.historique[0].motif_fin ? ` (${etat.historique[0].motif_fin})` : ''}
        </p>
      )}
    </div>
  );
};

export default CircuitDocument;
