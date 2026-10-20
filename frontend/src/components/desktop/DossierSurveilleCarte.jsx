import React, { useCallback, useEffect, useState } from 'react';
import { FolderInput, FolderOpen, ScanLine, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from '../Toast';

const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Réglages du dossier surveillé, sur la page « À indexer » de l'application de
 * bureau. Le vocabulaire est celui des GED du marché (dossier de dépôt,
 * « hot folder ») : l'utilisateur qui vient d'Alfresco ou de M-Files retrouve
 * le geste — il désigne la sortie de son scanner, et les scans arrivent ici.
 *
 * Les réglages sont ceux du POSTE (fichier local de l'application), pas de
 * l'organisation : chaque poste a son scanner et son chemin.
 *
 * @param {Array} props.dossiers  dossiers GED (liste plate de getFolders)
 */
const DossierSurveilleCarte = ({ dossiers = [] }) => {
  const api = window.desktopApp?.dossierSurveille;
  const [config, setConfig] = useState(null);
  const [etat, setEtat] = useState(null);

  const recharger = useCallback(async () => {
    if (!api) return;
    const c = await api.config();
    setConfig(c);
    setEtat(c.etat);
  }, [api]);

  useEffect(() => {
    recharger();
    return api?.surEtat(setEtat);
  }, [api, recharger]);

  if (!api || !config) return null;

  const enregistrer = async (modif) => {
    const r = await api.enregistrer(modif);
    if (!r.ok) { toast.error(r.message); return; }
    await recharger();
  };

  const choisir = async () => {
    const chemin = await api.choisir();
    if (chemin) await enregistrer({ dossier: chemin, actif: true });
  };

  const actif = config.actif && config.dossier;
  const erreurs = etat?.erreurs || [];

  return (
    <section className="glass-card-premium p-4 mb-6" data-tour="dossier-surveille" aria-labelledby="titre-dossier-surveille">
      <div className="flex flex-wrap items-start gap-4">
        <div className={`p-2.5 rounded-xl ${actif ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
          <ScanLine size={22} />
        </div>
        <div className="flex-1 min-w-[240px]">
          <h2 id="titre-dossier-surveille" className="font-semibold text-slate-800">
            Dossier surveillé <span className="font-normal text-slate-500">— dépôt des scans</span>
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {config.dossier
              ? 'Chaque fichier déposé dans ce dossier arrive ici, à indexer. L\'original est rangé dans « _Importés DocuFlow », jamais supprimé.'
              : 'Désignez le dossier où votre scanner enregistre : chaque scan arrivera ici, prêt à indexer.'}
          </p>
          {config.dossier && (
            <p className="mt-2 text-sm font-mono text-slate-700 break-all" title={config.dossier}>{config.dossier}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {config.dossier && (
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-600"
                checked={Boolean(config.actif)}
                onChange={(e) => enregistrer({ actif: e.target.checked })}
              />
              {config.actif ? 'Surveillance active' : 'Surveillance en pause'}
            </label>
          )}
          <button type="button" className={config.dossier ? 'btn btn-secondary' : 'btn btn-primary'} onClick={choisir}>
            <FolderInput size={16} /> {config.dossier ? 'Changer…' : 'Choisir le dossier…'}
          </button>
          {config.dossier && (
            <button type="button" className="btn btn-secondary" onClick={() => api.ouvrir()} title="Ouvrir dans l'explorateur">
              <FolderOpen size={16} /> Ouvrir
            </button>
          )}
        </div>
      </div>

      {config.dossier && (
        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <label className="inline-flex items-center gap-2 text-slate-600">
            Classer dans
            <select
              className="input-premium w-auto max-w-64 py-1.5"
              value={config.dossierGedId || ''}
              onChange={(e) => enregistrer({ dossierGedId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Non classé</option>
              {dossiers.map((f) => <option key={f.id} value={f.id}>{f.path || f.name}</option>)}
            </select>
          </label>
          {actif && etat && (
            <span className="inline-flex items-center gap-1.5 text-slate-600">
              <CheckCircle2 size={15} className="text-emerald-500" />
              {etat.importesAujourdhui || 0} importé{etat.importesAujourdhui > 1 ? 's' : ''} aujourd'hui
              {etat.dernierImport && <span className="text-slate-400">· dernier : {etat.dernierImport.nom} à {heure(etat.dernierImport.le)}</span>}
              {etat.enAttente > 0 && <span className="text-slate-400">· {etat.enAttente} en cours de lecture</span>}
            </span>
          )}
        </div>
      )}

      {actif && erreurs.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-amber-700">
          {erreurs.slice(0, 3).map((e) => (
            <li key={`${e.le}-${e.nom}`} className="flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{e.nom ? <strong>{e.nom}</strong> : null}{e.nom ? ' — ' : ''}{e.message} <span className="text-amber-500">({heure(e.le)})</span></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default DossierSurveilleCarte;
