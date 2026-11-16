import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PackageOpen, Upload, CalendarDays, Search, Printer, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, X, ArrowRight } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { lireClasseur } from '../../../utils/classeur';
import { entreeService } from '../../../services/entreeService';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, Pastille, Chargement } from './elements';
import { dateCourte, montantLisible } from './vocabulaire';
import { exporterClasseur, dateExcel, nomFichier } from './exportExcel';
import { lirePoint } from './pointsExcel';

// ============================================================================
// Entrée des dossiers : les « points des dossiers retirés » (Excel) importés,
// puis classés comme le fait l'archive — par SEMAINE DE PRODUCTION, du
// vendredi au jeudi, jours fériés exclus, et par LETTRE avant la mise en
// boîte. Une recherche retrouve un dossier par son nom ou l'un de ses n° d'acte
// et dit dans quelle semaine, sous quelle lettre, il a été rangé.
// ============================================================================

const ENVOI = 2000;
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const jourLong = (iso) => {
  const [a, m, j] = String(iso).split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return `${JOURS[d.getUTCDay()]} ${j} ${MOIS[m - 1]}`;
};
/** Jeudi qui clôt la semaine ouverte le vendredi `iso`. */
const finSemaine = (iso) => {
  const [a, m, j] = String(iso).split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + 6));
  return d.toISOString().slice(0, 10);
};
const libelleSemaine = (s) => `Semaine du ${jourLong(s.semaine)} au ${jourLong(s.au)} ${s.au.slice(0, 4)}`;

/** Import d'un ou plusieurs points : lecture dans le navigateur, envoi par paquets. */
const ImportPoints = ({ open, onClose, onFini }) => {
  const [lus, setLus] = useState([]);
  const [lecture, setLecture] = useState(false);
  const [envoi, setEnvoi] = useState(null);
  const [bilan, setBilan] = useState(null);
  const entree = useRef(null);

  useEffect(() => { if (open) { setLus([]); setBilan(null); setEnvoi(null); } }, [open]);

  const lire = async (fichiers) => {
    setLecture(true);
    const res = [];
    for (const f of fichiers) {
      try {
        const p = lirePoint(await lireClasseur(f));
        res.push({ nom: f.name, ...p, erreur: p.lignes.length ? null : 'Aucun dossier reconnu (en-tête « N° d\'ordre » introuvable).' });
      } catch {
        res.push({ nom: f.name, lignes: [], jours: [], erreur: 'Fichier illisible.' });
      }
    }
    setLus(res);
    setLecture(false);
  };

  const total = lus.reduce((n, f) => n + f.lignes.length, 0);
  const envoyer = async () => {
    const b = { ajoutees: 0, deja: 0, rejetees: 0 };
    let faits = 0;
    setEnvoi(0);
    try {
      for (const f of lus) {
        for (let i = 0; i < f.lignes.length; i += ENVOI) {
          const r = await entreeService.importer({ fichier: f.nom, lignes: f.lignes.slice(i, i + ENVOI) });
          b.ajoutees += r.ajoutees; b.deja += r.deja; b.rejetees += r.rejetees;
          faits += Math.min(ENVOI, f.lignes.length - i);
          setEnvoi(Math.round((faits / total) * 100));
        }
      }
      setBilan(b);
      onFini?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'L\'import s\'est interrompu ; relancez-le : ce qui est déjà importé ne sera pas doublé.');
      setEnvoi(null);
    }
  };

  return (
    <Modal open={open} onClose={envoi !== null && !bilan ? undefined : onClose} panelClassName="w-full max-w-2xl mx-4">
      <div className="bg-white rounded-3xl shadow-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Upload size={20} className="text-docuflow-secondary" />
          <h2 className="font-black text-slate-900 text-lg flex-1">Importer des points (Excel)</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100" aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5 space-y-4">
          {bilan ? (
            <div className="rounded-2xl bg-green-50 p-5 text-green-800">
              <div className="font-black flex items-center gap-2"><CheckCircle2 size={18} /> {bilan.ajoutees.toLocaleString('fr-FR')} dossiers entrés</div>
              <p className="text-sm mt-1">
                {bilan.deja > 0 && `${bilan.deja.toLocaleString('fr-FR')} déjà présents, ignorés. `}
                {bilan.rejetees > 0 && `${bilan.rejetees} lignes sans date, ni nom ni acte, écartées.`}
              </p>
            </div>
          ) : !lus.length ? (
            <>
              <p className="text-sm text-slate-600">
                Un ou plusieurs « points des dossiers retirés ». Chaque journée est reconnue à sa date ; les sous-totaux et les en-têtes
                répétés sont ignorés. Réimporter un classeur complété n'ajoute que ses nouvelles lignes.
              </p>
              <button type="button" onClick={() => entree.current?.click()}
                className="w-full rounded-3xl border-2 border-dashed border-slate-200 hover:border-docuflow-secondary py-12 flex flex-col items-center gap-3 text-slate-500">
                {lecture ? <Loader2 size={28} className="animate-spin text-docuflow-secondary" /> : <Upload size={28} className="text-docuflow-secondary" />}
                <span className="font-bold text-slate-700">{lecture ? 'Lecture des classeurs…' : 'Choisir les classeurs'}</span>
                <span className="text-xs">Excel (.xlsx, .xls) — lus sur votre poste</span>
              </button>
              <input ref={entree} type="file" multiple accept=".xlsx,.xls,.ods" className="hidden" onChange={(e) => lire([...(e.target.files || [])])} />
            </>
          ) : (
            <ul className="space-y-2">
              {lus.map((f) => (
                <li key={f.nom} className={`rounded-2xl p-4 ${f.erreur ? 'bg-red-50' : 'bg-slate-50'}`}>
                  <div className="font-bold text-slate-800 truncate">{f.nom}</div>
                  {f.erreur ? <div className="text-sm text-red-700 flex items-center gap-1.5"><AlertCircle size={14} /> {f.erreur}</div> : (
                    <div className="text-sm text-slate-500">
                      {f.lignes.length.toLocaleString('fr-FR')} dossiers · {f.jours.length} jours · du {dateCourte(f.jours[0])} au {dateCourte(f.jours[f.jours.length - 1])}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {envoi !== null && !bilan && (
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-docuflow-secondary transition-all" style={{ width: `${envoi}%` }} /></div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          {bilan ? (
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-docuflow-secondary text-white font-bold">Terminé</button>
          ) : lus.length > 0 && (
            <>
              <button type="button" onClick={() => setLus([])} disabled={envoi !== null} className="px-4 py-2.5 rounded-xl text-slate-600 font-bold hover:bg-slate-100">Autres classeurs</button>
              <button type="button" onClick={envoyer} disabled={!total || envoi !== null}
                className="px-5 py-2.5 rounded-xl bg-docuflow-secondary text-white font-bold inline-flex items-center gap-2 disabled:opacity-50">
                {envoi !== null && <Loader2 size={16} className="animate-spin" />}
                {envoi !== null ? `Import… ${envoi} %` : `Importer ${total.toLocaleString('fr-FR')} dossiers`}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

/** Bordereau de classement imprimé : la semaine, lettre par lettre. */
const BordereauImprime = ({ detail, groupes }) => (
  <div className="certificat">
    <h1>Bordereau de classement — {libelleSemaine(detail)}</h1>
    <p>{detail.dossiers.length} dossiers · édité le {new Date().toLocaleDateString('fr-FR')}</p>
    {groupes.map(([lettre, liste]) => (
      <div key={lettre} style={{ breakInside: 'avoid', marginTop: 12 }}>
        <h2>{lettre === 'Sans nom' ? lettre : `Lettre ${lettre}`} — {liste.length} dossier{liste.length > 1 ? 's' : ''}</h2>
        <table>
          <thead><tr><th>Dénomination</th><th>N° actes</th><th>Type</th><th>Point du</th><th>Agent</th><th>Rangé</th></tr></thead>
          <tbody>
            {liste.map((d) => (
              <tr key={d.id}><td>{d.denomination}</td><td>{d.num_actes}</td><td>{d.type_garantie}</td><td>{dateCourte(d.date_point)}</td><td>{d.agent}</td><td>☐</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    ))}
  </div>
);

const EntreesAfgc = () => {
  useTitrePage('Entrée des dossiers');
  const [onglet, setOnglet] = useState('semaines');
  const [importOuvert, setImportOuvert] = useState(false);
  const [filtres, setFiltres] = useState({ types: [], agents: [], annees: [] });
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [liste, setListe] = useState(null);
  const [choisie, setChoisie] = useState(null);
  const [detail, setDetail] = useState(null);
  const [lettreVisee, setLettreVisee] = useState(null);
  const [critere, setCritere] = useState({ q: '', type: '', agent: '', du: '', au: '' });
  const [resultats, setResultats] = useState(null);
  // Chaque recherche rallume les résultats (la lumière rejoue).
  const [tour, setTour] = useState(0);
  const [cherche, setCherche] = useState(false);

  const chargerFiltres = useCallback(() => entreeService.filtres().then(setFiltres).catch(() => {}), []);
  const chargerSemaines = useCallback(() => {
    setListe(null);
    entreeService.semaines(annee).then((l) => { setListe(l); setChoisie((c) => c && l.some((s) => s.semaine === c) ? c : l[0]?.semaine || null); })
      .catch(() => setListe([]));
  }, [annee]);
  useEffect(() => { chargerFiltres(); }, [chargerFiltres]);
  useEffect(() => { chargerSemaines(); }, [chargerSemaines]);
  useEffect(() => {
    if (!choisie) { setDetail(null); return; }
    setDetail(null);
    entreeService.semaine(choisie).then(setDetail).catch(() => toast.error('Cette semaine n\'a pas pu être chargée.'));
  }, [choisie]);

  const groupes = useMemo(() => {
    const m = new Map();
    for (const d of detail?.dossiers || []) {
      const l = d.lettre || 'Sans nom';
      if (!m.has(l)) m.set(l, []);
      m.get(l).push(d);
    }
    return [...m.entries()];
  }, [detail]);
  const semaineInfo = (liste || []).find((s) => s.semaine === choisie);

  useEffect(() => {
    if (!lettreVisee || !detail) return;
    const t = setTimeout(() => document.getElementById(`lettre-${lettreVisee}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => clearTimeout(t);
  }, [lettreVisee, detail]);

  const exporter = () => exporterClasseur(nomFichier('classement', choisie), [{
    nom: `Semaine du ${dateCourte(choisie).replace(/\//g, '-')}`,
    entetes: ['Lettre', 'Dénomination', 'N° actes', 'Type de garantie', 'Point du', 'Rubrique', 'Montant engagement', 'Agent'],
    largeurs: [7, 38, 22, 18, 12, 30, 18, 14],
    lignes: detail.dossiers.map((d) => [d.lettre || '', d.denomination || '', d.num_actes || '', d.type_garantie || '', dateExcel(d.date_point), d.rubrique || '', d.montant === null ? '' : Number(d.montant), d.agent || '']),
  }]).catch(() => toast.error('L\'export Excel a échoué.'));

  const rechercher = async (e) => {
    e?.preventDefault();
    setCherche(true);
    try { setResultats(await entreeService.rechercher(critere)); setTour((t) => t + 1); } catch (err) { toast.error(err.response?.data?.message || 'Recherche impossible.'); } finally { setCherche(false); }
  };
  const ouvrirSemaine = (d) => {
    setAnnee(Number(d.date_point.slice(0, 4)));
    setChoisie(d.semaine);
    setLettreVisee(d.lettre);
    setOnglet('semaines');
  };

  const annees = filtres.annees.length ? filtres.annees : [new Date().getFullYear()];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <EnTete titre="Entrée des dossiers" icone={PackageOpen}
        aide="Les points des dossiers retirés, classés par semaine de production (du vendredi au jeudi, jours fériés exclus), puis par lettre.">
        <button type="button" onClick={() => setImportOuvert(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-docuflow-secondary text-white text-sm font-bold">
          <Upload size={16} /> Importer des points (Excel)
        </button>
      </EnTete>

      <div className="inline-flex p-1 rounded-2xl bg-slate-100 mb-5">
        {[['semaines', 'Par semaine', CalendarDays], ['recherche', 'Rechercher', Search]].map(([cle, label, Icone]) => (
          <button key={cle} type="button" onClick={() => setOnglet(cle)}
            className={`px-4 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 ${onglet === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <Icone size={15} /> {label}
          </button>
        ))}
      </div>

      {onglet === 'semaines' ? (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <aside className="glass-card-premium rounded-3xl p-4 h-fit lg:sticky lg:top-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-500 mb-3">
              Année
              <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))} className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-700">
                {[...new Set([...annees, annee])].sort((a, b) => b - a).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            {liste === null ? <Chargement /> : !liste.length ? (
              <p className="text-sm text-slate-600 py-4">Aucun point importé pour {annee}.</p>
            ) : (
              <ul className="space-y-1 max-h-[65vh] overflow-y-auto pr-1">
                {liste.map((s) => (
                  <li key={s.semaine}>
                    <button type="button" onClick={() => { setChoisie(s.semaine); setLettreVisee(null); }}
                      className={`w-full text-left rounded-xl px-3 py-2.5 transition-colors ${choisie === s.semaine ? 'bg-green-50 ring-1 ring-green-200' : 'hover:bg-slate-50'}`}>
                      <div className="text-sm font-bold text-slate-800">{jourLong(s.semaine)} → {jourLong(s.au)}</div>
                      <div className="text-sm text-slate-600 flex flex-wrap gap-x-2">
                        <span>{s.dossiers} dossiers</span>
                        <span>{s.jours_ouvres.length} jours de production</span>
                        {s.feries.length > 0 && <span className="text-amber-700 font-semibold">férié : {s.feries.map(jourLong).join(', ')}</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="glass-card-premium rounded-3xl p-5 md:p-6 min-w-0">
            {!choisie ? <p className="text-sm text-slate-600">Choisissez une semaine.</p> : !detail ? <Chargement /> : (
              <>
                <div className="flex flex-wrap items-start gap-3 mb-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-black text-slate-900">{libelleSemaine(detail)}</h2>
                    <p className="text-sm font-semibold text-slate-700">
                      {detail.dossiers.length} dossiers à classer
                      {semaineInfo && ` · jours de production : ${semaineInfo.jours_ouvres.map(jourLong).join(', ')}`}
                      {semaineInfo?.feries.length > 0 && ` · férié : ${semaineInfo.feries.map(jourLong).join(', ')}`}
                    </p>
                  </div>
                  <button type="button" onClick={() => window.print()} className="px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 inline-flex items-center gap-1.5 hover:border-docuflow-secondary">
                    <Printer size={15} /> Bordereau de classement
                  </button>
                  <button type="button" onClick={exporter} className="px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 inline-flex items-center gap-1.5 hover:border-docuflow-secondary">
                    <FileSpreadsheet size={15} /> Excel
                  </button>
                </div>
                {/* Les lettres : un clic mène à la pile. */}
                <div className="flex flex-wrap gap-1.5 mb-4 sticky top-0 bg-white/90 backdrop-blur py-2 z-10">
                  {groupes.map(([l, ds]) => (
                    <button key={l} type="button" onClick={() => setLettreVisee(l)}
                      className={`min-w-[2.5rem] px-2 py-1.5 rounded-lg text-sm font-black border ${lettreVisee === l ? 'bg-docuflow-secondary text-white border-docuflow-secondary' : 'bg-white text-slate-700 border-slate-200 hover:border-docuflow-secondary'}`}>
                      {l} <span className={`text-[11px] font-bold ${lettreVisee === l ? 'text-white/80' : 'text-slate-400'}`}>{ds.length}</span>
                    </button>
                  ))}
                </div>
                <div className="space-y-5">
                  {groupes.map(([l, ds]) => (
                    // La lettre visée (depuis une recherche) s'allume.
                    <div key={lettreVisee === l ? `${l}-vise` : l} id={`lettre-${l}`}
                      className={`scroll-mt-16 ${lettreVisee === l ? 'resultat-lumiere rounded-2xl p-2 -m-2 bg-green-50/60' : ''}`}>
                      <h3 className="mb-2 flex items-center gap-2">
                        <span className={`min-w-[2.25rem] h-9 px-2 rounded-xl flex items-center justify-center text-lg font-black ${l === 'Sans nom' ? 'bg-slate-200 text-slate-700 text-sm' : 'bg-docuflow-secondary text-white'}`}>{l === 'Sans nom' ? '?' : l}</span>
                        <span className="text-base font-black text-slate-800">{l === 'Sans nom' ? 'Sans nom' : `Lettre ${l}`}</span>
                        <span className="text-sm font-bold text-slate-600">· {ds.length} dossier{ds.length > 1 ? 's' : ''}</span>
                      </h3>
                      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                        {ds.map((d) => (
                          <li key={d.id} className="px-3.5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                            <span className="font-bold text-slate-900 min-w-0 flex-1 basis-60">{d.denomination || '—'}</span>
                            <span className="text-sm font-semibold text-slate-700">{d.num_actes ? `Acte ${d.num_actes}` : 'sans n° d\'acte'}</span>
                            <Pastille ton={/att/i.test(d.type_garantie || '') ? 'gris' : 'vert'}>{d.type_garantie || '—'}</Pastille>
                            <span className="text-sm font-semibold text-slate-700 w-28">{jourLong(d.date_point)}</span>
                            <span className="text-sm text-slate-600 w-24 truncate">{d.agent}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      ) : (
        <section className="glass-card-premium rounded-3xl p-5 md:p-6">
          <form onSubmit={rechercher} className="flex flex-wrap items-end gap-3 mb-5">
            <label className="flex-1 min-w-[240px] text-sm font-bold text-slate-700">
              Nom ou n° d'acte
              <div className="relative mt-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={critere.q} onChange={(e) => setCritere((c) => ({ ...c, q: e.target.value }))} autoFocus
                  placeholder="ex. CREDO BTP, 1964, 2026/58" className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-docuflow-secondary" />
              </div>
            </label>
            <label className="text-sm font-bold text-slate-700">Type
              <select value={critere.type} onChange={(e) => setCritere((c) => ({ ...c, type: e.target.value }))} className="mt-1 block px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm">
                <option value="">Tous</option>{filtres.types.map((t) => <option key={t.v} value={t.v}>{t.v}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold text-slate-700">Agent
              <select value={critere.agent} onChange={(e) => setCritere((c) => ({ ...c, agent: e.target.value }))} className="mt-1 block px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm">
                <option value="">Tous</option>{filtres.agents.map((t) => <option key={t.v} value={t.v}>{t.v}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold text-slate-700">Du<input type="date" value={critere.du} onChange={(e) => setCritere((c) => ({ ...c, du: e.target.value }))} className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-sm" /></label>
            <label className="text-sm font-bold text-slate-700">Au<input type="date" value={critere.au} onChange={(e) => setCritere((c) => ({ ...c, au: e.target.value }))} className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-sm" /></label>
            <button type="submit" disabled={cherche} className="px-5 py-2.5 rounded-xl bg-docuflow-secondary text-white font-bold inline-flex items-center gap-2 disabled:opacity-60">
              {cherche ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Rechercher
            </button>
          </form>
          {resultats === null ? (
            <p className="text-base text-slate-600">Un nom (« CREDO BTP »), un n° d'acte (« 1964 » le trouve aussi dans « 1963-1964-1965 ») ou « 2026/58 ».</p>
          ) : !resultats.length ? (
            <div key={`vide-${tour}`} className="animate-fade-in-up rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center">
              <div className="text-lg font-black text-slate-700">Aucun dossier ne correspond.</div>
              <div className="text-sm text-slate-600 mt-1">Essayez une partie du nom, ou le n° d'acte seul.</div>
            </div>
          ) : (
            <div key={`res-${tour}`}>
              <p className="text-base font-bold text-slate-700 mb-3 animate-fade-in-up">
                {resultats.length >= 300 ? 'Les 300 plus récents' : `${resultats.length} dossier${resultats.length > 1 ? 's' : ''} trouvé${resultats.length > 1 ? 's' : ''}`}
              </p>
              <ul className="space-y-3">
                {resultats.map((d, i) => (
                  <li key={d.id} className="resultat-lumiere rounded-2xl border-2 border-green-200 bg-white p-4 md:p-5"
                    style={{ '--delai': `${Math.min(i, 8) * 0.09}s` }}>
                    <div className="flex flex-wrap items-start gap-4">
                      {/* La lettre de classement, comme l'onglet d'un classeur. */}
                      <div className="lumiere-pastille w-14 h-14 rounded-2xl bg-docuflow-secondary text-white flex flex-col items-center justify-center flex-shrink-0 shadow-lg shadow-green-200">
                        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">lettre</span>
                        <span className="text-2xl font-black leading-none">{d.lettre || '—'}</span>
                      </div>
                      <div className="min-w-0 flex-1 basis-60">
                        <div className="text-lg md:text-xl font-black text-slate-900 leading-tight">{d.denomination || '—'}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-700">
                          {[d.num_actes && `Acte ${d.num_actes}`, d.type_garantie, d.agent && `agent ${d.agent}`, montantLisible(d.montant)].filter(Boolean).join(' · ')}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="inline-flex items-baseline gap-2 rounded-xl bg-green-50 border border-green-200 px-3 py-2">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-green-700">Semaine</span>
                            <span className="text-base font-black text-green-900">{jourLong(d.semaine)} → {jourLong(d.au || finSemaine(d.semaine))} {d.semaine.slice(0, 4)}</span>
                          </span>
                          <span className="inline-flex items-baseline gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Point du</span>
                            <span className="text-base font-black text-amber-900">{jourLong(d.date_point)} {d.date_point.slice(0, 4)}</span>
                          </span>
                        </div>
                      </div>
                      <button type="button" onClick={() => ouvrirSemaine(d)}
                        className="self-center px-4 py-2.5 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-1.5 hover:opacity-90 shadow-md shadow-green-200">
                        Ouvrir la semaine <ArrowRight size={15} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <ImportPoints open={importOuvert} onClose={() => setImportOuvert(false)} onFini={() => { chargerFiltres(); chargerSemaines(); }} />
      {detail && onglet === 'semaines' && createPortal(
        <div className="portail-impression"><BordereauImprime detail={detail} groupes={groupes} /></div>,
        document.body,
      )}
    </div>
  );
};

export default EntreesAfgc;
