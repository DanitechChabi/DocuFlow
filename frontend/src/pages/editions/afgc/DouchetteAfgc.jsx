import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ScanBarcode, Send, Undo2, Loader2, AlertTriangle, CheckCircle2, Archive, Tag } from 'lucide-react';
import { entreeService } from '../../../services/entreeService';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete } from './elements';
import { intitule, references, dateCourte } from './vocabulaire';
import { codeDe } from './etiquettes';
import { edition } from '../../../editions';
import { useMfiles, ServirMfiles } from './mfiles';

// Sans étiquettes (édition), la douchette travaille au n° d'acte.
const ETIQUETTES = edition?.etiquettes !== false;

// ============================================================================
// Douchette : sorties et retours en scannant l'étiquette du dossier (053).
// La douchette tape le code (« D0001234 ») puis Entrée, comme un clavier.
//   - Dossier sorti : « Retourné » (Entrée sur le champ vide confirme).
//   - Dossier attendu par une demande : « Transmettre à … » (idem).
// Le champ garde la main : on enchaîne les dossiers sans toucher la souris.
// Un petit son confirme chaque geste (aigu : fait ; grave : problème).
// ============================================================================

function bip(reussi) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = reussi ? 1046 : 220;
    g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (reussi ? 0.12 : 0.35));
    o.onended = () => ctx.close();
  } catch { /* sans son */ }
}

const jour = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const enRetard = (iso) => iso && iso < new Date().toISOString().slice(0, 10);

const DouchetteAfgc = () => {
  useTitrePage('Douchette');
  const [saisie, setSaisie] = useState('');
  const [lecture, setLecture] = useState(null); // { dossier, sorties, demandes } | { choix } | { erreur }
  const [cours, setCours] = useState(false);
  const [geste, setGeste] = useState(null);
  const [journal, setJournal] = useState([]);
  const champ = useRef(null);
  const mf = useMfiles();

  const focus = () => setTimeout(() => champ.current?.focus(), 0);
  useEffect(() => { focus(); }, []);

  const lire = useCallback(async (code) => {
    setCours(true);
    try {
      const r = await entreeService.douchette(code);
      setLecture(r);
      bip(true);
    } catch (e) {
      setLecture({ erreur: e.response?.data?.message || 'Lecture impossible.' });
      bip(false);
    } finally {
      setCours(false);
      setSaisie('');
      focus();
    }
  }, []);

  // Le geste proposé d'office : le retour s'il est sorti, sinon la plus sûre des demandes.
  const principal = lecture?.dossier
    ? (lecture.sorties?.[0] ? { type: 'retour', d: lecture.sorties[0] } : lecture.demandes?.[0] ? { type: 'sortie', d: lecture.demandes[0] } : null)
    : null;

  const agir = async (type, d) => {
    if (!lecture?.dossier || geste) return;
    setGeste(`${type}-${d.id}`);
    try {
      if (type === 'sortie') await entreeService.sortieDouchette({ dossier_entre_id: lecture.dossier.id, request_id: d.id });
      else await entreeService.retourDouchette({ request_id: d.id });
      bip(true);
      setJournal((j) => [{ cle: `${Date.now()}`, type, dossier: lecture.dossier, demande: d, heure: new Date() }, ...j].slice(0, 30));
      setLecture(null);
    } catch (e) {
      bip(false);
      setLecture((l) => ({ ...l, avertissement: e.response?.data?.message || 'Le geste n\'a pas pu être enregistré.' }));
    } finally {
      setGeste(null);
      focus();
    }
  };

  const valider = (e) => {
    e.preventDefault();
    const s = saisie.trim();
    if (s) lire(s);
    else if (principal) agir(principal.type, principal.d);
  };

  const dossier = lecture?.dossier;
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <EnTete titre="Douchette" icone={ScanBarcode}
        aide={ETIQUETTES
          ? 'Scannez l\'étiquette d\'un dossier : l\'application propose la sortie ou le retour. Entrée confirme ; le scan suivant enchaîne.'
          : 'Tapez le n° d\'acte d\'un dossier : l\'application propose la sortie ou le retour. Entrée confirme.'} />

      <form onSubmit={valider} className="glass-card-premium rounded-xl p-5 md:p-6">
        <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="scan">{ETIQUETTES ? 'Étiquette ou n° d\'acte' : 'N° d\'acte'}</label>
        <div className="relative">
          <ScanBarcode size={26} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-800" />
          <input id="scan" ref={champ} value={saisie} onChange={(e) => setSaisie(e.target.value)} autoComplete="off" spellCheck={false}
            placeholder={principal ? (principal.type === 'retour' ? `Entrée : noter le retour — ou ${ETIQUETTES ? 'scannez' : 'tapez'} le suivant` : `Entrée : transmettre — ou ${ETIQUETTES ? 'scannez' : 'tapez'} le suivant`) : (ETIQUETTES ? 'Scannez une étiquette (D0001234) ou tapez un n° d\'acte' : 'N° d\'acte (ex. 2479 ou 2025/2479)')}
            className="w-full pl-16 pr-12 py-5 rounded-lg border border-slate-300 bg-white text-xl font-bold tracking-wide text-slate-900 placeholder:text-slate-400 placeholder:font-semibold placeholder:text-base focus:outline-none focus:border-slate-300" />
          {cours && <Loader2 size={20} className="absolute right-5 top-1/2 -translate-y-1/2 animate-spin text-slate-800" />}
        </div>
      </form>

      {lecture?.erreur && (
        <div key={lecture.erreur} className="mt-5 animate-fade-in rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 flex items-start gap-3 text-amber-900">
          <AlertTriangle size={22} className="flex-shrink-0 mt-0.5" />
          <div className="text-base font-bold">{lecture.erreur}</div>
        </div>
      )}

      {lecture?.choix && (
        <div className="mt-5 glass-card-premium rounded-xl p-5">
          <div className="text-base font-bold text-slate-900 mb-3">Plusieurs dossiers portent cet acte : lequel ?</div>
          <ul className="space-y-2">
            {lecture.choix.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => lire(c.code)} className="w-full text-left rounded-xl border border-slate-200 px-4 py-3 hover:border-slate-500">
                  <div className="font-bold text-slate-900">{c.denomination}</div>
                  <div className="text-sm font-semibold text-slate-600">Acte {c.num_actes} · point du {dateCourte(c.date_point)} · {c.code}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dossier && (
        <div key={dossier.id} className="mt-5 animate-fade-in rounded-xl border border-green-200 bg-white p-5 md:p-6">
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-14 h-14 rounded-lg bg-docuflow-secondary text-white flex flex-col items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold opacity-80">lettre</span>
              <span className="text-2xl font-bold leading-none">{dossier.lettre || '—'}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xl font-bold text-slate-900 leading-tight">{dossier.denomination}</div>
              <div className="text-sm font-semibold text-slate-700 mt-0.5">
                {[dossier.num_actes && `Acte ${dossier.num_actes}`, dossier.type_garantie, `semaine du ${jour(dossier.semaine)}`, `point du ${jour(dossier.date_point)}`].filter(Boolean).join(' · ')}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {ETIQUETTES && <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-700"><Tag size={13} /> {dossier.code || codeDe(dossier.id)}</span>}
                {dossier.armoire && <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-sm font-bold text-white"><Archive size={13} /> {dossier.armoire}</span>}
              </div>
            </div>
          </div>

          {lecture.avertissement && <div className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-bold text-red-800">{lecture.avertissement}</div>}

          {lecture.sorties.length > 0 && (
            <div className="mt-5">
              <div className="text-sm font-bold text-amber-700 mb-2">Dossier sorti, à rentrer</div>
              <ul className="space-y-2">
                {lecture.sorties.map((d, i) => (
                  <li key={d.id} className={`rounded-lg border px-4 py-3 flex flex-wrap items-center gap-3 ${i === 0 ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-900">chez {d.requester_name}{d.section ? ` (${d.section})` : ''}</div>
                      <div className={`text-sm font-semibold ${enRetard(d.date_retour_prevue) ? 'text-red-700' : 'text-slate-600'}`}>
                        sorti le {dateCourte(d.remis_at)} · retour prévu le {dateCourte(d.date_retour_prevue)}{enRetard(d.date_retour_prevue) ? ', en retard' : ''}
                      </div>
                    </div>
                    <button type="button" onClick={() => agir('retour', d)} disabled={Boolean(geste)}
                      className="px-5 py-3 rounded-xl bg-amber-500 text-white font-bold inline-flex items-center gap-2 disabled:opacity-60">
                      {geste === `retour-${d.id}` ? <Loader2 size={17} className="animate-spin" /> : <Undo2 size={17} />} Retourné
                      {i === 0 && <span className="ml-1 rounded bg-white/25 px-1.5 text-xs">Entrée</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lecture.sorties.length === 0 && lecture.demandes.length > 0 && mf.annees.includes(Number(dossier.date_point.slice(0, 4))) && (
            <div className="mt-5 space-y-2">
              <div className="text-sm font-bold text-slate-800">Numérisé dans M-Files · envoyez la copie, le papier ne sort pas</div>
              {lecture.demandes.map((d) => (
                <div key={`mf-${d.id}`} className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1 font-bold text-slate-900">pour {d.requester_name}{d.section ? ` (${d.section})` : ''}</div>
                  <ServirMfiles d={d} url={mf.url} compact onFait={() => { setJournal((j) => [{ cle: `${Date.now()}`, type: 'mfiles', dossier, demande: d, heure: new Date() }, ...j].slice(0, 30)); setLecture(null); focus(); }} />
                </div>
              ))}
            </div>
          )}

          {lecture.sorties.length === 0 && (lecture.demandes.length ? (
            <div className="mt-5">
              <div className="text-sm font-bold text-green-700 mb-2">Demandes en attente</div>
              <ul className="space-y-2">
                {lecture.demandes.map((d, i) => (
                  <li key={d.id} className={`rounded-lg border px-4 py-3 flex flex-wrap items-center gap-3 ${i === 0 ? 'border-green-400 bg-green-50' : 'border-slate-200'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-900">pour {d.requester_name}{d.section ? ` (${d.section})` : ''}</div>
                      <div className="text-sm font-semibold text-slate-600">{[intitule(d), references(d), d.motif, `demandé le ${dateCourte(d.created_at)}`].filter(Boolean).join(' · ')}</div>
                      {d.force === 1 && <div className="text-xs font-bold text-amber-700">rapproché par le nom : vérifiez</div>}
                    </div>
                    <button type="button" onClick={() => agir('sortie', d)} disabled={Boolean(geste)}
                      className="px-5 py-3 rounded-xl bg-docuflow-secondary text-white font-bold inline-flex items-center gap-2 disabled:opacity-60">
                      {geste === `sortie-${d.id}` ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />} Transmettre
                      {i === 0 && <span className="ml-1 rounded bg-white/25 px-1.5 text-xs">Entrée</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-5 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-base font-bold text-slate-700">
              Au classement : aucune demande en attente pour ce dossier, et il n'est pas sorti.
            </div>
          ))}
        </div>
      )}

      {journal.length > 0 && (
        <section className="mt-6 glass-card-premium rounded-xl p-5">
          <h2 className="font-bold text-slate-900 mb-2">Gestes de la séance <span className="text-slate-500 font-bold">({journal.length})</span></h2>
          <ul className="divide-y divide-slate-100">
            {journal.map((g) => (
              <li key={g.cle} className="py-2.5 flex items-center gap-3 animate-fade-in-up">
                <CheckCircle2 size={18} className={g.type === 'sortie' ? 'text-green-600' : 'text-amber-600'} />
                <span className="min-w-0 flex-1 text-sm">
                  <strong className="font-bold text-slate-900">{g.dossier.denomination}</strong>
                  <span className="text-slate-700"> — {g.type === 'sortie' ? `transmis à ${g.demande.requester_name}` : g.type === 'mfiles' ? `copie M-Files envoyée à ${g.demande.requester_name}` : `retour de ${g.demande.requester_name}`}</span>
                </span>
                <span className="text-xs font-bold text-slate-500">{g.heure.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default DouchetteAfgc;
