import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Send, Loader2, ChevronDown, Check, Undo2, ClipboardPaste, X, Plus } from 'lucide-react';
import { requestService } from '../../../services/requestService';
import { listeService } from '../../../services/listeService';
import { authService } from '../../../services/authService';
import { toast } from '../../../components/Toast';
import { Pastille } from './elements';
import { intitule, references, dateCourte, ressembleAReference, analyserCollage, detecterType } from './vocabulaire';
import { lireCadre, ecrireCadre, cadreActif } from './cadreRetenu';
import { departementDe, motifsHabituels } from './departements';

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
// - Le motif (consultation, solde créditeur…) est retenu d'une fois sur
//   l'autre, sur ce poste : on ne le change que quand il change. La première
//   fois, c'est le motif habituel du département de l'agent (DC : consultation ;
//   DE : restitution de provision), et ses motifs habituels viennent en tête.
// - Juste après l'envoi, « Annuler » rattrape une erreur, sans confirmation
//   préalable qui ralentirait toutes les demandes justes.
//
// Utilisée à l'accueil, sur la page « Demander un dossier », derrière Ctrl+K,
// et par l'archive pour une demande reçue par téléphone ou par courrier
// (`envoyerUn`, `envoyerListe`, `departement` de l'agent). Avec `cumuler`,
// Entrée AJOUTE le dossier à la liste en préparation — les dossiers d'un
// courrier — qui part d'un seul envoi.
// ============================================================================

const ligneDe = (d, type) => ({
  nom_entreprise: d.nom_entreprise || '',
  num_dossier: d.num_dossier || '',
  num_acte: d.num_acte || '',
  annee: d.annee ? String(d.annee) : '',
  // Un dossier connu garde sa typologie ; sinon, celle choisie ou devinée.
  type_document: d.type_document || type || '',
});

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
  // Section de l'agent pour qui l'on demande ; par défaut, l'utilisateur connecté.
  departement,
  // Retenir le motif choisi sur ce poste (faux pour l'archive, qui saisit
  // pour des agents de services différents).
  retenir = true,
  envoyerListe,
  cumuler = false,
}) => {
  const section = departement !== undefined ? departement : authService.getCurrentUser()?.section;
  const [cadres, setCadres] = useState([]);
  const [cadre, setCadre] = useState(() => (retenir ? lireCadre() : ''));
  // Types de dossier (attestation, bonne exécution (CBE)…) ; le type est deviné
  // dans la saisie tant que l'agent ne l'a pas choisi lui-même.
  const [types, setTypes] = useState([]);
  const [typeManuel, setTypeManuel] = useState(undefined);
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
    requestService.getOptions().then((o) => {
      setCadres(o?.motifs || []);
      setTypes(o?.documentTypes || []);
    }).catch(() => { setCadres([]); setTypes([]); });
    return () => clearTimeout(minuteurAnnuler.current);
  }, []);

  const habituels = useMemo(() => motifsHabituels(section, cadres), [section, cadres]);
  const sigle = departementDe(section)?.sigle;

  // Le motif proposé : celui retenu sur ce poste s'il est encore proposé,
  // sinon le premier motif habituel du département, sinon le premier motif.
  // Pour l'archive, il suit le département de l'agent choisi.
  useEffect(() => {
    if (!cadres.length) return;
    setCadre((actuel) => {
      const propose = (v) => cadres.some((c) => c.value === v);
      if (retenir) return cadreActif(cadres, habituels);
      if (habituels.length && !habituels.some((h) => h.value === actuel)) return habituels[0].value;
      return propose(actuel) ? actuel : cadres[0].value;
    });
  }, [cadres, habituels, retenir]);

  // « CBE Agro Fictive du Zou » : le type est reconnu, la recherche porte sur le reste.
  const detection = useMemo(() => detecterType(saisie, types), [saisie, types]);
  const qNet = detection.reste.trim();
  const typeEffectif = typeManuel !== undefined ? typeManuel : detection.type;

  useEffect(() => {
    if (qNet.length < 2) { setSuggestions([]); setRecherche(false); return undefined; }
    setRecherche(true);
    const minuteur = setTimeout(() => {
      listeService.dossiersConnus(qNet).then(setSuggestions).catch(() => setSuggestions([])).finally(() => setRecherche(false));
    }, 250);
    return () => clearTimeout(minuteur);
  }, [qNet]);

  useEffect(() => {
    const vide = { nom_entreprise: '', num_dossier: '', num_acte: '', annee: '' };
    if (detection.acte) setDetail({ ...vide, num_acte: qNet });
    else if (ressembleAReference(qNet)) setDetail({ ...vide, num_dossier: qNet });
    else setDetail({ ...vide, nom_entreprise: qNet });
  }, [qNet, detection.acte]);

  const choisirCadre = (v) => { setCadre(v); if (retenir) ecrireCadre(v); };

  const montrerEnvoyee = useCallback((e) => {
    clearTimeout(minuteurAnnuler.current);
    setEnvoyee(e);
    minuteurAnnuler.current = setTimeout(() => setEnvoyee(null), 12000);
  }, []);

  const reinitialiser = () => {
    setSaisie(''); setSuggestions([]); setPrecisions(false); setColles(null); setTypeManuel(undefined);
    setTimeout(() => champ.current?.focus(), 0);
  };

  // Mode `cumuler` : le dossier rejoint la liste en préparation.
  const ajouter = (d) => {
    setColles((c) => [...(c || []), ligneDe(d, typeEffectif)]);
    setSaisie(''); setSuggestions([]); setPrecisions(false); setTypeManuel(undefined);
    setTimeout(() => champ.current?.focus(), 0);
  };
  const retirer = (i) => setColles((c) => {
    const reste = (c || []).filter((_, k) => k !== i);
    return reste.length ? reste : null;
  });

  const demander = async (d, cle) => {
    if (!cadre) { toast.error('Choisissez le motif de la demande.'); return; }
    setEnvoi(cle);
    try {
      const corps = {
        mode: 'rapide',
        motif: cadre,
        nom_entreprise: d.nom_entreprise || '',
        num_dossier: d.num_dossier || '',
        num_acte: d.num_acte || '',
        annee: d.annee ? String(d.annee) : '',
        type_document: d.type_document || typeEffectif || '',
        ...(d.source_request_id ? { source_request_id: d.source_request_id } : {}),
      };
      const res = envoyerUn ? await envoyerUn(corps) : await requestService.createRequest(corps);
      const id = res?.request?.id;
      const titre = intitule({ ...d, type_document: corps.type_document });
      montrerEnvoyee({ id, texte: titre, message: messageEnvoye(titre), annulable: annulable && Boolean(id) });
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
    if (!cadre) { toast.error('Choisissez le motif de la demande.'); return; }
    if (colles.length === 1 && !cumuler) { await demander(colles[0], 'colle'); return; }
    setEnvoi('colles');
    try {
      const corps = { libelle: `Demande du ${maintenant()}`, cadre, lignes: colles };
      const liste = envoyerListe ? await envoyerListe(corps) : await listeService.creer(corps);
      const n = liste.dossiers.length;
      const texte = `${n} dossier${n > 1 ? 's' : ''} (${liste.libelle})`;
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

  const q = qNet;
  // Entrée reprend le dossier connu qui correspond exactement à la saisie :
  // un numéro, ou un nom d'entreprise s'il ne désigne qu'un seul dossier.
  const egal = (x) => x && x.toLowerCase() === q.toLowerCase();
  // Avec une typologie choisie ou devinée, seul le dossier de cette typologie correspond.
  const memeType = (s) => !typeEffectif || !s.type_document || s.type_document === typeEffectif;
  const memeNom = suggestions.filter((s) => egal(s.nom_entreprise) && memeType(s));
  const exacte = suggestions.find((s) => egal(s.num_dossier) || egal(s.num_acte)) || (memeNom.length === 1 ? memeNom[0] : null);
  const valider = (e) => {
    e.preventDefault();
    if (desactive || envoi) return;
    if (cumuler && q.length >= 2) { ajouter(exacte || detail); return; }
    if (colles) { demanderColles(); return; }
    if (q.length < 2) { champ.current?.focus(); return; }
    if (exacte) demander(exacte, cleDossier(exacte));
    else demander(detail, 'libre');
  };
  // Un dossier proposé : demandé tout de suite, ou ajouté à la liste en préparation.
  const prendre = (d, cle) => (cumuler ? ajouter(d) : demander(d, cle));

  const coller = (e) => {
    if (!plusieurs) return;
    const texte = e.clipboardData?.getData('text') || '';
    if (!/\r?\n/.test(texte.trim())) return;
    e.preventDefault();
    const lignes = analyserCollage(texte, types);
    if (cumuler && lignes.length) setColles((c) => [...(c || []), ...lignes]);
    else if (lignes.length > 1) setColles(lignes);
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
            value={colles && !cumuler ? '' : saisie}
            onChange={(e) => { if (!cumuler) setColles(null); setSaisie(e.target.value); }}
            onPaste={coller}
            disabled={desactive}
            placeholder={colles && !cumuler ? `${colles.length} dossiers collés — prêts à partir`
              : cumuler && colles ? 'Dossier suivant… (Entrée pour l\'ajouter)' : 'Entreprise, n° de dossier ou n° d\'acte'}
            className={`w-full rounded-2xl border border-slate-200 bg-white font-semibold text-slate-800 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:border-docuflow-secondary focus:ring-4 focus:ring-green-100 disabled:bg-slate-50 ${
              grande ? 'pl-14 pr-12 py-5 text-lg md:text-xl' : 'pl-11 pr-11 py-3.5 text-base'}`}
            aria-label="Dossier à demander"
          />
          {recherche && <Loader2 size={18} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
        </div>
        {cumuler ? (
          <button type="submit" disabled={desactive || Boolean(envoi) || q.length < 2}
            className="rounded-2xl border border-slate-200 bg-white text-slate-700 font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 px-5 py-3 hover:border-docuflow-secondary hover:text-docuflow-secondary">
            <Plus size={18} /> Ajouter
          </button>
        ) : (
          <button type="submit" disabled={desactive || Boolean(envoi) || (!colles && q.length < 2)}
            className={`rounded-2xl bg-docuflow-secondary text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity ${grande ? 'px-7 py-4 text-lg' : 'px-5 py-3'}`}>
            {envoi === 'libre' || envoi === 'colles' || envoi === 'exacte' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            {colles ? `${libelleBouton} les ${colles.length}` : libelleBouton}
          </button>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 text-xs text-slate-500">
        <label className="inline-flex items-center gap-1.5">
          Motif :
          <select value={cadre} onChange={(e) => choisirCadre(e.target.value)}
            className="bg-transparent font-bold text-slate-700 border-b border-dashed border-slate-300 focus:outline-none focus:border-docuflow-secondary py-0.5 cursor-pointer max-w-[230px]">
            {habituels.length ? (
              <>
                <optgroup label={`Habituels${sigle ? ` — ${sigle}` : ''}`}>
                  {habituels.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </optgroup>
                <optgroup label="Autres motifs">
                  {cadres.filter((c) => !habituels.includes(c)).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </optgroup>
              </>
            ) : cadres.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        {types.length > 0 && (
          <label className="inline-flex items-center gap-1.5">
            Typologie :
            {/* Elle fait partie de l'intitulé du dossier : à préciser si elle n'est pas devinée. */}
            <select value={typeEffectif || ''} onChange={(e) => setTypeManuel(e.target.value)}
              className={`bg-transparent font-bold border-b border-dashed focus:outline-none focus:border-docuflow-secondary py-0.5 cursor-pointer max-w-[220px] ${
                !typeEffectif && (q.length >= 2 || colles) && !cumuler ? 'text-amber-700 border-amber-400' : 'text-slate-700 border-slate-300'}`}>
              <option value="">{q.length >= 2 ? 'à préciser' : '—'}</option>
              {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {typeManuel === undefined && detection.type && <span className="text-green-700 font-semibold">devinée</span>}
          </label>
        )}
        {plusieurs && !cumuler && <span className="inline-flex items-center gap-1 text-slate-400"><ClipboardPaste size={12} /> plusieurs dossiers ? collez-les, un par ligne</span>}
        {cumuler && <span className="inline-flex items-center gap-1 text-slate-400"><Plus size={12} /> un dossier, Entrée, le suivant… ou collez-les d'un coup</span>}
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
            <span className="font-bold text-slate-800 flex-1">
              {colles.length} dossier{colles.length > 1 ? 's' : ''} {cumuler ? 'à enregistrer' : 'collés'}
            </span>
            <button type="button" onClick={() => setColles(null)} className="text-xs font-bold text-slate-400 hover:text-slate-600">Tout effacer</button>
          </div>
          <ul className="text-sm divide-y divide-slate-50 max-h-56 overflow-y-auto">
            {colles.map((d, i) => (
              <li key={`${i}-${cleDossier(d)}`} className="py-1.5 flex items-center gap-3">
                <span className="text-slate-300 w-6 text-right flex-shrink-0">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-700 line-clamp-2">{intitule(d)}</span>
                  {references(d) && <span className="block text-xs text-slate-400 truncate">{references(d)}</span>}
                </span>
                <button type="button" onClick={() => retirer(i)} className="p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50" aria-label={`Retirer ${intitule(d)}`}>
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          {cumuler && (
            <button type="button" onClick={demanderColles} disabled={desactive || Boolean(envoi)}
              className="mt-3 w-full sm:w-auto px-5 py-3 rounded-2xl bg-docuflow-secondary text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50">
              {envoi === 'colles' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              {libelleBouton} {colles.length > 1 ? `les ${colles.length} dossiers` : 'le dossier'}
            </button>
          )}
        </div>
      )}

      {(!colles || cumuler) && q.length >= 2 && (
        <ul className="mt-2 divide-y divide-slate-100">
          {suggestions.map((s) => {
            const k = cleDossier(s);
            return (
              <li key={k} className="py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="font-semibold text-slate-800 line-clamp-2">{intitule({ ...s, type_document: s.type_document || typeEffectif })}</div>
                  <div className="text-xs text-slate-400 truncate">{references(s) || 'Sans référence'}</div>
                </div>
                {s.sorti_jusqu_au && <Pastille ton="ambre">Sorti · retour prévu le {dateCourte(s.sorti_jusqu_au)}</Pastille>}
                <button type="button" onClick={() => prendre(s, k)} disabled={Boolean(envoi) || desactive}
                  className="px-4 py-2 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60">
                  {envoi === k ? <Loader2 size={15} className="animate-spin" /> : cumuler ? <Plus size={15} /> : <Send size={15} />} {cumuler ? 'Ajouter' : libelleBouton}
                </button>
              </li>
            );
          })}
          {!exacte && (
            <li className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="font-semibold text-slate-800 truncate">« {q} »{typeEffectif ? ` — ${typeEffectif}` : ''}</div>
                  <div className="text-xs text-slate-400">
                    {suggestions.length ? 'Un autre dossier : ' : cumuler ? 'Entrée pour l\'ajouter : ' : 'Entrée pour l\'envoyer : '}
                    {detail.num_acte ? 'n° d\'acte' : detail.num_dossier && !detail.nom_entreprise ? 'n° de dossier' : 'nom de l\'entreprise'}
                    {typeEffectif ? '' : ' · typologie à préciser'}
                  </div>
                </div>
                <button type="button" onClick={() => setPrecisions((v) => !v)}
                  className="px-3 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 inline-flex items-center gap-1">
                  Préciser <ChevronDown size={14} className={`transition-transform ${precisions ? 'rotate-180' : ''}`} />
                </button>
                <button type="button" onClick={() => prendre(detail, 'libre')} disabled={Boolean(envoi) || desactive}
                  className="px-4 py-2 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60">
                  {envoi === 'libre' ? <Loader2 size={15} className="animate-spin" /> : cumuler ? <Plus size={15} /> : <Send size={15} />} {cumuler ? 'Ajouter' : libelleBouton}
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
