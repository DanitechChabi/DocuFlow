import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareWarning, Send, Loader2, X, Undo2, CheckCircle2, Reply } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { requestService } from '../../../services/requestService';
import { toast } from '../../../components/Toast';
import { intitule, references, dateCourte } from './vocabulaire';

// ============================================================================
// Compléments d'une demande (051). L'archive renvoie une demande insuffisante
// à son auteur — « À compléter » — en cochant ce qui manque et en ajoutant un
// mot ; le demandeur la complète et la renvoie depuis « Mes dossiers ».
// ============================================================================

export const CHAMPS = [
  { cle: 'nom_entreprise', label: 'Nom de l\'entreprise', exemple: 'ex. Agro Fictive' },
  { cle: 'num_acte', label: 'N° d\'acte', exemple: '2026/1234' },
  { cle: 'num_dossier', label: 'N° de dossier', exemple: '004523.0008' },
  { cle: 'annee', label: 'Année', exemple: '2024' },
  { cle: 'banque', label: 'Banque', exemple: 'ex. Banque Fictive' },
  { cle: 'type_document', label: 'Typologie' },
  { cle: 'montant', label: 'Montant', exemple: 'ex. 2 500 000' },
  { cle: 'description', label: 'Précisions' },
];
const libelle = (cle) => CHAMPS.find((c) => c.cle === cle)?.label || cle;

// Les motifs les plus fréquents, en un clic.
const MOTS = [
  'Plusieurs dossiers portent ce nom : précisez lequel.',
  'Le n° d\'acte ne correspond à aucun dossier.',
  'Aucun dossier à ce nom dans les entrées des archives.',
  'Indiquez l\'année du dossier.',
];

const vide = (v) => v === undefined || v === null || String(v).trim() === '';

/** L'archiviste renvoie la demande : ce qui manque, un mot au demandeur. */
export const ModaleComplement = ({ dossier, onClose, onFait }) => {
  const [champs, setChamps] = useState(() => new Set(['num_acte', 'annee'].filter((c) => dossier && vide(dossier[c]))));
  const [message, setMessage] = useState('');
  const [envoi, setEnvoi] = useState(false);
  if (!dossier) return null;
  const basculer = (c) => setChamps((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const envoyer = async () => {
    if (!champs.size && !message.trim()) { toast.error('Cochez ce qui manque ou écrivez un mot au demandeur.'); return; }
    setEnvoi(true);
    try {
      await requestService.demanderComplement(dossier.id, { champs: [...champs], message });
      toast.success(`Renvoyée à ${dossier.requester_name || 'son auteur'} pour compléments : ${intitule(dossier)}.`);
      onFait?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.message || 'La demande n\'a pas pu être renvoyée.');
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Modal open onClose={envoi ? undefined : onClose} panelClassName="w-full max-w-xl mx-4">
      <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 px-6 py-5 bg-amber-50 border-b border-amber-200">
          <span className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0"><MessageSquareWarning size={20} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-slate-900">Demander des compléments</h2>
            <p className="text-sm font-semibold text-slate-700 line-clamp-2">{intitule(dossier)}</p>
            <p className="text-sm text-slate-600">{[references(dossier), dossier.requester_name && `pour ${dossier.requester_name}`].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-500 hover:bg-amber-100" aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div>
            <div className="text-sm font-bold text-slate-800 mb-2">Ce qui manque</div>
            <div className="flex flex-wrap gap-2">
              {CHAMPS.map((c) => (
                <button key={c.cle} type="button" onClick={() => basculer(c.cle)} aria-pressed={champs.has(c.cle)}
                  className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-colors ${champs.has(c.cle) ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-amber-400'}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold text-slate-800 mb-2">Un mot au demandeur</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {MOTS.map((m) => (
                <button key={m} type="button" onClick={() => setMessage(m)} className="px-2.5 py-1 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 hover:bg-amber-100">{m}</button>
              ))}
            </div>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000}
              placeholder="ex. Trois cautions portent ce nom : indiquez le n° d'acte."
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 focus:outline-none focus:border-amber-500" />
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="button" onClick={envoyer} disabled={envoi}
            className="px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60 hover:bg-amber-600">
            {envoi ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />} Renvoyer au demandeur
          </button>
        </div>
      </div>
    </Modal>
  );
};

/** Ce que l'archive a demandé (et, une fois complétée, la réponse) : pour la file de l'archive. */
export const EchangeComplement = ({ d }) => {
  if (d.statut === 'a completer' || d.etat === 'a_completer') {
    const champs = (d.complement_champs || []).map(libelle);
    return (
      <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <strong className="font-black">Renvoyée le {dateCourte(d.complement_demande_at)}</strong>
        {champs.length > 0 && <> · manque : <strong>{champs.join(', ')}</strong></>}
        {d.complement_message && <div className="italic">« {d.complement_message} »</div>}
      </div>
    );
  }
  if (d.complement_fourni_at) {
    return (
      <div className="mt-2 rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 flex items-start gap-1.5">
        <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" />
        <span><strong className="font-black">Complétée le {dateCourte(d.complement_fourni_at)}</strong>{d.complement_reponse && <> : « {d.complement_reponse} »</>}</span>
      </div>
    );
  }
  return null;
};

/**
 * Pour le demandeur : la demande renvoyée par l'archive, son mot, les champs
 * à remplir ; « Renvoyer à l'archive » la remet dans la file.
 */
export const CarteACompleter = ({ d, types = [], onFait, onAnnuler, annulation, delai = 0 }) => {
  const demandes = d.complement_champs?.length ? d.complement_champs : [];
  // Les champs demandés d'abord ; les autres références restent modifiables.
  const affiches = [...demandes.filter((c) => c !== 'description'), ...['nom_entreprise', 'num_acte', 'annee'].filter((c) => !demandes.includes(c))];
  const [valeurs, setValeurs] = useState(() => Object.fromEntries(CHAMPS.map((c) => [c.cle, d[c.cle] === null || d[c.cle] === undefined ? '' : String(d[c.cle])])));
  const [reponse, setReponse] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const renvoyer = async () => {
    setEnvoi(true);
    try {
      await requestService.completer(d.id, { ...valeurs, reponse });
      toast.success(`Demande complétée et renvoyée à l'archive : ${intitule({ ...d, ...valeurs })}.`);
      onFait?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'La demande n\'a pas pu être renvoyée.');
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <li className="resultat-lumiere ambre rounded-2xl border-2 border-amber-300 bg-white p-4 md:p-5" style={{ '--delai': `${delai}s` }}>
      <div className="flex items-start gap-3">
        <span className="lumiere-pastille w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0"><MessageSquareWarning size={20} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black uppercase tracking-wide text-amber-700">L'archive a besoin de précisions</div>
          <div className="text-lg font-black text-slate-900 leading-tight">{intitule(d)}</div>
          <div className="text-sm text-slate-600">{[references(d), d.motif].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-950">
        {demandes.length > 0 && <div><strong className="font-black">Il manque :</strong> {demandes.map(libelle).join(', ')}</div>}
        {d.complement_message && <div className="mt-0.5 text-base font-semibold italic">« {d.complement_message} »</div>}
        <div className="mt-1 text-xs font-semibold text-amber-800">{d.complement_demande_par ? `${d.complement_demande_par}, ` : ''}le {dateCourte(d.complement_demande_at)}</div>
      </div>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {affiches.map((cle) => {
          const c = CHAMPS.find((x) => x.cle === cle);
          const requis = demandes.includes(cle);
          const manque = requis && vide(valeurs[cle]);
          return (
            <label key={cle} className={`text-sm font-bold ${manque ? 'text-red-700' : 'text-slate-700'}`}>
              {c.label}{requis ? ' *' : ''}
              {cle === 'type_document' && types.length ? (
                <select value={valeurs[cle]} onChange={(e) => setValeurs((v) => ({ ...v, [cle]: e.target.value }))}
                  className={`mt-1 w-full px-3 py-2.5 rounded-xl border-2 bg-white text-sm text-slate-800 ${manque ? 'border-red-300' : 'border-slate-200'}`}>
                  <option value="">—</option>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              ) : (
                <input value={valeurs[cle]} onChange={(e) => setValeurs((v) => ({ ...v, [cle]: e.target.value }))} placeholder={c.exemple}
                  inputMode={cle === 'annee' || cle === 'montant' ? 'numeric' : undefined} maxLength={cle === 'annee' ? 4 : 255}
                  className={`mt-1 w-full px-3 py-2.5 rounded-xl border-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 ${manque ? 'border-red-300 bg-red-50/40' : 'border-slate-200'}`} />
              )}
            </label>
          );
        })}
      </div>
      <label className={`block mt-3 text-sm font-bold ${demandes.includes('description') && !reponse.trim() ? 'text-red-700' : 'text-slate-700'}`}>
        Un mot pour l'archive{demandes.includes('description') ? ' *' : ' (facultatif)'}
        <textarea value={reponse} onChange={(e) => setReponse(e.target.value)} rows={2} maxLength={1000} placeholder="ex. C'est la caution de bonne exécution de mars."
          className="mt-1 w-full px-3 py-2.5 rounded-xl border-2 border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-amber-500" />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={renvoyer} disabled={envoi}
          className="px-5 py-3 rounded-xl bg-docuflow-secondary text-white font-bold inline-flex items-center gap-2 disabled:opacity-60 shadow-md shadow-green-200">
          {envoi ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} Renvoyer à l'archive
        </button>
        {onAnnuler && (
          <button type="button" onClick={() => onAnnuler(d)} disabled={annulation === d.id}
            className="px-4 py-3 rounded-xl text-sm font-bold text-slate-600 hover:bg-red-50 hover:text-red-600 inline-flex items-center gap-1.5">
            {annulation === d.id ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />} Annuler la demande
          </button>
        )}
      </div>
    </li>
  );
};

/** Bouton de l'archive : ouvre la modale. */
export const BoutonComplement = ({ onClick, desactive }) => (
  <button type="button" onClick={onClick} disabled={desactive} title="Renvoyer au demandeur : il manque des informations"
    className="px-3 py-2 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-800 text-sm font-bold inline-flex items-center gap-1.5 hover:bg-amber-100 disabled:opacity-60">
    <Reply size={14} /> Compléments
  </button>
);

/** Bandeau d'alerte (accueil, page de demande) : des demandes attendent les compléments du demandeur. */
export const AlerteACompleter = ({ nombre, className = '' }) => (nombre > 0 ? (
  <Link to="/demandes/mes-demandes"
    className={`resultat-lumiere ambre flex flex-wrap items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-4 hover:bg-amber-100 transition-colors ${className}`}>
    <span className="lumiere-pastille w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0"><MessageSquareWarning size={20} /></span>
    <span className="min-w-0 flex-1">
      <span className="block text-base font-black text-amber-950">
        {nombre} demande{nombre > 1 ? 's' : ''} à compléter
      </span>
      <span className="block text-sm font-semibold text-amber-900/80">L'archive a besoin de précisions pour retrouver {nombre > 1 ? 'ces dossiers' : 'ce dossier'}.</span>
    </span>
    <span className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold">Compléter</span>
  </Link>
) : null);
