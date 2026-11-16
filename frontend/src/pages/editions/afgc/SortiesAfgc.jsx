import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { BookOpenCheck, Search, Printer, FileSpreadsheet, Loader2 } from 'lucide-react';
import { listeService } from '../../../services/listeService';
import { authService } from '../../../services/authService';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { edition } from '../../../editions';
import { EnTete, ChoixCadre, Pastille, Chargement } from './elements';
import { intitule, references, dateCourte } from './vocabulaire';
import { exporterClasseur, dateExcel, nomFichier } from './exportExcel';

// ============================================================================
// Dossiers sortis : le registre des sorties et retours, que l'on interroge —
// tout ce qui est sorti pour les soldes créditeurs, la Liste 3, une
// entreprise, un agent, une période — puis que l'on imprime comme le registre
// papier ou que l'on exporte en Excel.
// ============================================================================

const ETATS = [
  ['', 'Tous'],
  ['en_cours', 'Transmis'],
  ['en_retard', 'En retard'],
  ['retourne', 'Retournés'],
];

const etatSortie = (p) => {
  if (p.etat === 'retourne') return { texte: 'Retourné', ton: 'gris' };
  if (p.etat === 'en_retard') return { texte: 'En retard', ton: 'rouge' };
  if (p.etat === 'signale') return { texte: 'Signalé', ton: 'ambre' };
  return { texte: 'Transmis', ton: 'vert' };
};

const observations = (p) => [p.observation_remise, p.signalement && `Signalé : ${p.signalement}`, p.observation_retour].filter(Boolean).join(' — ');

/** Le registre tel qu'il s'imprime : ordre chronologique des sorties, numéroté. */
const RegistreImprime = ({ lignes, criteres }) => (
  <div className="certificat">
    <div className="certificat-entete">
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        {edition?.embleme && <img src={edition.embleme} alt="" style={{ width: 46, height: 50, objectFit: 'contain' }} />}
        <div>
          <div className="certificat-surtitre">{edition?.nomLong || 'Archives'} — Archives</div>
          <h1>Registre des sorties et retours de dossiers</h1>
          <div className="certificat-numero">{criteres}</div>
        </div>
      </div>
      <div className="discret" style={{ textAlign: 'right' }}>
        Édité le {new Date().toLocaleDateString('fr-FR')}<br />
        {lignes.length} sortie{lignes.length > 1 ? 's' : ''}
      </div>
    </div>
    <table style={{ marginTop: 14 }}>
      <thead>
        <tr>
          <th>N°</th><th>Sortie le</th><th>Entreprise</th><th>N° dossier</th><th>N° acte</th><th>Cadre / liste</th>
          <th>Transmis à</th><th>Retour prévu</th><th>Retourné le</th><th>Observations</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((p, i) => (
          <tr key={p.id}>
            <td>{i + 1}</td>
            <td>{dateCourte(p.remis_at)}</td>
            <td>{p.nom_entreprise || p.description || '—'}</td>
            <td>{p.num_dossier || ''}</td>
            <td>{p.num_acte || ''}</td>
            <td>{[p.cadre, p.liste_libelle].filter(Boolean).join(' · ')}</td>
            <td>{p.emprunteur_name || ''}</td>
            <td>{dateCourte(p.date_retour_prevue)}</td>
            <td>{p.retourne_at ? dateCourte(p.retourne_at) : ''}</td>
            <td>{observations(p)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const SortiesAfgc = () => {
  useTitrePage('Dossiers sortis');
  const [cadres, setCadres] = useState([]);
  const [listes, setListes] = useState([]);
  const [filtres, setFiltres] = useState({ etat: '', cadre: '', liste: '', q: '', du: '', au: '' });
  const [saisie, setSaisie] = useState('');
  const [sorties, setSorties] = useState(null);
  const [export_, setExport] = useState(false);

  useEffect(() => {
    listeService.cadres().then(setCadres).catch(() => setCadres([]));
    listeService.lister().then(setListes).catch(() => setListes([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setFiltres((f) => (f.q === saisie.trim() ? f : { ...f, q: saisie.trim() })), 300);
    return () => clearTimeout(t);
  }, [saisie]);

  useEffect(() => {
    setSorties(null);
    const params = Object.fromEntries(Object.entries(filtres).filter(([, v]) => v !== ''));
    listeService.sorties(params).then((l) => setSorties(Array.isArray(l) ? l : [])).catch((e) => {
      setSorties([]);
      if (e.response?.status === 400) toast.error(e.response.data?.message || 'Critères invalides.');
    });
  }, [filtres]);

  const changer = (cle, valeur) => setFiltres((f) => ({ ...f, [cle]: valeur }));
  const listesDuCadre = listes.filter((l) => !filtres.cadre || l.cadre === filtres.cadre);

  // Pour le papier et l'Excel : l'ordre du registre, chronologique.
  const chronologique = useMemo(() => [...(sorties || [])].sort((a, b) => new Date(a.remis_at) - new Date(b.remis_at)), [sorties]);
  const periode = filtres.du && filtres.au ? `Du ${dateCourte(filtres.du)} au ${dateCourte(filtres.au)}`
    : filtres.du ? `Depuis le ${dateCourte(filtres.du)}`
      : filtres.au ? `Jusqu'au ${dateCourte(filtres.au)}` : 'Toutes périodes';
  const criteres = [
    periode,
    filtres.cadre || 'tous les cadres',
    filtres.liste ? (listes.find((l) => String(l.id) === String(filtres.liste))?.libelle || 'liste') : null,
    filtres.etat ? ETATS.find(([k]) => k === filtres.etat)?.[1].toLowerCase() : null,
    filtres.q ? `recherche « ${filtres.q} »` : null,
  ].filter(Boolean).join(' · ');

  const exporter = async () => {
    setExport(true);
    try {
      const user = authService.getCurrentUser();
      await exporterClasseur(nomFichier('sorties', filtres.cadre, filtres.du, filtres.au || new Date().toISOString().slice(0, 10)), [{
        nom: 'Sorties et retours',
        entetes: ['N°', 'Sortie le', 'Entreprise', 'N° de dossier', 'N° d\'acte', 'Année', 'Cadre', 'Liste', 'Transmis à', 'Transmis par', 'Retour prévu', 'Retourné le', 'État', 'Observations'],
        largeurs: [6, 12, 34, 14, 16, 7, 22, 14, 22, 22, 12, 12, 11, 40],
        lignes: chronologique.map((p, i) => [
          i + 1, dateExcel(p.remis_at), p.nom_entreprise || p.description || '', p.num_dossier || '', p.num_acte || '', p.annee || '',
          p.cadre || '', p.liste_libelle || '', p.emprunteur_name || '', p.remis_par_name || '',
          dateExcel(p.date_retour_prevue), dateExcel(p.retourne_at), etatSortie(p).texte, observations(p),
        ]),
      }, {
        nom: 'Critères',
        entetes: ['Registre des sorties et retours de dossiers', ''],
        largeurs: [24, 70],
        lignes: [['Critères', criteres], ['Édité le', dateExcel(new Date().toISOString())], ['Par', user?.full_name || ''], ['Sorties', chronologique.length]],
      }]);
    } catch {
      toast.error('L\'export Excel a échoué.');
    } finally {
      setExport(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <EnTete titre="Dossiers sortis" icone={BookOpenCheck} aide="Qui a quel dossier, depuis quand, dans quel cadre et pour quand il doit revenir.">
        <button type="button" onClick={() => window.print()} disabled={!sorties?.length}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:border-docuflow-secondary hover:text-docuflow-secondary disabled:opacity-40">
          <Printer size={16} /> Imprimer
        </button>
        <button type="button" onClick={exporter} disabled={!sorties?.length || export_}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-docuflow-secondary text-white text-sm font-bold disabled:opacity-40">
          {export_ ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} Exporter (Excel)
        </button>
      </EnTete>

      <div className="glass-card-premium rounded-3xl p-5 space-y-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex p-1 rounded-2xl bg-slate-100">
            {ETATS.map(([cle, label]) => (
              <button key={cle || 'tous'} type="button" onClick={() => changer('etat', cle)}
                className={`px-3.5 py-1.5 rounded-xl text-sm font-bold transition-colors ${filtres.etat === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
          <select value={filtres.liste} onChange={(e) => changer('liste', e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white text-slate-700" aria-label="Liste">
            <option value="">Toutes les listes</option>
            {listesDuCadre.map((l) => <option key={l.id} value={l.id}>{l.libelle} — {l.cadre}</option>)}
          </select>
          <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">Du
            <input type="date" value={filtres.du} onChange={(e) => changer('du', e.target.value)} className="px-2.5 py-2 rounded-xl border border-slate-200 text-sm text-slate-700" />
          </label>
          <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">Au
            <input type="date" value={filtres.au} onChange={(e) => changer('au', e.target.value)} className="px-2.5 py-2 rounded-xl border border-slate-200 text-sm text-slate-700" />
          </label>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={saisie} onChange={(e) => setSaisie(e.target.value)} placeholder="Entreprise, n° de dossier, n° d'acte, agent…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-docuflow-secondary" aria-label="Rechercher" />
          </div>
        </div>
        {cadres.length > 1 && <ChoixCadre cadres={cadres} valeur={filtres.cadre} onChange={(v) => setFiltres((f) => ({ ...f, cadre: v, liste: '' }))} tous />}
      </div>

      {sorties === null ? <Chargement /> : (
        <div className="glass-card-premium rounded-3xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 text-sm font-bold text-slate-500">
            {sorties.length} sortie{sorties.length > 1 ? 's' : ''}
            {sorties.length === 1000 && ' (les 1 000 plus récentes)'}
          </div>
          {sorties.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="px-5 py-2.5 font-black">Dossier</th>
                    <th className="px-3 py-2.5 font-black">Cadre</th>
                    <th className="px-3 py-2.5 font-black">Transmis à</th>
                    <th className="px-3 py-2.5 font-black">Le</th>
                    <th className="px-3 py-2.5 font-black">Retour prévu</th>
                    <th className="px-3 py-2.5 font-black">Retourné le</th>
                    <th className="px-5 py-2.5 font-black">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorties.map((p) => {
                    const e = etatSortie(p);
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3 max-w-[320px]">
                          <div className="font-semibold text-slate-800 truncate">{intitule(p)}</div>
                          <div className="text-xs text-slate-400 truncate">{references(p) || 'Sans référence'}</div>
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {p.cadre || '—'}
                          {p.liste_libelle && <div className="text-xs text-slate-400">{p.liste_libelle}</div>}
                        </td>
                        <td className="px-3 py-3 text-slate-600">{p.emprunteur_name || '—'}</td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{dateCourte(p.remis_at)}</td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{dateCourte(p.date_retour_prevue)}</td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{p.retourne_at ? dateCourte(p.retourne_at) : '—'}</td>
                        <td className="px-5 py-3"><Pastille ton={e.ton}>{e.texte}</Pastille></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="px-5 py-8 text-center text-sm text-slate-400">Aucune sortie pour ces critères.</p>}
        </div>
      )}

      {sorties?.length > 0 && createPortal(
        <div className="portail-impression"><RegistreImprime lignes={chronologique} criteres={criteres} /></div>,
        document.body
      )}
    </div>
  );
};

export default SortiesAfgc;
