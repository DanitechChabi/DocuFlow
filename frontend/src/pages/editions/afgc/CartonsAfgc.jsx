import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Boxes, Search, Upload, Loader2, Trash2, ArrowLeft } from 'lucide-react';
import api from '../../../services/api';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { lireClasseur } from '../../../utils/classeur';
import { EnTete, Chargement } from './elements';
import { lireCartons, FONDS } from './cartonsExcel';

// ============================================================================
// Dossiers en cartons (057) : dossiers non retirés / annulés et ouvertures de
// compte, rangés par carton. Une recherche (nom, n° d'acte, matricule), la
// liste des cartons de chaque fonds, l'import de leurs classeurs.
// ============================================================================

const PAR_ENVOI = 3000;
const STATUT = { non_retire: 'Non retiré / annulé', annule: 'Annulé' };

const Ligne = ({ d }) => (
  <li className="px-4 py-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
    <span className="font-semibold text-slate-900 min-w-0 flex-1 basis-56">{d.denomination || '—'}</span>
    <span className="text-sm text-slate-600">
      {d.fonds === 'ouverture_compte'
        ? [d.matricule && `N° ${d.matricule}`, d.note].filter(Boolean).join(' · ')
        : [d.num_actes && `Acte ${d.num_actes}`, d.typologie, d.annee, STATUT[d.statut]].filter(Boolean).join(' · ')}
    </span>
    <span className="text-sm font-semibold text-slate-900">{d.carton ? `Carton ${d.carton.replace(/^Carton /, '')}` : 'Sans carton'}</span>
  </li>
);

const CartonsAfgc = () => {
  useTitrePage('Dossiers en cartons');
  const [fonds, setFonds] = useState('non_retires');
  const [liste, setListe] = useState(null);
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState(null);
  const [titre, setTitre] = useState('');
  const [cherche, setCherche] = useState(false);
  const [classeurs, setClasseurs] = useState([]);
  const [import_, setImport] = useState(null); // { nom, fonds, lignes } en attente, ou { envoi: n }
  const [plan, setPlan] = useState(null);
  useEffect(() => { api.get('/plan-classement').then((r) => setPlan(r.data)).catch(() => setPlan(null)); }, []);
  const rubrique = plan?.rubriques.find((r) => r.cote === plan.fonds?.[fonds]);
  const fichier = useRef(null);

  const charger = useCallback(() => {
    setListe(null);
    api.get(`/cartons/liste/${fonds}`).then((r) => setListe(r.data)).catch(() => setListe({ cartons: [], totaux: {} }));
    api.get('/cartons/fichiers').then((r) => setClasseurs(r.data)).catch(() => setClasseurs([]));
  }, [fonds]);
  useEffect(() => { charger(); }, [charger]);

  const rechercher = async (params, libelle) => {
    setCherche(true);
    try {
      const r = await api.get('/cartons/recherche', { params });
      setResultats(r.data);
      setTitre(libelle);
    } catch (e) { toast.error(e.response?.data?.message || 'Recherche impossible.'); } finally { setCherche(false); }
  };

  const choisir = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const c = await lireClasseur(f);
      const lu = lireCartons(c);
      if (!lu.fonds || !lu.lignes.length) { toast.error('Classeur non reconnu : ni dossiers non retirés, ni ouvertures de compte.'); return; }
      setImport({ nom: f.name, ...lu });
    } catch { toast.error('Lecture du classeur impossible.'); }
  };

  const importer = async () => {
    const { nom, fonds: f, lignes } = import_;
    const total = { ajoutees: 0, deja: 0 };
    try {
      for (let i = 0; i < lignes.length; i += PAR_ENVOI) {
        setImport((x) => ({ ...x, envoi: Math.min(i + PAR_ENVOI, lignes.length) }));
        const r = await api.post('/cartons/import', { fonds: f, fichier: nom, lignes: lignes.slice(i, i + PAR_ENVOI) });
        total.ajoutees += r.data.ajoutees;
        total.deja += r.data.deja;
      }
      toast.success(`${total.ajoutees} dossier${total.ajoutees > 1 ? 's' : ''} ajouté${total.ajoutees > 1 ? 's' : ''}${total.deja ? ` (${total.deja} déjà là)` : ''}.`);
      setImport(null);
      setFonds(f);
      charger();
    } catch (e) { toast.error(e.response?.data?.message || 'Import interrompu.'); setImport((x) => ({ ...x, envoi: null })); }
  };

  const supprimer = async (c) => {
    if (!window.confirm(`Supprimer les ${c.lignes} lignes du classeur « ${c.fichier || 'sans nom'} » ?`)) return;
    try {
      await api.delete('/cartons/fichiers', { data: { fichier: c.fichier, fonds: c.fonds } });
      toast.success('Classeur supprimé.');
      charger();
    } catch (e) { toast.error(e.response?.data?.message || 'Suppression impossible.'); }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <EnTete titre="Dossiers en cartons" icone={Boxes}
        aide="Les dossiers non retirés ou annulés, et les répertoires d'ouverture de compte, rangés par carton. Les points des dossiers retirés restent dans « Entrée des dossiers ».">
        <button type="button" onClick={() => fichier.current?.click()}
          className="px-4 py-2.5 rounded-md bg-slate-800 text-white text-sm font-semibold inline-flex items-center gap-2">
          <Upload size={16} /> Importer un classeur
        </button>
        <input ref={fichier} type="file" accept=".xlsx,.xls,.ods" className="hidden" onChange={choisir} />
      </EnTete>

      {import_ && (
        <div className="mb-6 rounded-lg border border-slate-300 bg-white p-4">
          <p className="text-sm text-slate-800">
            « <strong>{import_.nom}</strong> » : <strong>{import_.lignes.length}</strong> lignes de <strong>{FONDS[import_.fonds]}</strong>,
            {' '}{new Set(import_.lignes.map((l) => l.carton).filter(Boolean)).size} cartons.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={importer} disabled={Boolean(import_.envoi)}
              className="px-4 py-2 rounded-md bg-[#2C9C0A] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
              {import_.envoi ? <><Loader2 size={15} className="animate-spin" /> {import_.envoi} / {import_.lignes.length}</> : 'Importer'}
            </button>
            <button type="button" onClick={() => setImport(null)} disabled={Boolean(import_.envoi)} className="px-4 py-2 rounded-md text-sm text-slate-600 hover:bg-slate-100">Annuler</button>
          </div>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) rechercher({ q: q.trim() }, `Résultats pour « ${q.trim()} »`); }} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom du client, n° d'acte ou matricule"
            className="w-full pl-10 pr-3 py-2.5 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-slate-500" />
        </div>
        <button type="submit" disabled={cherche} className="px-4 py-2.5 rounded-md bg-slate-800 text-white text-sm font-semibold inline-flex items-center gap-2">
          {cherche ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Rechercher
        </button>
      </form>

      {resultats ? (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3">
            <button type="button" onClick={() => setResultats(null)} className="p-1 rounded hover:bg-slate-100" aria-label="Retour"><ArrowLeft size={16} /></button>
            <h2 className="text-sm font-semibold text-slate-900">{titre} · {resultats.length}{resultats.length >= 300 ? ' (les 300 premiers)' : ''}</h2>
          </div>
          {resultats.length ? <ul className="divide-y divide-slate-100">{resultats.map((d) => <Ligne key={d.id} d={d} />)}</ul>
            : <p className="px-4 py-6 text-sm text-slate-500">Aucun dossier en carton ne correspond.</p>}
        </section>
      ) : (
        <>
          <div className="flex gap-1 mb-4 border-b border-slate-200">
            {Object.entries(FONDS).map(([cle, libelle]) => (
              <button key={cle} type="button" onClick={() => setFonds(cle)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${fonds === cle ? 'border-slate-800 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {libelle}{liste?.totaux?.[cle] ? ` (${liste.totaux[cle]})` : ''}
              </button>
            ))}
          </div>
          {rubrique && (
            <p className="mb-3 text-xs text-slate-600">
              Plan de classement : <strong className="text-slate-800">{rubrique.cote} — {rubrique.intitule}</strong>
              {rubrique.regle ? ` · conservation : ${rubrique.regle}` : ''}
            </p>
          )}
          {!liste ? <Chargement /> : liste.cartons.length === 0 ? (
            <p className="text-sm text-slate-500 py-6">Aucun classeur importé pour ce fonds. Cliquez sur « Importer un classeur ».</p>
          ) : (
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
              {liste.cartons.map((c) => (
                <button key={c.carton || 'sans'} type="button"
                  onClick={() => (c.carton ? rechercher({ fonds, carton: c.carton }, `Carton ${String(c.carton).replace(/^Carton /, '')}`) : rechercher({ fonds, q: '' }, 'Sans carton'))}
                  disabled={!c.carton}
                  className="text-left rounded-md border border-slate-200 bg-white px-3 py-2 hover:border-slate-500 disabled:opacity-60">
                  <div className="text-sm font-semibold text-slate-900">{c.carton ? `Carton ${String(c.carton).replace(/^Carton /, '')}` : 'Sans carton'}</div>
                  <div className="text-xs text-slate-500">{c.dossiers} dossier{c.dossiers > 1 ? 's' : ''}{c.de ? ` · ${c.de === c.a ? c.de : `${c.de}–${c.a}`}` : ''}</div>
                </button>
              ))}
            </div>
          )}
          {classeurs.length > 0 && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold text-slate-900 mb-2">Classeurs importés</h2>
              <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                {classeurs.map((c) => (
                  <li key={`${c.fonds}-${c.fichier}`} className="px-4 py-2 flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{c.fichier || 'Sans nom'}</span>
                    <span className="text-slate-500">{c.libelle_fonds} · {c.lignes} lignes · {c.cartons} cartons · {c.importe_le}</span>
                    <button type="button" onClick={() => supprimer(c)} className="p-1.5 rounded text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label="Supprimer"><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default CartonsAfgc;
