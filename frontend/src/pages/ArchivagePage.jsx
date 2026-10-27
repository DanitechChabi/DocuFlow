import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Fingerprint, ShieldCheck, ShieldAlert, Loader2, RefreshCw, Link2, Stamp, Download, Gavel, Files, BadgeCheck,
  FileWarning, Hourglass, Search, Trash2, Archive, FileCheck2,
} from 'lucide-react';
import { OngletSortFinal, OngletEliminations } from '../components/archives/OngletsElimination';
import { OngletVersements } from '../components/archives/OngletVersements';
import { HorodatagesPanel, OngletFormats } from '../components/archives/PreuveConservation';
import PageHeader from '../components/PageHeader';
import {
  archivesService, STATUTS_INTEGRITE, empreinteCourte, empreinteGroupee, dateHeure, dateCourte,
} from '../services/archivesService';
import { usePermissions } from '../hooks/usePermissions';
import { useTitrePage } from '../hooks/useTitrePage';
import { toast } from '../components/Toast';

/**
 * Archivage — la preuve (migration 031).
 *
 * Ce qu'un système d'archivage électronique doit pouvoir démontrer : que les
 * fichiers conservés sont ceux qui ont été versés (empreintes et contrôle
 * périodique), que le journal n'a pas été réécrit (chaîne d'empreintes et
 * sceaux), que rien n'est détruit pendant un contentieux (gels juridiques),
 * et qu'un certificat présenté a bien été émis ici.
 */
const ONGLETS = [
  { cle: 'integrite', libelle: 'Intégrité des fichiers', icone: Fingerprint },
  { cle: 'sort-final', libelle: 'Sort final', icone: Hourglass },
  { cle: 'eliminations', libelle: 'Éliminations', icone: Trash2 },
  { cle: 'versements', libelle: 'Versements', icone: Archive },
  { cle: 'journal', libelle: 'Journal & sceaux', icone: Link2 },
  { cle: 'gels', libelle: 'Gels juridiques', icone: Gavel },
  { cle: 'doublons', libelle: 'Doublons', icone: Files },
  { cle: 'formats', libelle: 'Formats', icone: FileCheck2 },
  { cle: 'certificat', libelle: 'Vérifier un certificat', icone: BadgeCheck },
];

const Chiffre = ({ valeur, libelle, ton = 'slate', icone: Icone }) => {
  const tons = {
    slate: 'text-slate-900', vert: 'text-emerald-600', rouge: 'text-red-600', orange: 'text-orange-600', ambre: 'text-amber-600',
  };
  return (
    <div className="glass-card-premium p-4">
      <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">{Icone && <Icone size={13} />} {libelle}</p>
      <p className={`text-3xl font-black mt-1 ${tons[ton]}`}>{valeur ?? '—'}</p>
    </div>
  );
};

const LienDocument = ({ id, reference }) => (
  <Link to={`/documents/liste?doc=${id}`} className="font-bold text-docuflow-secondary hover:underline">{reference}</Link>
);

const Vide = ({ icone: Icone, titre, texte }) => (
  <div className="glass-card-premium p-12 text-center">
    <Icone size={36} className="mx-auto text-slate-300 mb-3" />
    <p className="font-bold text-slate-800">{titre}</p>
    {texte && <p className="text-sm text-slate-500 mt-1 max-w-xl mx-auto">{texte}</p>}
  </div>
);

// ------------------------------------------------------------- Intégrité
const OngletIntegrite = ({ peutGerer }) => {
  const [rapport, setRapport] = useState(null);
  const [anomalies, setAnomalies] = useState(null);
  const [controle, setControle] = useState(false);

  const charger = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([archivesService.rapport(), archivesService.anomalies()]);
      setRapport(r);
      setAnomalies(a);
    } catch (err) {
      toast.error(err.response?.data?.message || "Rapport d'intégrité indisponible");
    }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const controler = async () => {
    setControle(true);
    try {
      const r = await archivesService.verifierLot(50);
      if (!r.verifies) toast.success('Tous les fichiers ont été contrôlés récemment : rien à relire.');
      else if (r.alterees || r.introuvables) toast.error(`${r.verifies} fichier(s) relu(s) : ${r.alterees} altéré(s), ${r.introuvables} introuvable(s)`);
      else toast.success(`${r.verifies} fichier(s) relu(s) : tous conformes à leur empreinte`);
      charger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Contrôle impossible');
    } finally {
      setControle(false);
    }
  };

  if (!rapport) return <div className="grid md:grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-2xl skeleton" />)}</div>;
  const f = rapport.fichiers;
  const couverture = f.total ? Math.round((f.avec_empreinte / f.total) * 100) : 100;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
        <Chiffre valeur={f.total} libelle="Fichiers conservés" icone={Files} />
        <Chiffre valeur={`${couverture} %`} libelle="Avec empreinte" icone={Fingerprint} ton={couverture === 100 ? 'vert' : 'ambre'} />
        <Chiffre valeur={f.intactes} libelle="Intacts" icone={ShieldCheck} ton="vert" />
        <Chiffre valeur={f.alterees} libelle="Altérés" icone={ShieldAlert} ton={f.alterees ? 'rouge' : 'slate'} />
        <Chiffre valeur={f.introuvables} libelle="Introuvables" icone={FileWarning} ton={f.introuvables ? 'orange' : 'slate'} />
        <Chiffre valeur={f.en_attente} libelle="Contrôle en attente" icone={Hourglass} />
      </div>
      <div className="glass-card-premium p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
        <span>Dernier contrôle : <strong>{dateHeure(f.derniere_verification)}</strong></span>
        {f.rattrapees > 0 && <span>{f.rattrapees} empreinte(s) calculée(s) après versement (fichiers antérieurs)</span>}
        <span>Doublons : <strong>{rapport.doublons}</strong></span>
        <span>Gels en cours : <strong>{rapport.gels_actifs}</strong></span>
        <span className="text-slate-400">Chaque fichier est relu périodiquement (réglage « Archivage & preuve ») ; une altération est signalée aux gestionnaires.</span>
        {peutGerer && (
          <button type="button" onClick={controler} disabled={controle} className="btn btn-secondary btn-sm ml-auto">
            {controle ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Contrôler maintenant
          </button>
        )}
      </div>

      <div>
        <h2 className="text-sm font-bold text-slate-700 mb-3">Anomalies en cours</h2>
        {anomalies === null ? <div className="h-20 rounded-2xl skeleton" /> : anomalies.length === 0 ? (
          <Vide icone={ShieldCheck} titre="Aucune anomalie" texte="Tous les fichiers contrôlés correspondent à leur empreinte d'archivage." />
        ) : (
          <div className="glass-card-premium overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <tr><th className="text-left p-3">Document</th><th className="text-left p-3">Version</th><th className="text-left p-3">État</th><th className="text-left p-3">Constaté le</th></tr>
              </thead>
              <tbody>
                {anomalies.map((a) => {
                  const s = STATUTS_INTEGRITE[a.integrite_statut];
                  return (
                    <tr key={a.fichier_id} className="border-t border-slate-100">
                      <td className="p-3"><LienDocument id={a.document_id} reference={a.reference_mfile} /><p className="text-xs text-slate-500">{a.nom_entreprise}{a.en_corbeille ? ' · en corbeille' : ''}</p></td>
                      <td className="p-3 text-xs">v{a.version} · {a.original_name}</td>
                      <td className="p-3"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${s.classe}`}><span className={`w-1.5 h-1.5 rounded-full ${s.point}`} /> {s.libelle}</span></td>
                      <td className="p-3 text-xs text-slate-500">{dateHeure(a.integrite_verifiee_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ------------------------------------------------------------- Journal
const ETAT_SCEAU = {
  conforme: { libelle: 'Conforme', classe: 'text-emerald-700 bg-emerald-50' },
  non_conforme: { libelle: 'NON CONFORME', classe: 'text-red-700 bg-red-50' },
  non_verifiable: { libelle: 'Purgé (non vérifiable)', classe: 'text-slate-600 bg-slate-100' },
};
const ANOMALIES = {
  alteree: 'Entrée modifiée après coup',
  discontinuite: 'Entrée(s) manquante(s), sans purge déclarée',
  rupture: 'Maillon qui ne cite pas le précédent',
};

const OngletJournal = ({ peutGerer }) => {
  const [verif, setVerif] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [sceaux, setSceaux] = useState(null);

  const chargerSceaux = useCallback(() => archivesService.sceaux().then(setSceaux).catch(() => setSceaux([])), []);
  const verifier = useCallback(async () => {
    setEnCours(true);
    try {
      setVerif(await archivesService.verifierJournal());
    } catch (err) {
      toast.error(err.response?.data?.message || 'Vérification impossible');
    } finally {
      setEnCours(false);
    }
  }, []);
  useEffect(() => { verifier(); chargerSceaux(); }, [verifier, chargerSceaux]);

  const sceller = async () => {
    try {
      const s = await archivesService.sceller();
      toast.success(s.nouveau ? `Journal scellé au maillon n° ${s.rang}` : 'Rien de nouveau depuis le dernier sceau');
      chargerSceaux();
      verifier();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Scellement impossible');
    }
  };

  return (
    <div className="space-y-6">
      <div className={`glass-card-premium p-5 ${verif && !verif.integre ? 'ring-2 ring-red-300' : ''}`}>
        <div className="flex flex-wrap items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${!verif ? 'bg-slate-100 text-slate-400' : verif.integre ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            {enCours || !verif ? <Loader2 size={26} className="animate-spin" /> : verif.integre ? <ShieldCheck size={28} /> : <ShieldAlert size={28} />}
          </div>
          <div className="flex-1 min-w-[240px]">
            <p className="font-black text-lg text-slate-900">
              {!verif ? 'Vérification du journal…' : verif.integre ? 'Journal intègre' : 'Journal NON intègre'}
            </p>
            {verif && (
              <p className="text-sm text-slate-600 mt-0.5">
                {verif.lignes} entrée(s) chaînée(s) vérifiée(s) le {dateHeure(verif.verifie_at)}
                {verif.lignes_purgees > 0 && ` · ${verif.lignes_purgees} retirée(s) par ${verif.purges_declarees} purge(s) déclarée(s)`}
                {verif.lignes_anterieures > 0 && ` · ${verif.lignes_anterieures} antérieure(s) au chaînage`}
              </p>
            )}
            {verif && (
              <p className="text-xs text-slate-500 mt-2 font-mono break-all">Tête : maillon n° {verif.tete.rang} · {empreinteGroupee(verif.tete.hash)}</p>
            )}
          </div>
          <button type="button" onClick={verifier} disabled={enCours} className="btn btn-secondary btn-sm"><RefreshCw size={14} /> Revérifier</button>
        </div>
        {verif && !verif.integre && (
          <div className="mt-4 space-y-1.5">
            {!verif.tete.conforme && <p className="text-sm text-red-700 font-semibold">La fin du journal ne correspond pas à la tête de chaîne : des entrées récentes ont été retirées.</p>}
            {verif.sceaux.non_conformes > 0 && <p className="text-sm text-red-700 font-semibold">{verif.sceaux.non_conformes} sceau(x) ne retrouvent plus leur maillon : le journal a été réécrit depuis.</p>}
            {verif.anomalies.premieres.map((a, i) => (
              <p key={i} className="text-sm text-red-700">Maillon n° {a.debut}{a.fin !== a.debut ? `–${a.fin}` : ''} : {ANOMALIES[a.anomalie] || a.anomalie}</p>
            ))}
            {verif.anomalies.total > verif.anomalies.premieres.length && <p className="text-xs text-red-600">… et {verif.anomalies.total - verif.anomalies.premieres.length} autre(s).</p>}
          </div>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 className="text-sm font-bold text-slate-700 mr-auto">Sceaux du journal</h2>
          <button type="button" onClick={() => archivesService.exporterSceaux().catch(() => toast.error('Export impossible'))} className="btn btn-secondary btn-sm"><Download size={14} /> Relevé (CSV)</button>
          {peutGerer && <button type="button" onClick={sceller} className="btn btn-primary btn-sm"><Stamp size={14} /> Sceller maintenant</button>}
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Un sceau fige l'empreinte de tête du journal à un instant donné ; le journal est scellé chaque jour automatiquement.
          Conservez le relevé hors de DocuFlow (archive, courrier, huissier) : il prouve qu'aucune entrée antérieure n'a été réécrite.
        </p>
        {sceaux === null ? <div className="h-20 rounded-2xl skeleton" /> : sceaux.length === 0 ? (
          <Vide icone={Stamp} titre="Aucun sceau pour l'instant" texte="Le premier sceau automatique est posé dans les 24 heures qui suivent la première entrée du journal." />
        ) : (
          <div className="glass-card-premium overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <tr><th className="text-left p-3">Scellé le</th><th className="text-left p-3">Maillon</th><th className="text-left p-3">Empreinte</th><th className="text-left p-3">Origine</th><th className="text-left p-3">État</th></tr>
              </thead>
              <tbody>
                {sceaux.map((s) => {
                  const etat = verif?.sceaux.liste.find((x) => x.id === s.id)?.etat;
                  return (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="p-3 text-xs">{dateHeure(s.scelle_at)}</td>
                      <td className="p-3 text-xs font-mono">n° {s.rang}</td>
                      <td className="p-3 text-xs font-mono" title={s.hash}>{empreinteCourte(s.hash)}</td>
                      <td className="p-3 text-xs">{s.origine === 'auto' ? 'Automatique' : `Manuel${s.scelle_par ? ` (${s.scelle_par})` : ''}`}</td>
                      <td className="p-3">{etat ? <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${ETAT_SCEAU[etat].classe}`}>{ETAT_SCEAU[etat].libelle}</span> : <span className="text-xs text-slate-400">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <HorodatagesPanel peutGerer={peutGerer} />
    </div>
  );
};

// ------------------------------------------------------------- Gels
const OngletGels = () => {
  const [statut, setStatut] = useState('actifs');
  const [gels, setGels] = useState(null);
  useEffect(() => {
    setGels(null);
    archivesService.gels(statut).then(setGels).catch(() => setGels([]));
  }, [statut]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="segmented">
          <button type="button" aria-pressed={statut === 'actifs'} onClick={() => setStatut('actifs')}>En cours</button>
          <button type="button" aria-pressed={statut === 'tous'} onClick={() => setStatut('tous')}>Historique complet</button>
        </div>
        <p className="text-xs text-slate-500">Un gel se pose et se lève depuis la fiche du document (permission « Poser un gel juridique »).</p>
      </div>
      {gels === null ? <div className="h-20 rounded-2xl skeleton" /> : gels.length === 0 ? (
        <Vide icone={Gavel} titre={statut === 'actifs' ? 'Aucun document gelé' : 'Aucun gel enregistré'}
          texte="Un gel juridique interdit toute destruction d'un document (corbeille, purge, élimination, retrait de version) le temps d'un contentieux, d'un contrôle ou d'une enquête." />
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {gels.map((g) => (
            <div key={g.id} className={`glass-card-premium p-4 text-sm ${g.leve_at ? 'opacity-75' : 'border-l-4 border-red-400'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <LienDocument id={g.document_id} reference={g.reference_mfile} />
                  <p className="text-xs text-slate-500">{g.nom_entreprise} · {g.num_dossier} / {g.num_acte}{g.en_corbeille ? ' · en corbeille' : ''}</p>
                </div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${g.leve_at ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-700'}`}>{g.leve_at ? 'Levé' : 'En cours'}</span>
              </div>
              <p className="mt-2 text-slate-700">{g.motif}{g.reference && <span className="text-slate-500"> — réf. {g.reference}</span>}</p>
              <p className="text-xs text-slate-400 mt-1">Posé par {g.pose_par || '—'} le {dateCourte(g.pose_at)}</p>
              {g.leve_at && <p className="text-xs text-slate-500 mt-1">Levé par {g.leve_par || '—'} le {dateCourte(g.leve_at)} : {g.motif_levee}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------- Doublons
const OngletDoublons = () => {
  const [groupes, setGroupes] = useState(null);
  useEffect(() => { archivesService.doublons().then(setGroupes).catch(() => setGroupes([])); }, []);
  if (groupes === null) return <div className="h-20 rounded-2xl skeleton" />;
  if (!groupes.length) return <Vide icone={Files} titre="Aucun doublon" texte="Aucun fichier n'est présent dans deux documents à la fois (comparaison par empreinte SHA-256)." />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Même empreinte SHA-256 = fichiers identiques à l'octet près. Un doublon peut être légitime (une attestation jointe à deux dossiers) : rien n'est fusionné automatiquement.</p>
      {groupes.map((g) => (
        <div key={g.empreinte} className="glass-card-premium p-4 text-sm">
          <p className="font-semibold text-slate-800">{g.nom_fichier} <span className="text-xs text-slate-400 font-mono">· {empreinteCourte(g.empreinte)}</span></p>
          <div className="flex flex-wrap gap-2 mt-2">
            {g.documents.map((d) => (
              <span key={d.id} className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-100 text-xs"><LienDocument id={d.id} reference={d.reference_mfile} /> <span className="text-slate-500">{d.nom_entreprise}</span></span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// ------------------------------------------------------------- Certificat
const OngletCertificat = () => {
  const [numero, setNumero] = useState('');
  const [empreinte, setEmpreinte] = useState('');
  const [resultat, setResultat] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const verifier = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      setResultat(await archivesService.verifierCertificat(numero.trim(), empreinte.replace(/\s+/g, '').toLowerCase()));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Vérification impossible');
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <form onSubmit={verifier} className="glass-card-premium p-5 space-y-3">
        <p className="text-sm text-slate-600">Saisissez le numéro et l'empreinte imprimés sur un certificat d'archivage pour vérifier qu'il a bien été émis par votre organisation, et qu'il n'a pas été modifié depuis.</p>
        <label className="block text-xs font-bold text-slate-600">Numéro du certificat
          <input className="input-premium mt-1 font-mono" required value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="CERT-60-121-20261026101500" />
        </label>
        <label className="block text-xs font-bold text-slate-600">Empreinte du certificat (facultatif)
          <textarea className="input-premium mt-1 font-mono text-xs min-h-[64px]" value={empreinte} onChange={(e) => setEmpreinte(e.target.value)} placeholder="64 caractères hexadécimaux, espaces acceptés" />
        </label>
        <button type="submit" disabled={envoi || !numero.trim()} className="btn btn-primary">{envoi ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Vérifier</button>
      </form>
      {resultat && (
        <div className={`glass-card-premium p-5 ${resultat.trouve && resultat.conforme !== false ? 'border-l-4 border-emerald-400' : 'border-l-4 border-red-400'}`}>
          {!resultat.trouve ? (
            <p className="font-bold text-red-700 flex items-center gap-2"><ShieldAlert size={18} /> {resultat.motif === 'format' ? 'Numéro de certificat mal formé.' : 'Aucun certificat de ce numéro n\'a été émis par votre organisation.'}</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className={`font-bold flex items-center gap-2 ${resultat.conforme === false ? 'text-red-700' : 'text-emerald-700'}`}>
                {resultat.conforme === false ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
                {resultat.conforme === false ? 'Certificat émis ici, mais son contenu a été modifié depuis (empreinte différente).'
                  : resultat.conforme ? 'Certificat authentique : émis ici, contenu intact.' : 'Certificat émis par votre organisation.'}
              </p>
              <p className="text-slate-600">Document : <strong>{resultat.document || '—'}</strong> · émis le {dateHeure(resultat.emis_at)}</p>
              <p className="text-slate-600">Inscrit au journal chaîné, maillon n° {resultat.rang_journal ?? '—'}</p>
              <p className="text-xs font-mono text-slate-500 break-all">Empreinte enregistrée : {empreinteGroupee(resultat.empreinte_certificat)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ArchivagePage = () => {
  useTitrePage('Archivage');
  const { can } = usePermissions();
  const peutGerer = can('archives.manage');
  const [params, setParams] = useSearchParams();
  const onglet = ONGLETS.some((o) => o.cle === params.get('onglet')) ? params.get('onglet') : 'integrite';
  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Conservation et preuve"
        subtitle="Intégrité des fichiers, journal infalsifiable, gels juridiques et certificats"
        icon={Fingerprint}
        breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Archivage' }]}
      />
      <div className="flex gap-1 overflow-x-auto mb-6 border-b border-slate-200" role="tablist">
        {ONGLETS.map(({ cle, libelle, icone: Icone }) => (
          <button key={cle} type="button" role="tab" aria-selected={onglet === cle} onClick={() => setParams({ onglet: cle }, { replace: true })}
            className={`px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap border-b-2 -mb-px transition-colors ${onglet === cle ? 'border-docuflow-secondary text-docuflow-secondary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <Icone size={15} /> {libelle}
          </button>
        ))}
      </div>
      {onglet === 'integrite' && <OngletIntegrite peutGerer={peutGerer} />}
      {onglet === 'sort-final' && (
        <OngletSortFinal onBordereauCree={(id) => setParams({ onglet: 'eliminations', bordereau: id })}
          onVersementCree={(id) => setParams({ onglet: 'versements', versement: id })} />
      )}
      {onglet === 'versements' && (
        <OngletVersements ouvert={Number(params.get('versement')) || null}
          setOuvert={(id) => setParams(id ? { onglet: 'versements', versement: id } : { onglet: 'versements' })} />
      )}
      {onglet === 'eliminations' && (
        <OngletEliminations ouvert={Number(params.get('bordereau')) || null}
          setOuvert={(id) => setParams(id ? { onglet: 'eliminations', bordereau: id } : { onglet: 'eliminations' })} />
      )}
      {onglet === 'journal' && <OngletJournal peutGerer={peutGerer} />}
      {onglet === 'gels' && <OngletGels />}
      {onglet === 'doublons' && <OngletDoublons />}
      {onglet === 'formats' && <OngletFormats />}
      {onglet === 'certificat' && <OngletCertificat />}
    </div>
  );
};

export default ArchivagePage;
