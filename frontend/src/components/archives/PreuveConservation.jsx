import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Download, Loader2, RefreshCw, FileCheck2, FileWarning, HardDrive, FolderOpen, Play } from 'lucide-react';
import {
  archivageService, OBJETS_HORODATES, RISQUES_FORMAT, taille,
} from '../../services/archivageService';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../Toast';

/**
 * Preuve et pérennité (migration 037) :
 *   - HorodatagesPanel  jetons RFC 3161 des sceaux, PV et versements
 *                       (Code du numérique, art. 299-300) ;
 *   - OngletFormats     formats des fichiers conservés, copies PDF/A (art. 302) ;
 *   - SauvegardePanel   sauvegarde intégrée de l'application de bureau.
 */
const dateHeure = (v) => (v ? new Date(v).toLocaleString('fr-FR') : '—');

export const HorodatagesPanel = ({ peutGerer }) => {
  const [d, setD] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const charger = useCallback(() => archivageService.horodatages().then(setD).catch(() => setD({ horodatages: [], en_attente: 0, reglages: {} })), []);
  useEffect(() => { charger(); }, [charger]);
  const horodater = async () => {
    setEnvoi(true);
    try {
      const r = await archivageService.horodaterMaintenant();
      if (r.echecs.length) toast.error(`${r.obtenus} jeton(s) obtenu(s), ${r.echecs.length} échec(s) : ${r.echecs[0]}`);
      else toast.success(r.obtenus ? `${r.obtenus} jeton(s) d'horodatage obtenu(s)` : 'Rien à horodater');
      charger();
    } catch (err) { toast.error(err.response?.data?.message || 'Horodatage impossible'); } finally { setEnvoi(false); }
  };
  if (!d) return <div className="h-20 rounded-2xl skeleton" />;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-slate-700 mr-auto flex items-center gap-1.5"><Clock size={15} /> Horodatage par une autorité tierce</h2>
        {peutGerer && d.reglages.actif && <button type="button" onClick={horodater} disabled={envoi} className="btn btn-primary btn-sm">{envoi ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Horodater maintenant{d.en_attente ? ` (${d.en_attente})` : ''}</button>}
      </div>
      <p className="text-xs text-slate-500 mb-3">
        {d.reglages.actif
          ? <>L'empreinte des sceaux, des procès-verbaux et des bordereaux de versement est signée par {d.reglages.url}. Seule l'empreinte quitte DocuFlow. Chaque jeton se vérifie sans DocuFlow : <code>openssl ts -verify -digest &lt;empreinte&gt; -in jeton.tsr -CAfile &lt;certificat de l'autorité&gt;</code>.</>
          : <>L'horodatage est désactivé. Activez « Horodatage par une autorité tierce » dans Administration › Configuration › Archivage & preuve (Code du numérique, art. 299-300).</>}
      </p>
      {d.horodatages.length > 0 && (
        <div className="glass-card-premium overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider"><tr><th className="text-left p-3">Pièce</th><th className="text-left p-3">Horodaté le</th><th className="text-left p-3">Autorité</th><th className="text-left p-3">Jeton</th></tr></thead>
            <tbody>
              {d.horodatages.map((h) => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="p-3">{OBJETS_HORODATES[h.objet_type]} n° {h.objet_id}<p className="text-[11px] font-mono text-slate-400 break-all">{h.empreinte}</p></td>
                  <td className="p-3 text-xs">{h.statut === 'obtenu' ? dateHeure(h.genere_at) : <span className="text-red-600">Échec : {h.erreur}</span>}</td>
                  <td className="p-3 text-xs">{h.autorite || h.tsa_url}</td>
                  <td className="p-3 text-xs">{h.statut === 'obtenu' && <button type="button" onClick={() => archivageService.jetonHorodatage(h).catch(() => toast.error('Téléchargement impossible'))} className="font-bold text-docuflow-secondary flex items-center gap-1"><Download size={12} /> .tsr</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const Risque = ({ risque }) => {
  const [l, c] = RISQUES_FORMAT[risque] || ['Non identifié', 'bg-slate-100 text-slate-500'];
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c}`}>{l}</span>;
};

export const OngletFormats = () => {
  const { can } = usePermissions();
  const [d, setD] = useState(null);
  const [envoi, setEnvoi] = useState(null);
  const charger = useCallback(() => archivageService.formats().then(setD).catch((err) => { toast.error(err.response?.data?.message || 'Chargement impossible'); setD({ formats: [], a_traiter: [] }); }), []);
  useEffect(() => { charger(); }, [charger]);
  const convertir = async (l) => {
    setEnvoi(l.file_id);
    try {
      const r = await archivageService.copiePdfa(l.document_id, l.file_id);
      toast.success(`Copie de conservation PDF/A-${r.pdfa} ajoutée (version ${r.version})`);
      charger();
    } catch (err) { toast.error(err.response?.data?.message || 'Conversion impossible'); } finally { setEnvoi(null); }
  };
  if (!d) return <div className="h-32 rounded-2xl skeleton" />;
  const total = d.formats.reduce((s, f) => s + f.fichiers, 0) || 1;
  const parRisque = (r) => d.formats.filter((f) => f.risque === r).reduce((s, f) => s + f.fichiers, 0);
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600 max-w-3xl">
        Le Code du numérique (art. 302) demande de conserver les documents « sur des formats appropriés à la conservation et à la migration ».
        Chaque fichier est identifié par sa signature binaire, pas par son extension. Une copie de conservation PDF/A s'ajoute comme nouvelle version : l'original reste intact.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {[['perenne', FileCheck2], ['surveiller', FileWarning], ['risque', FileWarning]].map(([r, I]) => (
          <div key={r} className="glass-card-premium p-4">
            <p className="text-xs text-slate-500 flex items-center gap-1"><I size={12} /> {RISQUES_FORMAT[r][0]}</p>
            <p className="text-2xl font-black text-slate-900">{parRisque(r)}</p>
            <p className="text-[11px] text-slate-400">{Math.round((parRisque(r) / total) * 100)} % des fichiers</p>
          </div>
        ))}
      </div>
      <div className="glass-card-premium overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider"><tr><th className="text-left p-3">Format</th><th className="text-left p-3">Appréciation</th><th className="text-left p-3">Fichiers</th><th className="text-left p-3">Volume</th></tr></thead>
          <tbody>
            {d.formats.map((f) => (
              <tr key={`${f.format}-${f.pdfa}`} className="border-t border-slate-100">
                <td className="p-3 font-semibold">{f.format}{f.pdfa ? ` (PDF/A-${f.pdfa})` : ''}</td>
                <td className="p-3"><Risque risque={f.risque} /></td>
                <td className="p-3 text-xs">{f.fichiers}</td>
                <td className="p-3 text-xs">{taille(f.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.a_traiter.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-slate-700 mb-2">Fichiers à faire évoluer</h2>
          {!d.conversion_disponible && <p className="text-xs text-amber-700 mb-2">Conversion indisponible : LibreOffice n'est pas installé sur ce serveur (il l'est avec l'application de bureau si LibreOffice est présent sur le poste).</p>}
          <div className="glass-card-premium overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {d.a_traiter.map((l) => (
                  <tr key={l.file_id} className="border-t border-slate-100 first:border-t-0">
                    <td className="p-3"><Link to={`/documents/liste?doc=${l.document_id}`} className="font-bold text-docuflow-secondary hover:underline">{l.reference_mfile}</Link> <span className="text-slate-600">v{l.version} · {l.original_name}</span></td>
                    <td className="p-3 text-xs">{l.format_nom}</td>
                    <td className="p-3"><Risque risque={l.format_risque} /></td>
                    <td className="p-3 text-right">
                      {l.copie_existante ? <span className="text-xs text-emerald-700">Copie PDF/A faite</span>
                        : can('archives.manage') && d.conversion_disponible && (
                          <button type="button" disabled={envoi !== null} onClick={() => convertir(l)} className="btn btn-secondary btn-sm">{envoi === l.file_id ? <Loader2 size={13} className="animate-spin" /> : <FileCheck2 size={13} />} Copie PDF/A</button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export const SauvegardePanel = () => {
  const [e, setE] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const charger = useCallback(() => archivageService.sauvegarde().then(setE).catch((err) => toast.error(err.response?.data?.message || 'Lecture impossible')), []);
  useEffect(() => { charger(); }, [charger]);
  const regler = async (corps) => {
    try { setE(await archivageService.reglerSauvegarde(corps)); toast.success('Réglages enregistrés'); } catch (err) { toast.error(err.response?.data?.message || 'Enregistrement impossible'); }
  };
  const choisir = async () => {
    const dossier = await window.desktopApp?.sauvegarde?.choisirDossier?.();
    if (dossier) regler({ dossier });
  };
  const sauvegarder = async () => {
    setEnvoi(true);
    try { const r = await archivageService.sauvegarder(); setE(r.etat); toast.success(`Sauvegarde faite : ${r.sauvegarde.nom}`); } catch (err) { toast.error(err.response?.data?.message || 'Sauvegarde impossible'); } finally { setEnvoi(false); }
  };
  if (!e) return <div className="h-32 rounded-2xl skeleton" />;
  return (
    <div className="glass-card-premium p-6 space-y-4 max-w-3xl">
      <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><HardDrive size={20} /> Sauvegarde</h2>
      {!e.disponible ? <p className="text-sm text-slate-600">{e.raison}</p> : (
        <>
          <p className="text-sm text-slate-600">
            Chaque jour, DocuFlow copie la base et tous les documents dans un dossier daté, avec une notice de restauration.
            Choisissez un disque externe, une clé USB ou un partage réseau : une sauvegarde sur le même disque ne protège ni d'une panne ni d'un vol.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="input-premium flex-1 min-w-[240px] text-sm truncate">{e.dossier || 'Aucun dossier choisi'}</span>
            {window.desktopApp?.sauvegarde && <button type="button" onClick={choisir} className="btn btn-secondary btn-sm"><FolderOpen size={14} /> Choisir…</button>}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={e.actif} disabled={!e.dossier} onChange={(ev) => regler({ actif: ev.target.checked })} /> Sauvegarde automatique quotidienne</label>
            <label className="flex items-center gap-2">Conserver
              <select className="input-premium w-auto py-1 text-sm" value={e.conserver} onChange={(ev) => regler({ conserver: Number(ev.target.value) })}>
                {[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n}</option>)}
              </select> sauvegardes</label>
            <button type="button" onClick={sauvegarder} disabled={envoi || !e.dossier} className="btn btn-primary btn-sm ml-auto">{envoi ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Sauvegarder maintenant</button>
          </div>
          {e.derniere && (
            <p className={`text-xs ${e.derniere.ok ? 'text-emerald-700' : 'text-red-700'}`}>
              Dernière sauvegarde le {dateHeure(e.derniere.at)} : {e.derniere.ok ? `réussie (${taille(e.derniere.octets)}, ${e.derniere.fichiers} fichier(s))` : `échec — ${e.derniere.erreur}`}
            </p>
          )}
          {e.sauvegardes.length > 0 && (
            <ul className="text-xs text-slate-600 space-y-1">
              {e.sauvegardes.map((s) => <li key={s.nom} className="font-mono">{s.nom}{s.complete ? ` · ${taille(s.octets)}` : ' · incomplète'}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
