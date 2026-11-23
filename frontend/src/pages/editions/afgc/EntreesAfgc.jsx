import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { PackageOpen, Upload, CalendarDays, Search, Printer, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, X, ArrowRight, Trash2, Archive, Pencil, Plus, Tag } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { lireClasseur } from '../../../utils/classeur';
import { entreeService } from '../../../services/entreeService';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, Pastille, Chargement } from './elements';
import { dateCourte, montantLisible } from './vocabulaire';
import { exporterClasseur, dateExcel, nomFichier } from './exportExcel';
import { lirePoint } from './pointsExcel';
import { ModaleEtiquettes, ImpressionEtiquettes } from './etiquettes';
import { edition } from '../../../editions';
import Armoires3D from './Armoires3D';

// Impression des étiquettes : réglée par l'édition (désactivée pour l'instant).
const ETIQUETTES = edition?.etiquettes !== false;

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
      <div className="bg-white rounded-xl shadow-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <Upload size={20} className="text-docuflow-secondary" />
          <h2 className="font-bold text-slate-900 text-lg flex-1">Importer des points (Excel)</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100" aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5 space-y-4">
          {bilan ? (
            <div className="rounded-lg bg-green-50 p-5 text-green-800">
              <div className="font-bold flex items-center gap-2"><CheckCircle2 size={18} /> {bilan.ajoutees.toLocaleString('fr-FR')} dossiers entrés</div>
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
                className="w-full rounded-xl border border-dashed border-slate-200 hover:border-docuflow-secondary py-12 flex flex-col items-center gap-3 text-slate-500">
                {lecture ? <Loader2 size={28} className="animate-spin text-docuflow-secondary" /> : <Upload size={28} className="text-docuflow-secondary" />}
                <span className="font-bold text-slate-700">{lecture ? 'Lecture des classeurs…' : 'Choisir les classeurs'}</span>
                <span className="text-xs">Excel (.xlsx, .xls) — lus sur votre poste</span>
              </button>
              <input ref={entree} type="file" multiple accept=".xlsx,.xls,.ods" className="hidden" onChange={(e) => lire([...(e.target.files || [])])} />
            </>
          ) : (
            <ul className="space-y-2">
              {lus.map((f) => (
                <li key={f.nom} className={`rounded-lg p-4 ${f.erreur ? 'bg-red-50' : 'bg-slate-50'}`}>
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

/** Les armoires d'un groupe de dossiers (une lettre peut être partagée entre deux). */
const armoiresDe = (liste) => [...new Set(liste.map((d) => d.armoire).filter(Boolean))].join(' / ');
/** Version courte, sans le lieu : « Armoire 3 ou Armoire 4 ». */
const armoiresCourtes = (liste) => [...new Set(liste.flatMap((d) => (d.armoire ? d.armoire.split(' ou ').map((a) => a.split(' · ')[0]) : [])))].join(' ou ');

/** Bordereau de classement imprimé : la semaine, lettre par lettre. */
const BordereauImprime = ({ detail, groupes }) => (
  <div className="certificat">
    <h1>Bordereau de classement — {libelleSemaine(detail)}</h1>
    <p>{detail.dossiers.length} dossiers · édité le {new Date().toLocaleDateString('fr-FR')}</p>
    {groupes.map(([lettre, liste]) => (
      <div key={lettre} style={{ breakInside: 'avoid', marginTop: 12 }}>
        <h2>{lettre === 'Sans nom' ? lettre : `Lettre ${lettre}`} — {liste.length} dossier{liste.length > 1 ? 's' : ''}{armoiresDe(liste) ? ` — ${armoiresDe(liste)}` : ''}</h2>
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

/**
 * Les classeurs importés : nom, lignes, période couverte, import. Un classeur
 * périmé ou importé par erreur se supprime (toutes ses lignes) ; le classeur
 * corrigé peut ensuite être réimporté.
 */
/**
 * Les entrées importées avant la règle actuelle des lettres (« 2SND » en #,
 * « Société Gbèdé » en S…) : l'aperçu, puis la mise à jour, sur décision.
 */
const LettresAnciennes = ({ onChange }) => {
  const [apercu, setApercu] = useState(null);
  const [voir, setVoir] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const charger = useCallback(() => entreeService.lettresApercu().then(setApercu).catch(() => setApercu(null)), []);
  useEffect(() => { charger(); }, [charger]);
  if (!apercu?.total) return null;
  const appliquer = async () => {
    setEnvoi(true);
    try {
      const r = await entreeService.lettresAppliquer();
      toast.success(`${r.modifiees.toLocaleString('fr-FR')} entrée${r.modifiees > 1 ? 's' : ''} reclassée${r.modifiees > 1 ? 's' : ''}.`);
      setVoir(false); charger(); onChange?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'La mise à jour a échoué.');
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">
        {apercu.total.toLocaleString('fr-FR')} entrée{apercu.total > 1 ? 's' : ''} ({apercu.entreprises} entreprise{apercu.entreprises > 1 ? 's' : ''}) {apercu.total > 1 ? 'ont' : 'a'} encore la lettre de l'ancienne règle
        (chiffre de tête, « Société », « Entreprise » non sautés, ou « Groupe » sauté). Rien n'est changé sans votre accord : vérifiez d'abord que cela correspond au rangement réel.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => setVoir((v) => !v)} className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-sm font-bold text-amber-900">{voir ? 'Masquer' : 'Voir les changements'}</button>
        <button type="button" onClick={appliquer} disabled={envoi} className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-sm font-bold disabled:opacity-60 inline-flex items-center gap-1.5">
          {envoi && <Loader2 size={14} className="animate-spin" />} Appliquer la nouvelle règle
        </button>
      </div>
      {voir && (
        <ul className="mt-3 max-h-72 overflow-y-auto divide-y divide-amber-100 rounded-lg border border-amber-200 bg-white text-sm">
          {apercu.exemples.map((x) => (
            <li key={`${x.denomination}|${x.actuelle}`} className="px-3 py-1.5 flex flex-wrap gap-x-3">
              <span className="font-semibold text-slate-900 flex-1 min-w-0">{x.denomination}</span>
              <span className="text-slate-700">{x.actuelle || '—'} → <strong>{x.nouvelle}</strong></span>
              <span className="text-slate-500 w-20 text-right">{x.entrees} entrée{x.entrees > 1 ? 's' : ''}</span>
            </li>
          ))}
          {apercu.entreprises > apercu.exemples.length && <li className="px-3 py-1.5 text-slate-500">… et {apercu.entreprises - apercu.exemples.length} autres entreprises.</li>}
        </ul>
      )}
    </div>
  );
};


const ClasseursImportes = ({ onChange, onImporter }) => {
  const [liste, setListe] = useState(null);
  const [aSupprimer, setASupprimer] = useState(null); // { fichier, lignes } ou { tous: true, lignes }
  const [saisie, setSaisie] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const charger = useCallback(() => entreeService.fichiers().then(setListe).catch(() => setListe([])), []);
  useEffect(() => { charger(); }, [charger]);
  const total = (liste || []).reduce((n, f) => n + f.lignes, 0);
  const fermer = () => { if (!envoi) { setASupprimer(null); setSaisie(''); } };
  const supprimer = async () => {
    setEnvoi(true);
    try {
      const r = await entreeService.supprimerFichier(aSupprimer.tous ? { tous: true } : { fichier: aSupprimer.fichier });
      toast.success(`${r.supprimees.toLocaleString('fr-FR')} ligne${r.supprimees > 1 ? 's' : ''} supprimée${r.supprimees > 1 ? 's' : ''}.`);
      setASupprimer(null); setSaisie('');
      charger(); onChange?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'La suppression a échoué.');
    } finally {
      setEnvoi(false);
    }
  };
  if (liste === null) return <Chargement />;
  return (
    <section className="glass-card-premium rounded-xl p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-900">Classeurs importés</h2>
          <p className="text-sm font-semibold text-slate-600">
            {liste.length ? `${liste.length} classeur${liste.length > 1 ? 's' : ''} · ${total.toLocaleString('fr-FR')} dossiers entrés` : 'Aucun classeur importé.'}
          </p>
        </div>
        {liste.length > 1 && (
          <button type="button" onClick={() => setASupprimer({ tous: true, lignes: total })}
            className="px-4 py-2.5 rounded-xl border border-red-200 text-sm font-bold text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5">
            <Trash2 size={15} /> Tout supprimer
          </button>
        )}
      </div>
      <LettresAnciennes onChange={onChange} />
      {liste.length ? (
        <ul className="space-y-2">
          {liste.map((f) => (
            <li key={f.fichier ?? '—'} className="rounded-lg border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="w-10 h-10 rounded-xl bg-green-50 text-docuflow-secondary flex items-center justify-center flex-shrink-0"><FileSpreadsheet size={20} /></span>
              <div className="min-w-0 flex-1 basis-60">
                <div className="text-base font-bold text-slate-900 break-all">{f.fichier || 'Sans nom de classeur'}</div>
                <div className="text-sm font-semibold text-slate-700">
                  {f.lignes.toLocaleString('fr-FR')} dossier{f.lignes > 1 ? 's' : ''} · du {dateCourte(f.du)} au {dateCourte(f.au)}
                </div>
                <div className="text-sm text-slate-600">Importé le {dateCourte(f.importe_le)}{f.importe_par ? ` par ${f.importe_par}` : ''}</div>
              </div>
              <button type="button" onClick={() => setASupprimer(f)}
                className="px-3.5 py-2 rounded-xl border border-red-200 text-sm font-bold text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5">
                <Trash2 size={15} /> Supprimer
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <button type="button" onClick={onImporter} className="px-4 py-2.5 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-2">
          <Upload size={16} /> Importer des points (Excel)
        </button>
      )}

      <Modal open={Boolean(aSupprimer)} onClose={fermer} panelClassName="w-full max-w-md mx-4">
        {aSupprimer && (
          <div className="bg-white rounded-xl shadow-2xl p-6">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0"><Trash2 size={20} /></span>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900">
                  {aSupprimer.tous ? 'Supprimer tous les classeurs ?' : 'Supprimer ce classeur ?'}
                </h3>
                {!aSupprimer.tous && <p className="text-sm font-bold text-slate-800 break-all">{aSupprimer.fichier || 'Sans nom de classeur'}</p>}
                <p className="text-sm text-slate-700 mt-1">
                  {aSupprimer.lignes > 1
                    ? `${aSupprimer.lignes.toLocaleString('fr-FR')} dossiers entrés seront retirés des semaines et de la recherche.`
                    : '1 dossier entré sera retiré des semaines et de la recherche.'}
                  Le classeur pourra être réimporté.
                </p>
              </div>
            </div>
            {aSupprimer.tous && (
              <label className="block mt-4 text-sm font-bold text-slate-700">
                Tapez SUPPRIMER pour confirmer
                <input value={saisie} onChange={(e) => setSaisie(e.target.value)} autoFocus
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-red-400" />
              </label>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={fermer} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100">Garder</button>
              <button type="button" onClick={supprimer} disabled={envoi || (aSupprimer.tous && saisie.trim().toUpperCase() !== 'SUPPRIMER')}
                className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
                {envoi ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Supprimer
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
};

const LETTRES = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const VIDE = { nom: '', lieu: '', debut_semaine: '', debut_lettre: '', fin_semaine: '', fin_lettre: '' };

/** « ven. 7 févr. 2025, lettre C » ; sans lettre : depuis le début / jusqu'à la fin de la semaine. */
const borne = (semaine, lettre, debut) => {
  const fin = finSemaine(semaine);
  const libelle = `semaine du ${jourLong(semaine)} au ${jourLong(fin)} ${fin.slice(0, 4)}`;
  if (!lettre) return { libelle, lettre: debut ? 'depuis le début' : 'jusqu\'à la fin' };
  return { libelle, lettre: `lettre ${lettre === '#' ? '# (chiffres)' : lettre}` };
};

/**
 * Plan de rangement : les armoires, chacune de (semaine, lettre) à (semaine,
 * lettre). Les dossiers entrés y sont situés automatiquement — semaines,
 * recherche, demandes.
 */
const PlanRangement = ({ onChange, cible, onFermerCible }) => {
  const [armoires, setArmoires] = useState(null);
  const [plan, setPlan] = useState({ plan: [], manquants: 0 });
  const [edite, setEdite] = useState(null); // null, 'nouvelle' ou l'id
  const [form, setForm] = useState(VIDE);
  const [envoi, setEnvoi] = useState(false);
  const [aSupprimer, setASupprimer] = useState(null);
  const charger = useCallback(() => {
    entreeService.rangements().then(setArmoires).catch(() => setArmoires([]));
    entreeService.planRangement().then(setPlan).catch(() => setPlan({ plan: [], manquants: 0 }));
  }, []);
  useEffect(() => { charger(); }, [charger]);
  const ouvrir = (a) => {
    setEdite(a ? a.id : 'nouvelle');
    setForm(a ? { ...VIDE, ...a, lieu: a.lieu || '', debut_lettre: a.debut_lettre || '', fin_lettre: a.fin_lettre || '' }
      : { ...VIDE, lieu: armoires?.[armoires.length - 1]?.lieu || '', nom: `Armoire ${(armoires?.length || 0) + 1}` });
  };
  const enregistrer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      if (edite === 'nouvelle') await entreeService.creerRangement(form);
      else await entreeService.modifierRangement(edite, form);
      toast.success(`${form.nom} enregistrée.`);
      setEdite(null); charger(); onChange?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'L\'armoire n\'a pas pu être enregistrée.');
    } finally { setEnvoi(false); }
  };
  const installer = async () => {
    setEnvoi(true);
    try {
      const r = await entreeService.installerPlan();
      toast.success(`${r.ajoutees} armoire${r.ajoutees > 1 ? 's' : ''} ajoutée${r.ajoutees > 1 ? 's' : ''} au plan.`);
      charger(); onChange?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Le plan n\'a pas pu être installé.');
    } finally { setEnvoi(false); }
  };
  const supprimer = async () => {
    setEnvoi(true);
    try {
      await entreeService.supprimerRangement(aSupprimer.id);
      toast.success(`${aSupprimer.nom} retirée du plan.`);
      setASupprimer(null); charger(); onChange?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Suppression impossible.');
    } finally { setEnvoi(false); }
  };
  const champ = 'mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-slate-300 bg-white';
  const choixLettre = (cle, vide) => (
    <select value={form[cle]} onChange={(e) => setForm((f) => ({ ...f, [cle]: e.target.value }))} className={champ}>
      <option value="">{vide}</option>
      {LETTRES.map((l) => <option key={l} value={l}>{l === '#' ? '# (chiffres)' : l}</option>)}
    </select>
  );
  if (armoires === null) return <Chargement />;
  return (
    <section className="glass-card-premium rounded-xl p-5 md:p-6">
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-900">Plan de rangement</h2>
          <p className="text-sm font-semibold text-slate-600">
            Chaque armoire va d'une semaine et d'une lettre à une autre. Les dossiers y sont situés d'eux-mêmes : semaines, recherche et demandes affichent leur armoire.
          </p>
        </div>
        <button type="button" onClick={() => ouvrir(null)} className="px-4 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-bold inline-flex items-center gap-2">
          <Plus size={16} /> Ajouter une armoire
        </button>
      </div>

      {armoires.length > 0 && <Armoires3D armoires={armoires} cible={cible} onFermerCible={onFermerCible} />}

      {plan.manquants > 0 && (
        <div className="animate-fade-in mb-4 rounded-lg border border-slate-300 bg-slate-50 px-5 py-4 flex flex-wrap items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-slate-800 text-white flex items-center justify-center flex-shrink-0"><Archive size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold text-slate-900">Plan du couloir des toilettes : {plan.manquants} armoire{plan.manquants > 1 ? 's' : ''} à installer</div>
            <div className="text-sm font-semibold text-slate-600">
              {plan.plan.map((a) => a.nom).join(', ')} — semaines de 2025, telles que relevées à l'archive. Tout reste modifiable.
            </div>
          </div>
          <button type="button" onClick={installer} disabled={envoi} className="px-4 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60">
            {envoi ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />} Installer le plan
          </button>
        </div>
      )}

      {edite && (
        <form onSubmit={enregistrer} className="mb-4 rounded-lg border border-slate-300 bg-slate-50 p-4 grid gap-3 md:grid-cols-2 animate-fade-in-up">
          <label className="text-sm font-bold text-slate-700">Nom<input value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} maxLength={60} placeholder="Armoire 3" className={champ} /></label>
          <label className="text-sm font-bold text-slate-700">Lieu<input value={form.lieu} onChange={(e) => setForm((f) => ({ ...f, lieu: e.target.value }))} maxLength={120} placeholder="Couloir des toilettes" className={champ} /></label>
          <fieldset className="rounded-xl bg-white border border-slate-200 p-3">
            <legend className="px-1 text-sm font-bold text-slate-800">Commence à</legend>
            <label className="text-sm font-bold text-slate-700">Un jour de la semaine<input type="date" value={form.debut_semaine} onChange={(e) => setForm((f) => ({ ...f, debut_semaine: e.target.value }))} className={champ} /></label>
            <label className="block mt-2 text-sm font-bold text-slate-700">Lettre{choixLettre('debut_lettre', 'Début de la semaine')}</label>
          </fieldset>
          <fieldset className="rounded-xl bg-white border border-slate-200 p-3">
            <legend className="px-1 text-sm font-bold text-slate-800">Finit à</legend>
            <label className="text-sm font-bold text-slate-700">Un jour de la semaine<input type="date" value={form.fin_semaine} onChange={(e) => setForm((f) => ({ ...f, fin_semaine: e.target.value }))} className={champ} /></label>
            <label className="block mt-2 text-sm font-bold text-slate-700">Lettre{choixLettre('fin_lettre', 'Fin de la semaine')}</label>
          </fieldset>
          <p className="md:col-span-2 text-sm text-slate-600">N'importe quel jour suffit : la semaine de production (vendredi → jeudi) est retrouvée. Une lettre partagée entre deux armoires (« S », puis « S' ») se met dans les deux.</p>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setEdite(null)} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100">Annuler</button>
            <button type="submit" disabled={envoi} className="px-5 py-2.5 rounded-xl bg-slate-800 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60">
              {envoi ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Enregistrer
            </button>
          </div>
        </form>
      )}

      {armoires.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {armoires.map((a) => {
            const de = borne(a.debut_semaine, a.debut_lettre, true);
            const a2 = borne(a.fin_semaine, a.fin_lettre, false);
            return (
              <li key={a.id} className="rounded-lg border border-slate-300 bg-white p-4">
                <div className="flex items-start gap-3">
                  <span className="w-11 h-11 rounded-xl bg-slate-800 text-white flex items-center justify-center flex-shrink-0"><Archive size={20} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-bold text-slate-900 leading-tight">{a.nom}</div>
                    {a.lieu && <div className="text-sm font-semibold text-slate-600">{a.lieu}</div>}
                  </div>
                  <button type="button" onClick={() => ouvrir(a)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label={`Modifier ${a.nom}`}><Pencil size={16} /></button>
                  <button type="button" onClick={() => setASupprimer(a)} className="p-2 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label={`Retirer ${a.nom}`}><Trash2 size={16} /></button>
                </div>
                <div className="mt-3 grid gap-2 text-sm">
                  <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2">
                    <span className="text-[11px] font-bold text-green-700">De</span>
                    <div className="font-bold text-green-950">{de.libelle}</div>
                    <div className="font-bold text-green-800">{de.lettre}</div>
                  </div>
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
                    <span className="text-[11px] font-bold text-amber-700">À</span>
                    <div className="font-bold text-amber-950">{a2.libelle}</div>
                    <div className="font-bold text-amber-800">{a2.lettre}</div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : !plan.manquants && <p className="text-base text-slate-600">Aucune armoire. Ajoutez-en une : nom, lieu, et la plage de semaines et de lettres qu'elle contient.</p>}

      <Modal open={Boolean(aSupprimer)} onClose={envoi ? undefined : () => setASupprimer(null)} panelClassName="w-full max-w-md mx-4">
        {aSupprimer && (
          <div className="bg-white rounded-xl shadow-2xl p-6">
            <h3 className="text-lg font-bold text-slate-900">Retirer {aSupprimer.nom} du plan ?</h3>
            <p className="text-sm text-slate-700 mt-1">Les dossiers ne sont pas touchés : ils n'afficheront simplement plus cette armoire.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setASupprimer(null)} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100">Garder</button>
              <button type="button" onClick={supprimer} disabled={envoi} className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
                {envoi ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Retirer
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
};

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
  // Étiquettes à code-barres (053) : choix du format, puis impression.
  const [etiquettes, setEtiquettes] = useState(null);
  const [impression, setImpression] = useState(null);
  // Armoire d'un dossier, montrée en 3D dans l'onglet Rangement.
  const [cibleArmoire, setCibleArmoire] = useState(null);
  const voirArmoire = (armoire, semaine) => {
    const nom = String(armoire || '').split(' ou ')[0].split(' · ')[0];
    if (!nom) return;
    setCibleArmoire({ nom, semaine });
    setOnglet('rangement');
  };
  const avecSemaine = (liste) => liste.map((d) => ({ ...d, semaine: d.semaine || detail?.semaine, au: d.au || (d.semaine ? undefined : detail?.au) }));
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

  // Lettre mal devinée (« Société » faisant partie du nom…) : corrigée pour toute l'entreprise.
  const corrigerLettre = async (d, valeur) => {
    if (!d.denomination || valeur === (d.lettre || '')) return;
    try {
      const r = await entreeService.corrigerLettre(d.denomination, valeur === 'auto' ? null : valeur);
      toast.success(`${d.denomination} : lettre ${r.lettre}${r.automatique ? ' (règle)' : ''}, ${r.modifiees} entrée${r.modifiees > 1 ? 's' : ''} mise${r.modifiees > 1 ? 's' : ''} à jour.`);
      setLettreVisee(r.lettre);
      entreeService.semaine(choisie).then(setDetail).catch(() => {});
    } catch (err) {
      toast.error(err.response?.data?.message || 'La lettre n\'a pas pu être corrigée.');
    }
  };

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

  // Arrivée depuis DocuBot : « ?q=Credo BTP » lance la recherche, « ?semaine=2025-10-03 » ouvre la semaine.
  const [adresse, setAdresse] = useSearchParams();
  useEffect(() => {
    const q = adresse.get('q');
    const sem = adresse.get('semaine');
    if (!q && !sem) return;
    if (q) {
      const c = { q, type: '', agent: '', du: '', au: '' };
      setCritere(c);
      setOnglet('recherche');
      setCherche(true);
      entreeService.rechercher(c).then((r) => { setResultats(r); setTour((t) => t + 1); })
        .catch((err) => toast.error(err.response?.data?.message || 'Recherche impossible.')).finally(() => setCherche(false));
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(sem)) {
      setAnnee(Number(sem.slice(0, 4)));
      setChoisie(sem);
      setOnglet('semaines');
    }
    setAdresse({}, { replace: true });
  }, [adresse, setAdresse]);

  const annees = filtres.annees.length ? filtres.annees : [new Date().getFullYear()];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <EnTete titre="Entrée des dossiers" icone={PackageOpen}
        aide="Les points des dossiers retirés, classés par semaine de production (du vendredi au jeudi, jours fériés exclus), puis par lettre. La lettre ne tient pas compte de « Société » ni d'« Entreprise » (sauf s'ils font partie du nom officiel) ni des chiffres de tête (« 2SND » → S) ; si elle est mal devinée, corrigez-la au bout de la ligne.">
        <button type="button" onClick={() => setImportOuvert(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-docuflow-secondary text-white text-sm font-bold">
          <Upload size={16} /> Importer des points (Excel)
        </button>
      </EnTete>

      <div className="inline-flex p-1 rounded-lg bg-slate-100 mb-5">
        {[['semaines', 'Par semaine', CalendarDays], ['recherche', 'Rechercher', Search], ['rangement', 'Rangement', Archive], ['classeurs', 'Classeurs importés', FileSpreadsheet]].map(([cle, label, Icone]) => (
          <button key={cle} type="button" onClick={() => setOnglet(cle)}
            className={`px-4 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 ${onglet === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <Icone size={15} /> {label}
          </button>
        ))}
      </div>

      {onglet === 'semaines' ? (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <aside className="glass-card-premium rounded-xl p-4 h-fit lg:sticky lg:top-4">
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

          <section className="glass-card-premium rounded-xl p-5 md:p-6 min-w-0">
            {!choisie ? <p className="text-sm text-slate-600">Choisissez une semaine.</p> : !detail ? <Chargement /> : (
              <>
                <div className="flex flex-wrap items-start gap-3 mb-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold text-slate-900">{libelleSemaine(detail)}</h2>
                    <p className="text-sm font-semibold text-slate-700">
                      {detail.dossiers.length} dossiers à classer
                      {semaineInfo && ` · jours de production : ${semaineInfo.jours_ouvres.map(jourLong).join(', ')}`}
                      {semaineInfo?.feries.length > 0 && ` · férié : ${semaineInfo.feries.map(jourLong).join(', ')}`}
                    </p>
                  </div>
                  <button type="button" onClick={() => window.print()} className="px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 inline-flex items-center gap-1.5 hover:border-docuflow-secondary">
                    <Printer size={15} /> Bordereau de classement
                  </button>
                  {ETIQUETTES && <button type="button" onClick={() => setEtiquettes({ dossiers: avecSemaine(detail.dossiers), titre: libelleSemaine(detail) })}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 bg-slate-50 text-sm font-bold text-slate-800 inline-flex items-center gap-1.5 hover:border-slate-500">
                    <Tag size={15} /> Étiquettes
                  </button>}
                  <button type="button" onClick={exporter} className="px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 inline-flex items-center gap-1.5 hover:border-docuflow-secondary">
                    <FileSpreadsheet size={15} /> Excel
                  </button>
                </div>
                {/* Les lettres : un clic mène à la pile. */}
                <div className="flex flex-wrap gap-1.5 mb-4 sticky top-0 bg-white/90 backdrop-blur py-2 z-10">
                  {groupes.map(([l, ds]) => (
                    <button key={l} type="button" onClick={() => setLettreVisee(l)}
                      className={`min-w-[2.5rem] px-2 py-1.5 rounded-lg text-sm font-bold border ${lettreVisee === l ? 'bg-docuflow-secondary text-white border-docuflow-secondary' : 'bg-white text-slate-700 border-slate-200 hover:border-docuflow-secondary'}`}>
                      {l} <span className={`text-[11px] font-bold ${lettreVisee === l ? 'text-white/80' : 'text-slate-400'}`}>{ds.length}</span>
                    </button>
                  ))}
                </div>
                <div className="space-y-5">
                  {groupes.map(([l, ds]) => (
                    // La lettre visée (depuis une recherche) s'allume.
                    <div key={lettreVisee === l ? `${l}-vise` : l} id={`lettre-${l}`}
                      className={`scroll-mt-32 ${lettreVisee === l ? 'animate-fade-in rounded-lg p-2 -m-2 bg-green-50/60' : ''}`}>
                      <h3 className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`min-w-[2.25rem] h-9 px-2 rounded-xl flex items-center justify-center text-lg font-bold ${l === 'Sans nom' ? 'bg-slate-200 text-slate-700 text-sm' : 'bg-docuflow-secondary text-white'}`}>{l === 'Sans nom' ? '?' : l}</span>
                        <span className="text-base font-bold text-slate-800">{l === 'Sans nom' ? 'Sans nom' : `Lettre ${l}`}</span>
                        <span className="text-sm font-bold text-slate-600">· {ds.length} dossier{ds.length > 1 ? 's' : ''}</span>
                        {armoiresDe(ds) ? (
                          <button type="button" onClick={() => voirArmoire(armoiresCourtes(ds), detail.semaine)} title="Voir l'armoire en 3D"
                            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-slate-800 text-white px-3 py-1.5 text-sm font-bold hover:bg-slate-900">
                            <Archive size={14} /> {armoiresCourtes(ds)}
                          </button>
                        ) : <span className="ml-auto text-xs font-bold text-slate-500">armoire non renseignée</span>}
                        {ETIQUETTES && <button type="button" onClick={() => setEtiquettes({ dossiers: avecSemaine(ds), titre: `${libelleSemaine(detail)} — ${l === 'Sans nom' ? 'sans nom' : `lettre ${l}`}` })}
                          className="p-2 rounded-lg text-slate-800 hover:bg-slate-50" title={`Étiquettes de la lettre ${l}`} aria-label={`Étiquettes de la lettre ${l}`}>
                          <Tag size={16} />
                        </button>}
                      </h3>
                      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                        {ds.map((d) => (
                          <li key={d.id} className="px-3.5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                            <span className="font-bold text-slate-900 min-w-0 flex-1 basis-60">{d.denomination || '—'}</span>
                            <span className="text-sm font-semibold text-slate-700">{d.num_actes ? `Acte ${d.num_actes}` : 'sans n° d\'acte'}</span>
                            <Pastille ton={/att/i.test(d.type_garantie || '') ? 'gris' : 'vert'}>{d.type_garantie || '—'}</Pastille>
                            <span className="text-sm font-semibold text-slate-700 w-28">{jourLong(d.date_point)}</span>
                            <span className="text-sm text-slate-600 w-24 truncate">{d.agent}</span>
                            {d.denomination && (
                              <select value={d.lettre || ''} onChange={(e) => corrigerLettre(d, e.target.value)}
                                title="Corriger la lettre de classement (vaut pour toutes les entrées de cette entreprise)"
                                aria-label={`Lettre de classement de ${d.denomination}`}
                                className="text-xs font-bold text-slate-600 border border-slate-200 rounded-md px-1.5 py-1 bg-white hover:border-docuflow-secondary">
                                {LETTRES.map((x) => <option key={x} value={x}>Lettre {x}</option>)}
                                <option value="auto">Selon la règle</option>
                              </select>
                            )}
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
      ) : onglet === 'rangement' ? (
        <PlanRangement cible={cibleArmoire} onFermerCible={() => setCibleArmoire(null)}
          onChange={() => { if (choisie) entreeService.semaine(choisie).then(setDetail).catch(() => {}); setResultats(null); }} />
      ) : onglet === 'classeurs' ? (
        <ClasseursImportes onImporter={() => setImportOuvert(true)} onChange={() => { chargerFiltres(); chargerSemaines(); setResultats(null); setChoisie(null); }} />
      ) : (
        <section className="glass-card-premium rounded-xl p-5 md:p-6">
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
            <div key={`vide-${tour}`} className="animate-fade-in-up rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center">
              <div className="text-lg font-bold text-slate-700">Aucun dossier ne correspond.</div>
              <div className="text-sm text-slate-600 mt-1">Essayez une partie du nom, ou le n° d'acte seul.</div>
            </div>
          ) : (
            <div key={`res-${tour}`}>
              <p className="text-sm font-semibold text-slate-600 mb-2">
                {resultats.length >= 300 ? 'Les 300 plus récents' : `${resultats.length} dossier${resultats.length > 1 ? 's' : ''} trouvé${resultats.length > 1 ? 's' : ''}`}
              </p>
              {resultats[0]?.approche && (
                <p className="mb-2 border-l-4 border-amber-500 bg-amber-50/70 rounded-r-md px-3 py-2 text-sm text-amber-900">
                  Aucun nom écrit exactement ainsi. Voici les noms <strong>proches</strong> : vérifiez qu'il s'agit bien de la même entreprise.
                </p>
              )}
              <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                {resultats.map((d, i) => (
                  <li key={d.id} className="animate-fade-in px-4 py-3.5 md:px-5"
                    style={{ '--delai': `${Math.min(i, 8) * 0.05}s` }}>
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="min-w-0 flex-1 basis-60">
                        <div className="text-base md:text-lg font-semibold text-slate-900 leading-tight">{d.denomination || '—'}</div>
                        <div className="mt-0.5 text-sm text-slate-500">
                          {[d.num_actes && `Acte ${d.num_actes}`, d.type_garantie, d.agent && `agent ${d.agent}`, montantLisible(d.montant)].filter(Boolean).join(' · ')}
                        </div>
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
                          <dt className="text-slate-500">Semaine</dt>
                          <dd className="font-semibold text-slate-900">{jourLong(d.semaine)} au {jourLong(d.au || finSemaine(d.semaine))} {d.semaine.slice(0, 4)}</dd>
                          <dt className="text-slate-500">Point du</dt>
                          <dd className="font-semibold text-slate-900">{jourLong(d.date_point)} {d.date_point.slice(0, 4)}</dd>
                          <dt className="text-slate-500">Lettre</dt>
                          <dd className="font-semibold text-slate-900">{d.lettre || 'non renseignée'}</dd>
                          <dt className="text-slate-500">Armoire</dt>
                          <dd>{d.armoire ? (
                            <button type="button" onClick={() => voirArmoire(d.armoire, d.semaine)} title="Voir l'armoire en 3D"
                              className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-700">
                              {d.armoire}
                            </button>
                          ) : <span className="text-slate-500">non renseignée</span>}</dd>
                        </dl>
                      </div>
                      {ETIQUETTES && <button type="button" onClick={() => setEtiquettes({ dossiers: [d], titre: d.denomination })}
                        className="self-center p-2.5 rounded-xl border border-slate-300 text-slate-800 hover:bg-slate-50" title="Imprimer l'étiquette" aria-label="Imprimer l'étiquette">
                        <Tag size={17} />
                      </button>}
                      <button type="button" onClick={() => ouvrirSemaine(d)}
                        className="self-center px-3 py-2 rounded-md border border-slate-300 text-slate-800 text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-slate-50">
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
      {etiquettes && (
        <ModaleEtiquettes dossiers={etiquettes.dossiers} titre={etiquettes.titre} onClose={() => setEtiquettes(null)}
          onImprimer={(format) => { setImpression({ dossiers: etiquettes.dossiers, format }); setEtiquettes(null); }} />
      )}
      {impression && <ImpressionEtiquettes dossiers={impression.dossiers} format={impression.format} onFini={() => setImpression(null)} />}
      {detail && onglet === 'semaines' && !impression && createPortal(
        <div className="portail-impression"><BordereauImprime detail={detail} groupes={groupes} /></div>,
        document.body,
      )}
    </div>
  );
};

export default EntreesAfgc;
