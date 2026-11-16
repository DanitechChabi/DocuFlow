import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, Search, FileSpreadsheet, Send, Loader2, RotateCcw, ChevronDown } from 'lucide-react';
import { requestService } from '../../../services/requestService';
import { listeService } from '../../../services/listeService';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, ChoixCadre, Pastille } from './elements';
import { intitule, references, dateCourte, ressembleAReference, etatDemande } from './vocabulaire';
import ImportListeAfgc from './ImportListeAfgc';

// ============================================================================
// Demander un dossier, en un ou deux clics.
//
// Une seule barre : on tape le nom de l'entreprise ou un numéro. Les dossiers
// déjà demandés s'affichent (avec leur disponibilité) et « Demander » envoie
// la demande d'un clic. Un dossier jamais demandé part tel qu'il a été tapé :
// un nom va dans « Entreprise », un numéro dans « N° de dossier ».
// Les listes (soldes créditeurs…) se demandent d'un coup depuis Excel.
// ============================================================================

const cleDossier = (d) => [d.nom_entreprise, d.num_dossier, d.num_acte, d.annee].map((x) => String(x ?? '').toLowerCase()).join('|');

const DemanderAfgc = () => {
  useTitrePage('Demander un dossier');
  const [cadres, setCadres] = useState([]);
  const [cadre, setCadre] = useState('');
  const [saisie, setSaisie] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [recherche, setRecherche] = useState(false);
  const [envoi, setEnvoi] = useState(null);
  const [precisions, setPrecisions] = useState(false);
  const [detail, setDetail] = useState({ nom_entreprise: '', num_dossier: '', num_acte: '', annee: '' });
  const [recents, setRecents] = useState([]);
  const [importOuvert, setImportOuvert] = useState(false);
  const champ = useRef(null);

  const chargerRecents = useCallback(() => {
    requestService.getMyRequests().then((l) => {
      const vus = new Set();
      const rec = [];
      for (const d of Array.isArray(l) ? l : []) {
        if (d.lot_id || (!d.nom_entreprise && !d.num_dossier && !d.num_acte)) continue;
        const k = cleDossier(d);
        if (vus.has(k)) continue;
        vus.add(k);
        rec.push(d);
        if (rec.length >= 6) break;
      }
      setRecents(rec);
    }).catch(() => setRecents([]));
  }, []);

  useEffect(() => {
    listeService.cadres().then((c) => {
      setCadres(c);
      setCadre((v) => v || c[0]?.value || '');
    }).catch(() => setCadres([]));
    chargerRecents();
  }, [chargerRecents]);

  // Recherche des dossiers connus, 250 ms après la dernière frappe.
  useEffect(() => {
    const q = saisie.trim();
    if (q.length < 2) { setSuggestions([]); return undefined; }
    setRecherche(true);
    const minuteur = setTimeout(() => {
      listeService.dossiersConnus(q).then(setSuggestions).catch(() => setSuggestions([])).finally(() => setRecherche(false));
    }, 250);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  // La saisie libre préremplit les précisions.
  useEffect(() => {
    const q = saisie.trim();
    setDetail(ressembleAReference(q)
      ? { nom_entreprise: '', num_dossier: q, num_acte: '', annee: '' }
      : { nom_entreprise: q, num_dossier: '', num_acte: '', annee: '' });
  }, [saisie]);

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
      await requestService.createRequest(corps);
      toast.success(`Demande envoyée : ${intitule(d)}. L'archive est prévenue.`);
      setSaisie(''); setSuggestions([]); setPrecisions(false);
      chargerRecents();
      champ.current?.focus();
    } catch (e) {
      toast.error(e.response?.data?.message || 'La demande n\'a pas pu être envoyée.');
    } finally {
      setEnvoi(null);
    }
  };

  const q = saisie.trim();
  const exacte = suggestions.find((s) => [s.num_dossier, s.num_acte].some((x) => x && x.toLowerCase() === q.toLowerCase()));
  const valider = (e) => {
    e.preventDefault();
    if (q.length < 2) return;
    if (exacte) demander(exacte, 'exacte');
    else demander(detail, 'libre');
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <EnTete titre="Demander un dossier" icone={PlusCircle}
        aide="Tapez le nom de l'entreprise ou un numéro, puis « Demander » : l'archive est prévenue aussitôt.">
        <button type="button" onClick={() => setImportOuvert(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:border-docuflow-secondary hover:text-docuflow-secondary transition-colors">
          <FileSpreadsheet size={16} /> Demander une liste (Excel)
        </button>
      </EnTete>

      <div className="glass-card-premium rounded-3xl p-5 md:p-6 animate-fade-in-up">
        <div className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">Cadre</div>
        {cadres.length ? <ChoixCadre cadres={cadres} valeur={cadre} onChange={setCadre} /> : <div className="h-8" />}

        <form onSubmit={valider} className="mt-5">
          <div className="relative">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={champ}
              autoFocus
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              placeholder="Entreprise, n° de dossier ou n° d'acte"
              className="w-full pl-12 pr-12 py-4 rounded-2xl border border-slate-200 text-lg font-semibold text-slate-800 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:border-docuflow-secondary focus:ring-4 focus:ring-green-100"
              aria-label="Dossier à demander"
            />
            {recherche && <Loader2 size={18} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
          </div>
        </form>

        {q.length >= 2 && (
          <ul className="mt-3 divide-y divide-slate-100">
            {suggestions.map((s) => {
              const k = cleDossier(s);
              return (
                <li key={k} className="py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 truncate">{intitule(s)}</div>
                    <div className="text-xs text-slate-400 truncate">{references(s) || 'Sans référence'}</div>
                  </div>
                  {s.sorti_jusqu_au && <Pastille ton="ambre">Sorti · retour prévu le {dateCourte(s.sorti_jusqu_au)}</Pastille>}
                  <button type="button" onClick={() => demander(s, k)} disabled={Boolean(envoi)}
                    className="px-4 py-2 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60">
                    {envoi === k ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Demander
                  </button>
                </li>
              );
            })}
            {/* Le dossier tel qu'il a été tapé, s'il n'est pas déjà proposé. */}
            {!exacte && (
              <li className="py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 truncate">« {q} »</div>
                    <div className="text-xs text-slate-400">
                      {suggestions.length ? 'Un autre dossier : ' : 'Dossier jamais demandé : '}
                      {detail.num_dossier && !detail.nom_entreprise ? 'envoyé comme n° de dossier' : 'envoyé comme nom d\'entreprise'}
                    </div>
                  </div>
                  <button type="button" onClick={() => setPrecisions((v) => !v)}
                    className="px-3 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 inline-flex items-center gap-1">
                    Préciser <ChevronDown size={14} className={precisions ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </button>
                  <button type="button" onClick={() => demander(detail, 'libre')} disabled={Boolean(envoi)}
                    className="px-4 py-2 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60">
                    {envoi === 'libre' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Demander
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

      {recents.length > 0 && (
        <section className="glass-card-premium rounded-3xl p-5 md:p-6 mt-6 animate-fade-in-up">
          <h2 className="font-bold text-slate-900 flex items-center gap-2 mb-3"><RotateCcw size={16} className="text-docuflow-secondary" /> Vos derniers dossiers</h2>
          <ul className="divide-y divide-slate-100">
            {recents.map((d) => {
              const etat = etatDemande(d);
              const k = `re-${d.id}`;
              const enCours = etat.cle === 'demande' || etat.cle === 'transmis';
              return (
                <li key={d.id} className="py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 truncate">{intitule(d)}</div>
                    <div className="text-xs text-slate-400 truncate">{[references(d), d.motif].filter(Boolean).join(' · ')}</div>
                  </div>
                  <Pastille ton={etat.ton}>{etat.texte}</Pastille>
                  {!enCours && (
                    <button type="button" onClick={() => demander({ ...d, source_request_id: d.id }, k)} disabled={Boolean(envoi)}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:border-docuflow-secondary hover:text-docuflow-secondary inline-flex items-center gap-1.5 disabled:opacity-60">
                      {envoi === k ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Redemander
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <Link to="/demandes/mes-demandes" className="inline-block mt-3 text-sm font-bold text-docuflow-secondary hover:underline">Voir tous mes dossiers</Link>
        </section>
      )}

      <ImportListeAfgc
        open={importOuvert}
        onClose={() => setImportOuvert(false)}
        cadres={cadres}
        cadreParDefaut={cadres.find((c) => /solde/i.test(c.value))?.value || cadre}
        onEnvoye={chargerRecents}
      />
    </div>
  );
};

export default DemanderAfgc;
