import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PlusCircle, FileSpreadsheet, RotateCcw, Loader2 } from 'lucide-react';
import { requestService } from '../../../services/requestService';
import { listeService } from '../../../services/listeService';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, Pastille } from './elements';
import { intitule, references, etatDemande } from './vocabulaire';
import { cadreActif } from './cadreRetenu';
import { motifsHabituels } from './departements';
import { authService } from '../../../services/authService';
import BoiteDemande from './BoiteDemande';
import ImportListeAfgc from './ImportListeAfgc';
import { AlerteACompleter } from './complements';

// ============================================================================
// Demander un dossier : la boîte de demande (on tape, Entrée), les derniers
// dossiers à redemander d'un clic, et — pour les périodes de soldes
// créditeurs — l'envoi d'un classeur Excel de listes.
// ============================================================================

const cleDossier = (d) => [d.nom_entreprise, d.num_dossier, d.num_acte, d.annee].map((x) => String(x ?? '').toLowerCase()).join('|');

const DemanderAfgc = () => {
  useTitrePage('Demander un dossier');
  const [params, setParams] = useSearchParams();
  const [cadres, setCadres] = useState([]);
  const [recents, setRecents] = useState([]);
  const [importOuvert, setImportOuvert] = useState(params.get('liste') === '1');
  const [envoi, setEnvoi] = useState(null);
  const [aCompleter, setACompleter] = useState(0);

  const chargerRecents = useCallback(() => {
    requestService.getMyRequests().then((l) => {
      const vus = new Set();
      const rec = [];
      setACompleter((Array.isArray(l) ? l : []).filter((d) => d.statut === 'a completer').length);
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
    listeService.cadres().then(setCadres).catch(() => setCadres([]));
    chargerRecents();
    const recharger = () => chargerRecents();
    window.addEventListener('afgc:demande-envoyee', recharger);
    return () => window.removeEventListener('afgc:demande-envoyee', recharger);
  }, [chargerRecents]);

  const fermerImport = () => {
    setImportOuvert(false);
    if (params.get('liste')) { params.delete('liste'); setParams(params, { replace: true }); }
  };

  const redemander = async (d) => {
    setEnvoi(d.id);
    try {
      // Même dossier, même motif que la dernière fois (s'il est encore proposé).
      const motif = cadres.some((c) => c.value === d.motif)
        ? d.motif
        : cadreActif(cadres, motifsHabituels(authService.getCurrentUser()?.section, cadres));
      await requestService.createRequest({
        mode: 'rapide',
        motif,
        nom_entreprise: d.nom_entreprise || '',
        num_dossier: d.num_dossier || '',
        num_acte: d.num_acte || '',
        annee: d.annee ? String(d.annee) : '',
        type_document: d.type_document || '',
        source_request_id: d.id,
      });
      toast.success(`Redemandé : ${intitule(d)}. L'archive est prévenue.`);
      chargerRecents();
    } catch (e) {
      toast.error(e.response?.data?.message || 'La demande n\'a pas pu être envoyée.');
    } finally {
      setEnvoi(null);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <EnTete titre="Demander un dossier" icone={PlusCircle} aide="Tapez le nom de l'entreprise ou un numéro, puis Entrée : l'archive est prévenue aussitôt.">
        <button type="button" onClick={() => setImportOuvert(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:border-docuflow-secondary hover:text-docuflow-secondary transition-colors">
          <FileSpreadsheet size={16} /> Demander une liste (Excel)
        </button>
      </EnTete>

      <AlerteACompleter nombre={aCompleter} className="mb-5" />

      <div className="glass-card-premium rounded-3xl p-5 md:p-6 animate-fade-in-up">
        <BoiteDemande grande autoFocus onEnvoye={chargerRecents} />
      </div>

      {recents.length > 0 && (
        <section className="glass-card-premium rounded-3xl p-5 md:p-6 mt-6 animate-fade-in-up">
          <h2 className="font-bold text-slate-900 flex items-center gap-2 mb-3"><RotateCcw size={16} className="text-docuflow-secondary" /> Vos derniers dossiers</h2>
          <ul className="divide-y divide-slate-100">
            {recents.map((d) => {
              const etat = etatDemande(d);
              const enCours = etat.cle === 'demande' || etat.cle === 'transmis';
              return (
                <li key={d.id} className="py-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="font-semibold text-slate-800 line-clamp-2">{intitule(d)}</div>
                    <div className="text-xs text-slate-400 truncate">{[references(d), d.motif].filter(Boolean).join(' · ')}</div>
                  </div>
                  <Pastille ton={etat.ton}>{etat.texte}</Pastille>
                  {!enCours && (
                    <button type="button" onClick={() => redemander(d)} disabled={Boolean(envoi)}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:border-docuflow-secondary hover:text-docuflow-secondary inline-flex items-center gap-1.5 disabled:opacity-60">
                      {envoi === d.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Redemander
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
        onClose={fermerImport}
        cadres={cadres}
        cadreParDefaut={cadres.find((c) => /solde/i.test(c.value))?.value || cadreActif(cadres)}
        onEnvoye={chargerRecents}
      />
    </div>
  );
};

export default DemanderAfgc;
