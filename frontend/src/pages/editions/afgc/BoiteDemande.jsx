import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Send, Loader2, ChevronDown, Check, Undo2, ClipboardPaste, X } from 'lucide-react';
import { requestService } from '../../../services/requestService';
import { listeService } from '../../../services/listeService';
import { toast } from '../../../components/Toast';
import { Pastille } from './elements';
import { intitule, references, dateCourte, ressembleAReference, analyserCollage } from './vocabulaire';
import { lireCadre, ecrireCadre, cadreActif } from './cadreRetenu';

// ============================================================================
// La boîte de demande : on tape le nom de l'entreprise ou un numéro, on
// appuie sur Entrée. C'est tout.
//
// - Les dossiers déjà demandés s'affichent pendant la frappe, avec leur
//   disponibilité ; Entrée choisit celui dont le numéro correspond exactement,
//   sinon envoie la saisie telle quelle (un nom → entreprise, un numéro → n°
//   de dossier).
// - Plusieurs lignes collées (une colonne copiée dans Excel ou un e-mail)
//   partent ensemble, en une liste.
// - Le cadre (consultation, soldes créditeurs…) est retenu d'une fois sur
//   l'autre, sur ce poste : on ne le change que quand il change.
// - Juste après l'envoi, « Annuler » rattrape une erreur, sans confirmation
//   préalable qui ralentirait toutes les demandes justes.
//
// Utilisée à l'accueil, sur la page « Demander un dossier », derrière Ctrl+K,
// et par l'archive pour une demande reçue par téléphone (`envoyerUn`).
// ============================================================================

const cleDossier = (d) => [d.nom_entreprise, d.num_dossier, d.num_acte, d.annee].map((x) => String(x ?? '').toLowerCase()).join('|');
const maintenant = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}h${p(d.getMinutes())}`;
};

const BoiteDemande = ({
  grande = false,
  autoFocus = false,
  onEnvoye,
  envoyerUn,
  plusieurs = true,
  annulable = true,
  libelleBouton = 'Demander',
  pied = null,
  desactive = false,
  messageEnvoye = (texte) => `Demandé : ${texte}. L'archive est prévenue.`,
}) => {
  const [cadres, setCadres] = useState([]);
  const [cadre, setCadre] = useState(lireCadre);
  const [saisie, setSaisie] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [recherche, setRecherche] = useState(false);
  const [envoi, setEnvoi] = useState(null);
  const [precisions, setPrecisions] = useState(false);
  const [detail, setDetail] = useState({ nom_entreprise: '', num_dossier: '', num_acte: '', annee: '' });
  const [colles, setColles] = useState(null);
  const [envoyee, setEnvoyee] = useState(null);
  const champ = useRef(null);
  const minuteurAnnuler = useRef(null);

  useEffect(() => {
    listeService.cadres().then((c) => {
      setCadres(c);
      setCadre(cadreActif(c));
    }).catch(() => setCadres([]));
    return () => clearTimeout(minuteurAnnuler.current);
  }, []);

  useEffect(() => {
    const q = saisie.trim();
    if (q.length < 2) { setSuggestions([]); setRecherche(false); return undefined; }
    setRecherche(true);
    const minuteur = setTimeout(() => {
      listeService.dossiersConnus(q).then(setSuggestions).catch(() => setSuggestions([])).finally(() => setRecherche(false));
    }, 250);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  useEffect(() => {
    const q = saisie.trim();
    setDetail(ressembleAReference(q)
      ? { nom_entreprise: '', num_dossier: q, num_acte: '', annee: '' }
      : { nom_entreprise: q, num_dossier: '', num_acte: '', annee: '' });
  }, [saisie]);

  const choisirCadre = (v) => { setCadre(v); ecrireCadre(v); };

  const montrerEnvoyee = useCallback((e) => {
    clearTimeout(minuteurAnnuler.current);
    setEnvoyee(e);
    minuteurAnnuler.current = setTimeout(() => setEnvoyee(null), 12000);
  }, []);

  const reinitialiser = () => {
    setSaisie(''); setSuggestions([]); setPrecisions(false); setColles(null);
    setTimeout(() => champ.current?.focus(), 0);
  };

  const demander = async (d, cle) => {
    if (!cadre) { toast.error('Choisissez le cadre de la demande.'); return; }
    setEnvoi(cle);
    try {
      const corps = {
        mode: 'rapide',
        motif: cadre,
        nom_entreprise: d.nom_entreprise || '',
        num_dossier: d.num_dossier || '',
        num_acte: d.num_acte || '',
        annee: d.annee ? String(d.annee) : '',
        ...(d.source_request_id ? { source_request_id: d.source_request_id } : {}),
      };
      const res = envoyerUn ? await envoyerUn(corps) : await requestService.createRequest(corps);
      const id = res?.request?.id;
      montrerEnvoyee({ id, texte: intitule(d), message: messageEnvoye(intitule(d)), annulable: annulable && Boolean(id) });
      reinitialiser();
      onEnvoye?.(res);
    } catch (e) {
      toast.error(e.response?.data?.message || 'La demande n\'a pas pu être envoyée.');
    } finally {
      setEnvoi(null);
    }
  };

  const demanderColles = async () => {
    if (!colles?.length) return;
    if (colles.length === 1) { await demander(colles[0], 'colle'); return; }
    setEnvoi('colles');
    try {
      const liste = await listeService.creer({ libelle: `Demande du ${maintenant()}`, cadre, lignes: colles });
      const texte = `${liste.dossiers.length} dossiers (${liste.libelle})`;
      montrerEnvoyee({ texte, message: messageEnvoye(texte), annulable: false });
      reinitialiser();
      onEnvoye?.(liste);
    } catch (e) {
      const details = e.response?.data?.details;
      toast.error(details?.length ? `Ligne ${details[0].ligne} : ${details[0].message}` : (e.response?.data?.message || 'Les dossiers n\'ont pas pu être demandés.'));
    } finally {
      setEnvoi(null);
    }
  };

  const annuler = async () => {
    if (!envoyee?.id) return;
    try {
      await requestService.updateStatus(envoyee.id, { status: 'annulé' });
      clearTimeout(minuteurAnnuler.current);
      setEnvoyee(null);
      toast.info(`Demande annulée : ${envoyee.texte}.`);
      onEnvoye?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'L\'annulation n\'est plus possible : l\'archive a peut-être déjà transmis le dossier.');
    }
  };

  const q = saisie.trim();
  // Entrée reprend le dossier connu qui correspond exactement à la saisie :
  // un numéro, ou un nom d'entreprise s'il ne désigne qu'un seul dossier.
  const egal = (x) => x && x.toLowerCase() === q.toLowerCase();
  const memeNom = suggestions.filter((s) => egal(s.nom_entreprise));
  const exacte = suggestions.find((s) => egal(s.num_dossier) || egal(s.num_acte)) || (memeNom.length === 1 ? memeNom[0] : null);
  const valider = (e) => {
    e.preventDefault();
    if (desactive || envoi) return;
    if (colles) { demanderColles(); return; }
    if (q.length < 2) { champ.current?.focus(); return; }
    if (exacte) demander(exacte, cleDossier(exacte));
    else demander(detail, 'libre');
  };

  const coller = (e) => {
    if (!plusieurs) return;
    const texte = e.clipboardData?.getData('text') || '';
    if (!/\r?\n/.test(texte.trim())) return;
    e.preventDefault();
    const lignes = analyserCollage(texte);
    if (lignes.length > 1) setColles(lignes);
    else if (lignes.length === 1) setSaisie(lignes[0].nom_entreprise || lignes[0].num_dossier || lignes[0].num_acte);
  };

  return (
    <div>
      <form onSubmit={valider} className={`flex gap-2 ${grande ? 'flex-col sm:flex-row' : ''}`}>
        <div className="relative flex-1">
          <Search size={grande ? 22 : 18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${grande ? 'left-5' : 'left-4'}`} />
          <input
            ref={champ}
            autoFocus={autoFocus}
            value={colles ? '' : saisie}
            onChange={(e) => { setColles(null); setSaisie(e.target.value); }}
            onPaste={coller}
            disabled={desactive}
            placeholder={colles ? `${colles.length} dossiers collés — prêts à partir` : 'Entreprise, n° de dossier ou n° d\'acte'}
            className={`w-full rounded-2xl border border-slate-200 bg-white font-semibold text-slate-800 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:border-docuflow-secondary focus:ring-4 focus:ring-green-100 disabled:bg-slate-50 ${
              grande ? 'pl-14 pr-12 py-5 text-lg md:text-xl' : 'pl-11 pr-11 py-3.5 text-base'}`}
            aria-label="Dossier à demander"
          />
          {recherche && <Loader2 size={18} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
        </div>
        <button type="submit" disabled={desactive || Boolean(envoi) || (!colles && q.length < 2)}
          className={`rounded-2xl bg-docuflow-secondary text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity ${grande ? 'px-7 py-4 text-lg' : 'px-5 py-3'}`}>
          {envoi === 'libre' || envoi === 'colles' || envoi === 'exacte' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          {colles ? `${libelleBouton} les ${colles.length}` : libelleBouton}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 text-xs text-slate-500">
        <label className="inline-flex items-center gap-1.5">
          Cadre :
          <select value={cadre} onChange={(e) => choisirCadre(e.target.value)}
            className="bg-transparent font-bold text-slate-700 border-b border-dashed border-slate-300 focus:outline-none focus:border-docuflow-secondary py-0.5 cursor-pointer">
            {cadres.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        {plusieurs && <span className="inline-flex items-center gap-1 text-slate-400"><ClipboardPaste size={12} /> plusieurs dossiers ? collez-les, un par ligne</span>}
        {pied}
      </div>

      {envoyee && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-green-50 text-green-800 px-4 py-3 text-sm font-semibold animate-fade-in-up" role="status">
          <Check size={18} className="flex-shrink-0" />
          <span className="flex-1 min-w-0">{envoyee.message}</span>
          {envoyee.annulable && (
            <button type="button" onClick={annuler} className="px-3 py-1.5 rounded-xl bg-white text-green-800 font-bold inline-flex items-center gap-1.5 hover:bg-green-100">
              <Undo2 size={14} /> Annuler
            </button>
          )}
          <button type="button" onClick={() => setEnvoyee(null)} className="p-1 rounded-lg text-green-700 hover:bg-green-100" aria-label="Fermer"><X size={14} /></button>
        </div>
      )}

      {colles && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-bold text-slate-800 flex-1">{colles.length} dossiers collés</span>
            <button type="button" onClick={() => setColles(null)} className="text-xs font-bold text-slate-400 hover:text-slate-600">Effacer</button>
          </div>
          <ul className="text-sm divide-y divide-slate-50 max-h-56 overflow-y-auto">
            {colles.map((d, i) => (
              <li key={`${i}-${cleDossier(d)}`} className="py-1.5 flex gap-3">
                <span className="text-slate-300 w-6 text-right flex-shrink-0">{i + 1}</span>
                <span className="font-semibold text-slate-700 truncate">{intitule(d)}</span>
                <span className="text-xs text-slate-400 truncate">{references(d)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!colles && q.length >= 2 && (
        <ul className="mt-2 divide-y divide-slate-100">
          {suggestions.map((s) => {
            const k = cleDossier(s);
            return (
              <li key={k} className="py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="font-semibold text-slate-800 truncate">{intitule(s)}</div>
                  <div className="text-xs text-slate-400 truncate">{references(s) || 'Sans référence'}</div>
                </div>
                {s.sorti_jusqu_au && <Pastille ton="ambre">Sorti · retour prévu le {dateCourte(s.sorti_jusqu_au)}</Pastille>}
                <button type="button" onClick={() => demander(s, k)} disabled={Boolean(envoi) || desactive}
                  className="px-4 py-2 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60">
                  {envoi === k ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {libelleBouton}
                </button>
              </li>
            );
          })}
          {!exacte && (
            <li className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="font-semibold text-slate-800 truncate">« {q} »</div>
                  <div className="text-xs text-slate-400">
                    {suggestions.length ? 'Un autre dossier : ' : 'Entrée pour l\'envoyer : '}
                    {detail.num_dossier && !detail.nom_entreprise ? 'n° de dossier' : 'nom de l\'entreprise'}
                  </div>
                </div>
                <button type="button" onClick={() => setPrecisions((v) => !v)}
                  className="px-3 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 inline-flex items-center gap-1">
                  Préciser <ChevronDown size={14} className={`transition-transform ${precisions ? 'rotate-180' : ''}`} />
                </button>
                <button type="button" onClick={() => demander(detail, 'libre')} disabled={Boolean(envoi) || desactive}
                  className="px-4 py-2 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60">
                  {envoi === 'libre' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {libelleBouton}
                </button>
              </div>
              {precisions && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                  {[['nom_entreprise', 'Entreprise'], ['num_dossier', 'N° de dossier'], ['num_acte', 'N° d\'acte'], ['annee', 'Année']].map(([k, label]) => (
                    <label key={k} className="text-[11px] font-bold text-slate-400">
                      {label}
                      <input value={detail[k]} onChange={(e) => setDetail((d) => ({ ...d, [k]: e.target.value }))}
                        inputMode={k === 'annee' ? 'numeric' : undefined} maxLength={k === 'annee' ? 4 : 255}
                        className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-docuflow-secondary" />
                    </label>
                  ))}
                </div>
              )}
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default BoiteDemande;
