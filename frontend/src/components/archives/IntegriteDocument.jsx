import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Fingerprint, RefreshCw, Loader2, Copy, Gavel, Award, Files, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import {
  archivesService, STATUTS_INTEGRITE, empreinteCourte, dateHeure, dateCourte,
} from '../../services/archivesService';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../Toast';

/**
 * Carte « Intégrité & preuve » de la fiche d'un document (migration 031) :
 * empreinte SHA-256 et état de chaque version, doublons, gel juridique,
 * certificat d'archivage.
 */
const Badge = ({ statut }) => {
  const s = STATUTS_INTEGRITE[statut] || STATUTS_INTEGRITE.attente;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${s.classe}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.point}`} /> {s.libelle}
    </span>
  );
};

const copier = async (texte) => {
  try {
    await navigator.clipboard.writeText(texte);
    toast.success('Empreinte copiée');
  } catch {
    toast.error('Copie impossible');
  }
};

const IntegriteDocument = ({ documentId, onChanged }) => {
  const { can } = usePermissions();
  const [etat, setEtat] = useState(null);
  const [verification, setVerification] = useState(false);
  const [formulaire, setFormulaire] = useState(null); // 'poser' | 'lever' | null
  const [motif, setMotif] = useState('');
  const [reference, setReference] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    archivesService.etatDocument(documentId).then(setEtat).catch(() => setEtat({ fichiers: [], gel: null, indisponible: true }));
  }, [documentId]);
  useEffect(() => { charger(); }, [charger]);

  const verifier = async () => {
    setVerification(true);
    try {
      const { resultats } = await archivesService.verifierDocument(documentId);
      const ko = resultats.filter((r) => r.statut !== 'intacte');
      if (ko.length) toast.error(`${ko.length} version(s) non conforme(s) à l'empreinte d'archivage`);
      else toast.success(`${resultats.length} version(s) vérifiée(s) : conformes`);
      charger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Vérification impossible');
    } finally {
      setVerification(false);
    }
  };

  const ouvrir = (quoi) => { setFormulaire(quoi); setMotif(''); setReference(''); };

  const envoyerGel = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      if (formulaire === 'poser') {
        await archivesService.poserGel(documentId, { motif, reference });
        toast.success('Gel juridique posé : le document ne peut plus être détruit');
      } else {
        await archivesService.leverGel(documentId, motif);
        toast.success('Gel juridique levé');
      }
      setFormulaire(null);
      charger();
      if (onChanged) onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Opération impossible');
    } finally {
      setEnvoi(false);
    }
  };

  if (etat?.indisponible) return null;
  const peutGeler = can('archives.hold');
  const gel = etat?.gel;

  return (
    <div className="glass-card-premium p-5 space-y-3" data-tour="integrite-document">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5"><Fingerprint size={14} /> Intégrité & preuve</span>
        <button type="button" onClick={verifier} disabled={verification || !etat?.fichiers?.length}
          className="text-[11px] font-bold text-docuflow-secondary flex items-center gap-1 normal-case tracking-normal disabled:opacity-40">
          {verification ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Vérifier
        </button>
      </h3>

      {!etat ? <div className="h-16 skeleton rounded-xl" /> : (
        <>
          {gel ? (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs space-y-1">
              <p className="font-bold text-red-700 flex items-center gap-1.5"><Gavel size={13} /> Sous gel juridique{gel.reference ? ` — ${gel.reference}` : ''}</p>
              <p className="text-red-700/90">{gel.motif}</p>
              <p className="text-red-600/70">Posé par {gel.pose_par || '—'} le {dateCourte(gel.pose_at)} · aucune destruction possible (corbeille, purge, élimination, retrait de version).</p>
              {peutGeler && formulaire !== 'lever' && (
                <button type="button" onClick={() => ouvrir('lever')} className="font-bold text-red-700 underline underline-offset-2">Lever le gel…</button>
              )}
            </div>
          ) : peutGeler && formulaire !== 'poser' && (
            <button type="button" onClick={() => ouvrir('poser')} className="text-xs font-bold text-slate-600 hover:text-red-700 flex items-center gap-1.5">
              <Gavel size={13} /> Poser un gel juridique…
            </button>
          )}

          {formulaire && (
            <form onSubmit={envoyerGel} className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <p className="text-xs font-bold text-slate-700">{formulaire === 'poser' ? 'Geler le document' : 'Lever le gel'}</p>
              <textarea className="input-premium text-sm min-h-[64px]" required maxLength={2000} value={motif} onChange={(e) => setMotif(e.target.value)}
                placeholder={formulaire === 'poser' ? 'Motif : contentieux, contrôle fiscal, enquête…' : 'Motif de la levée : jugement définitif, clôture du contrôle…'} />
              {formulaire === 'poser' && (
                <input className="input-premium text-sm" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Référence de l'affaire (facultatif)" />
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setFormulaire(null)} className="btn btn-secondary btn-sm">Annuler</button>
                <button type="submit" disabled={envoi || !motif.trim()} className={`btn btn-sm ${formulaire === 'poser' ? 'btn-danger' : 'btn-primary'}`}>
                  {envoi && <Loader2 size={13} className="animate-spin" />} {formulaire === 'poser' ? 'Geler' : 'Lever le gel'}
                </button>
              </div>
            </form>
          )}

          {etat.fichiers.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun fichier : rien à vérifier.</p>
          ) : (
            <ul className="space-y-2">
              {etat.fichiers.map((f) => (
                <li key={f.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-700 truncate" title={f.original_name}>v{f.version} · {f.original_name}</span>
                    <Badge statut={f.empreinte_sha256 ? (f.integrite_statut || 'attente') : (f.integrite_statut || 'attente')} />
                  </div>
                  {f.empreinte_sha256 ? (
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <span className="font-mono text-[11px]" title={f.empreinte_sha256}>SHA-256 {empreinteCourte(f.empreinte_sha256)}</span>
                      <button type="button" onClick={() => copier(f.empreinte_sha256)} className="text-slate-400 hover:text-docuflow-secondary" aria-label="Copier l'empreinte"><Copy size={11} /></button>
                    </div>
                  ) : (
                    <p className="text-slate-400">Empreinte en cours de calcul (fichier antérieur à l'archivage probant).</p>
                  )}
                  <p className="text-[11px] text-slate-400">
                    {f.empreinte_origine === 'rattrapage' ? `Empreinte calculée le ${dateCourte(f.empreinte_at)} (après versement)` : f.empreinte_at ? `Empreinte au versement, le ${dateCourte(f.empreinte_at)}` : ''}
                    {f.integrite_verifiee_at && ` · contrôlé le ${dateHeure(f.integrite_verifiee_at)}`}
                  </p>
                  {f.doublons?.length > 0 && (
                    <p className="text-[11px] text-amber-700 flex items-start gap-1">
                      <Files size={12} className="mt-0.5 flex-shrink-0" />
                      <span>Même fichier que {f.doublons.map((d, i) => (
                        <React.Fragment key={d.id}>{i > 0 && ', '}<Link to={`/documents/liste?doc=${d.id}`} className="font-bold underline underline-offset-2">{d.reference_mfile}</Link></React.Fragment>
                      ))}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              {etat.fichiers.some((f) => ['alteree', 'introuvable'].includes(f.integrite_statut))
                ? <><ShieldAlert size={12} className="text-red-500" /> Anomalie constatée</>
                : <><ShieldCheck size={12} className="text-emerald-500" /> {etat.evenements?.chaines || 0} événement(s) au journal chaîné</>}
            </span>
            <Link to={`/documents/certificat/${documentId}`} target="_blank" rel="noopener" className="text-xs font-bold text-docuflow-secondary flex items-center gap-1 hover:underline">
              <Award size={13} /> Certificat d'archivage
            </Link>
          </div>
        </>
      )}
    </div>
  );
};

export default IntegriteDocument;
