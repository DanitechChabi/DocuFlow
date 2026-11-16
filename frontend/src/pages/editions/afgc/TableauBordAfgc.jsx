import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, Printer, FileSpreadsheet, AlertTriangle, Loader2, Inbox, Send, Timer, MessageSquareWarning, PackageOpen } from 'lucide-react';
import { entreeService } from '../../../services/entreeService';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, Chargement } from './elements';
import { dateCourte, references } from './vocabulaire';
import { exporterClasseur, nomFichier, dateExcel } from './exportExcel';

// ============================================================================
// Tableau de bord des archives, pour la direction : sur une période, les
// demandes (reçues, servies, délai), par département et par motif, les
// dossiers entrés semaine par semaine ; à l'instant, les retards et le
// contenu des armoires. Imprimable et exportable (Excel).
// Une couleur par graphique (une seule série) : pas de légende, le titre dit
// ce qui est tracé ; chaque barre donne sa valeur au survol.
// ============================================================================

const iso = (d) => d.toISOString().slice(0, 10);
const PERIODES = [
  ['mois', 'Ce mois', () => { const n = new Date(); return [iso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), 1))), iso(n)]; }],
  ['mois-1', 'Mois dernier', () => { const n = new Date(); return [iso(new Date(Date.UTC(n.getFullYear(), n.getMonth() - 1, 1))), iso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), 0)))]; }],
  ['annee', 'Cette année', () => { const n = new Date(); return [`${n.getFullYear()}-01-01`, iso(n)]; }],
  ['12m', '12 derniers mois', () => { const n = new Date(); const d = new Date(n); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 1); return [iso(d), iso(n)]; }],
];

const nombre = (n) => (Number(n) || 0).toLocaleString('fr-FR');
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '—');
/** 0.5 → « 30 min », 5 → « 5 h », 50 → « 2,1 j » */
const duree = (h) => {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`.replace('.', ',');
  return `${(Math.round((h / 24) * 10) / 10).toString().replace('.', ',')} j`;
};
const semaineCourte = (s) => {
  const [a, m, j] = s.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j)).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};

const Tuile = ({ icone: Icone, titre, valeur, detail, ton = 'neutre' }) => (
  <div className={`rounded-2xl border-2 p-4 bg-white ${ton === 'alerte' ? 'border-red-200' : 'border-slate-200'}`}>
    <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
      <Icone size={16} className={ton === 'alerte' ? 'text-red-600' : 'text-slate-500'} /> {titre}
    </div>
    <div className={`mt-1 text-3xl font-black tracking-tight ${ton === 'alerte' ? 'text-red-700' : 'text-slate-900'}`}>{valeur}</div>
    {detail && <div className="mt-0.5 text-sm font-semibold text-slate-600">{detail}</div>}
  </div>
);

/** Barres horizontales classées : nom, barre (une couleur), valeur. */
const Barres = ({ titre, sousTitre, donnees, couleur = '#16a34a', vide = 'Rien sur la période.' }) => {
  const max = Math.max(1, ...donnees.map((d) => d.n));
  return (
    <section className="glass-card-premium rounded-3xl p-5 md:p-6 break-inside-avoid">
      <h2 className="text-base font-black text-slate-900">{titre}</h2>
      {sousTitre && <p className="text-sm text-slate-600 mb-3">{sousTitre}</p>}
      {donnees.length ? (
        <ul className="space-y-2.5 mt-3">
          {donnees.map((d) => (
            <li key={d.nom} className="grid grid-cols-[minmax(0,11rem)_1fr_3rem] items-center gap-3" title={`${d.nom} : ${nombre(d.n)}`}>
              <span className="text-sm font-semibold text-slate-800 truncate">{d.nom}</span>
              <span className="h-3.5 rounded-r bg-slate-100 overflow-hidden">
                <span className="block h-full rounded-r" style={{ width: `${(d.n / max) * 100}%`, background: couleur, minWidth: d.n ? 4 : 0 }} />
              </span>
              <span className="text-sm font-black text-slate-900 text-right tabular-nums">{nombre(d.n)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-500 mt-3">{vide}</p>}
    </section>
  );
};

/** Colonnes par semaine de production, valeur au survol. */
const Colonnes = ({ titre, sousTitre, donnees, couleur = '#16a34a' }) => {
  const [survol, setSurvol] = useState(null);
  const max = Math.max(1, ...donnees.map((d) => d.n));
  const pas = Math.max(1, Math.ceil(donnees.length / 8));
  return (
    <section className="glass-card-premium rounded-3xl p-5 md:p-6 break-inside-avoid">
      <div className="flex items-baseline gap-3">
        <h2 className="text-base font-black text-slate-900">{titre}</h2>
        <span className="ml-auto text-sm font-bold text-slate-700 tabular-nums min-h-[1.25rem]">
          {survol !== null && donnees[survol] ? `semaine du ${semaineCourte(donnees[survol].semaine)} : ${nombre(donnees[survol].n)}` : ''}
        </span>
      </div>
      {sousTitre && <p className="text-sm text-slate-600">{sousTitre}</p>}
      {donnees.length ? (
        <div className="mt-4">
          <div className="flex items-end gap-[2px] h-40 border-b border-slate-200" onMouseLeave={() => setSurvol(null)}>
            {donnees.map((d, i) => (
              <div key={d.semaine} className="flex-1 h-full flex items-end justify-center cursor-default" onMouseEnter={() => setSurvol(i)}
                title={`Semaine du ${semaineCourte(d.semaine)} : ${nombre(d.n)}`}>
                <div className="w-full max-w-[24px] rounded-t transition-opacity" style={{ height: `${(d.n / max) * 100}%`, minHeight: d.n ? 2 : 0, background: couleur, opacity: survol === null || survol === i ? 1 : 0.45 }} />
              </div>
            ))}
          </div>
          <div className="flex gap-[2px] mt-1">
            {donnees.map((d, i) => (
              <div key={d.semaine} className="flex-1 text-center text-[11px] font-semibold text-slate-500 whitespace-nowrap overflow-visible">
                {i % pas === 0 ? semaineCourte(d.semaine) : ''}
              </div>
            ))}
          </div>
        </div>
      ) : <p className="text-sm text-slate-500 mt-3">Rien sur la période.</p>}
    </section>
  );
};

const Contenu = ({ t }) => {
  const dm = t.demandes;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <Tuile icone={Inbox} titre="Demandes reçues" valeur={nombre(dm.recues)} detail={`${nombre(dm.en_attente)} en attente · ${nombre(dm.annulees)} annulée${dm.annulees > 1 ? 's' : ''}`} />
        <Tuile icone={Send} titre="Dossiers servis" valeur={nombre(dm.servies)} detail={`${pct(dm.servies, dm.recues)} des demandes`} />
        <Tuile icone={Timer} titre="Délai médian de sortie" valeur={duree(t.delai.mediane_h)} detail={t.delai.n ? `moyenne ${duree(t.delai.moyenne_h)} · ${pct(t.delai.en_24h, t.delai.n)} en moins de 24 h` : 'aucune sortie sur la période'} />
        <Tuile icone={MessageSquareWarning} titre="Compléments demandés" valeur={nombre(dm.complements)} detail={`${pct(dm.complements, dm.recues)} des demandes`} />
        <Tuile icone={AlertTriangle} titre="Dossiers en retard" valeur={nombre(t.retards.length)} detail="à l'instant, chez les agents" ton={t.retards.length ? 'alerte' : 'neutre'} />
        <Tuile icone={PackageOpen} titre="Dossiers entrés" valeur={nombre(t.entrees_total)} detail="aux archives, sur la période" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Barres titre="Demandes par département" donnees={t.departements} />
        <Barres titre="Demandes par motif" donnees={t.motifs} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Colonnes titre="Demandes par semaine" sousTitre="Semaines de production, du vendredi au jeudi." donnees={t.demandes_par_semaine} />
        <Colonnes titre="Dossiers entrés par semaine" sousTitre="D'après les points des dossiers retirés." donnees={t.entrees_par_semaine} couleur="#7c3aed" />
      </div>
      <section className="glass-card-premium rounded-3xl p-5 md:p-6 break-inside-avoid">
        <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
          <AlertTriangle size={17} className={t.retards.length ? 'text-red-600' : 'text-slate-400'} /> Dossiers en retard
          <span className="text-slate-500 font-bold">({t.retards.length})</span>
        </h2>
        {t.retards.length ? (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-600 border-b border-slate-200">
                <th className="py-2 pr-3 font-bold">Dossier</th><th className="py-2 pr-3 font-bold">Chez</th><th className="py-2 pr-3 font-bold">Département</th>
                <th className="py-2 pr-3 font-bold">Sorti le</th><th className="py-2 pr-3 font-bold">Retour prévu</th><th className="py-2 font-bold text-right">Retard</th>
              </tr></thead>
              <tbody>
                {t.retards.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3"><div className="font-bold text-slate-900">{r.nom_entreprise || r.description || '—'}</div><div className="text-xs text-slate-600">{references(r)}</div></td>
                    <td className="py-2 pr-3 font-semibold text-slate-800">{r.emprunteur}</td>
                    <td className="py-2 pr-3 text-slate-700">{r.departement}</td>
                    <td className="py-2 pr-3 text-slate-700">{dateCourte(r.sorti_le)}</td>
                    <td className="py-2 pr-3 text-slate-700">{dateCourte(r.retour_prevu)}</td>
                    <td className="py-2 text-right"><span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 px-2.5 py-0.5 font-black"><AlertTriangle size={12} /> {r.jours_retard} j</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-slate-600 mt-2">Aucun dossier en retard.</p>}
      </section>
      {t.armoires.length > 0 && (
        <Barres titre="Dossiers par armoire" sousTitre="Contenu de chaque armoire, d'après le plan de rangement (toutes périodes)."
          donnees={t.armoires.map((a) => ({ nom: a.nom, n: a.n }))} couleur="#7c3aed" />
      )}
    </div>
  );
};

const TableauBordAfgc = () => {
  useTitrePage('Tableau de bord');
  const [choix, setChoix] = useState('mois');
  const [bornes, setBornes] = useState(() => PERIODES[0][2]());
  const [t, setT] = useState(null);
  const [cours, setCours] = useState(false);

  const charger = useCallback(async ([du, au]) => {
    setCours(true);
    try { setT(await entreeService.tableauBord({ du, au })); } catch (e) { toast.error(e.response?.data?.message || 'Le tableau de bord n\'a pas pu être chargé.'); } finally { setCours(false); }
  }, []);
  useEffect(() => { charger(bornes); }, [bornes, charger]);

  const exporter = () => {
    if (!t) return;
    exporterClasseur(nomFichier('tableau-de-bord', t.periode.du, t.periode.au), [
      { nom: 'Synthèse', entetes: ['Indicateur', 'Valeur'], largeurs: [40, 18], lignes: [
        ['Période', `${dateCourte(t.periode.du)} – ${dateCourte(t.periode.au)}`],
        ['Demandes reçues', t.demandes.recues], ['Dossiers servis', t.demandes.servies], ['En attente', t.demandes.en_attente],
        ['Annulées', t.demandes.annulees], ['Compléments demandés', t.demandes.complements],
        ['Délai médian de sortie (heures)', t.delai.mediane_h ?? ''], ['Délai moyen de sortie (heures)', t.delai.moyenne_h ?? ''],
        ['Sorties en moins de 24 h', t.delai.en_24h], ['Dossiers en retard (à l\'instant)', t.retards.length], ['Dossiers entrés', t.entrees_total],
      ] },
      { nom: 'Par département', entetes: ['Département', 'Demandes'], largeurs: [40, 12], lignes: t.departements.map((d) => [d.nom, d.n]) },
      { nom: 'Par motif', entetes: ['Motif', 'Demandes'], largeurs: [40, 12], lignes: t.motifs.map((d) => [d.nom, d.n]) },
      { nom: 'Par semaine', entetes: ['Semaine du', 'Demandes'], largeurs: [14, 12], lignes: t.demandes_par_semaine.map((d) => [dateExcel(d.semaine), d.n]) },
      { nom: 'Entrées', entetes: ['Semaine du', 'Dossiers entrés'], largeurs: [14, 16], lignes: t.entrees_par_semaine.map((d) => [dateExcel(d.semaine), d.n]) },
      { nom: 'Retards', entetes: ['Dossier', 'Références', 'Chez', 'Département', 'Sorti le', 'Retour prévu', 'Jours de retard'], largeurs: [34, 30, 22, 26, 12, 12, 14],
        lignes: t.retards.map((r) => [r.nom_entreprise || r.description || '', references(r), r.emprunteur, r.departement, dateExcel(r.sorti_le), dateExcel(r.retour_prevu), r.jours_retard]) },
      { nom: 'Armoires', entetes: ['Armoire', 'Lieu', 'Dossiers'], largeurs: [16, 28, 12], lignes: t.armoires.map((a) => [a.nom, a.lieu || '', a.n]) },
    ]).catch(() => toast.error('L\'export Excel a échoué.'));
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <EnTete titre="Tableau de bord" icone={BarChart3} aide="L'activité des archives sur la période : demandes, délais, départements, entrées ; les retards et les armoires à l'instant.">
        <button type="button" onClick={() => window.print()} disabled={!t} className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 inline-flex items-center gap-2 hover:border-docuflow-secondary disabled:opacity-50">
          <Printer size={16} /> Imprimer
        </button>
        <button type="button" onClick={exporter} disabled={!t} className="px-4 py-2.5 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
          <FileSpreadsheet size={16} /> Excel
        </button>
      </EnTete>

      <div className="flex flex-wrap items-end gap-2 mb-5">
        <div className="inline-flex flex-wrap p-1 rounded-2xl bg-slate-100">
          {PERIODES.map(([cle, libelle, calc]) => (
            <button key={cle} type="button" onClick={() => { setChoix(cle); setBornes(calc()); }}
              className={`px-3.5 py-2 rounded-xl text-sm font-bold ${choix === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{libelle}</button>
          ))}
        </div>
        <label className="text-sm font-bold text-slate-700">Du
          <input type="date" value={bornes[0]} onChange={(e) => { setChoix('perso'); setBornes([e.target.value, bornes[1]]); }} className="ml-1.5 px-2.5 py-2 rounded-xl border border-slate-200 text-sm" />
        </label>
        <label className="text-sm font-bold text-slate-700">au
          <input type="date" value={bornes[1]} onChange={(e) => { setChoix('perso'); setBornes([bornes[0], e.target.value]); }} className="ml-1.5 px-2.5 py-2 rounded-xl border border-slate-200 text-sm" />
        </label>
        {cours && <Loader2 size={18} className="animate-spin text-slate-500 mb-2.5" />}
      </div>

      {t ? <Contenu t={t} /> : <Chargement />}

      {t && createPortal(
        <div className="portail-impression">
          <style>{'@media print { @page { size: A4 portrait; margin: 12mm; } .portail-impression .break-inside-avoid { break-inside: avoid; } .portail-impression .glass-card-premium { border: 1px solid #cbd5e1; border-radius: 12px; padding: 10px; margin-bottom: 8px; box-shadow: none; } }'}</style>
          <h1 style={{ fontSize: 18, fontWeight: 900, margin: '0 0 2px' }}>Archives — tableau de bord</h1>
          <p style={{ margin: '0 0 10px' }}>Période du {dateCourte(t.periode.du)} au {dateCourte(t.periode.au)} · édité le {new Date().toLocaleDateString('fr-FR')}</p>
          <Contenu t={t} />
        </div>,
        document.body,
      )}
    </div>
  );
};

export default TableauBordAfgc;

