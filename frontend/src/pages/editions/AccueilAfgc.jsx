import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  PlusCircle, FileSearch, Undo2, ClipboardList, BookOpenCheck, BookOpen, Mail, Warehouse, ListChecks,
  ArrowRight, AlertTriangle, Settings2, Check, Loader2,
} from 'lucide-react';
import { requestService } from '../../services/requestService';
import { listeService } from '../../services/listeService';
import { authService } from '../../services/authService';
import { settingsService } from '../../services/settingsService';
import { toast } from '../../components/Toast';
import { usePermissions } from '../../hooks/usePermissions';
import { useTitrePage } from '../../hooks/useTitrePage';
import { edition } from '../../editions';
import { Pastille, Chargement } from './afgc/elements';
import { etatDemande, intitule, references } from './afgc/vocabulaire';
import BoiteDemande from './afgc/BoiteDemande';
import { prenomDe } from './afgc/identite';

// ============================================================================
// Accueil de l'édition AFGC : l'essentiel en trois boutons.
//
// Un agent n'a que trois gestes : demander un dossier (ou une liste), voir où
// en sont ses demandes — Demandé, Transmis, Retourné — et retourner ce qu'il
// a reçu. L'archiviste, lui, traite : la file « à traiter » (demandes et
// listes), les dossiers sortis (et les retards), les registres.
// Chaque carte mène à une page de la plateforme, et ses compteurs viennent des
// mêmes routes que cette page : l'accueil n'invente aucune donnée.
// ============================================================================

const PRET_OUVERT = new Set(['en_cours', 'en_retard', 'signale']);

const joursDeRetard = (date) => {
  if (!date) return 0;
  const ecart = Date.now() - new Date(`${String(date).slice(0, 10)}T00:00:00`).getTime();
  return Math.max(0, Math.floor(ecart / 86400000));
};

/** Grande carte d'action. `principale` : le geste le plus fréquent, en vert. */
const CarteAction = ({ to, icone: Icone, titre, texte, principale = false, children }) => (
  <Link
    to={to}
    className={`group relative overflow-hidden rounded-3xl p-7 flex flex-col transition-all animate-fade-in-up ${
      principale
        ? 'bg-docuflow-secondary text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5'
        : 'glass-card-premium hover:shadow-elevated hover:-translate-y-0.5'
    }`}
  >
    <div className="flex items-start justify-between mb-6">
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 ${
        principale ? 'bg-white/15 text-white' : 'bg-green-50 text-docuflow-secondary'
      }`}>
        <Icone size={26} />
      </div>
      <ArrowRight size={18} className={`transition-transform group-hover:translate-x-1 ${principale ? 'text-white/80' : 'text-slate-300'}`} />
    </div>
    <h2 className={`text-xl font-black mb-1.5 ${principale ? 'text-white' : 'text-slate-900'}`}>{titre}</h2>
    <p className={`text-sm leading-relaxed ${principale ? 'text-white/85' : 'text-slate-500'}`}>{texte}</p>
    {children && <div className="flex flex-wrap items-center gap-2 mt-5">{children}</div>}
  </Link>
);

const AccueilAfgc = () => {
  const { can } = usePermissions();
  const user = authService.getCurrentUser();
  const traite = can('requests.process');
  const configure = can('settings.manage');

  const [mesDemandes, setMesDemandes] = useState(null);
  const [aTraiter, setATraiter] = useState(null);
  const [listesOuvertes, setListesOuvertes] = useState(null);
  const [sorties, setSorties] = useState(null);

  useTitrePage('Accueil');

  // Administrateur : la configuration de l'AFGC (motifs, typologies,
  // départements) s'installe d'un clic, tant qu'elle ne l'a jamais été.
  const [config, setConfig] = useState(null);
  const [installation, setInstallation] = useState(false);
  useEffect(() => {
    if (!configure || !edition?.id) return;
    settingsService.etatEdition(edition.id).then(setConfig).catch(() => setConfig(null));
  }, [configure]);
  const aInstaller = Boolean(config && !config.appliquee && Object.values(config.manquants || {}).some((n) => n > 0));
  const installer = async () => {
    setInstallation(true);
    try {
      const r = await settingsService.appliquerEdition(edition.id);
      toast.success(`Configuration de l'AFGC installée : ${r.motifs} motifs, ${r.types} typologies, ${r.departements_ajoutes} département${r.departements_ajoutes > 1 ? 's' : ''} ajouté${r.departements_ajoutes > 1 ? 's' : ''}.`);
      setConfig(null);
    } catch (e) {
      toast.error(e.response?.data?.message || 'La configuration n\'a pas pu être installée.');
    } finally {
      setInstallation(false);
    }
  };

  const charger = useCallback(async () => {
    if (traite) {
      await Promise.all([
        requestService.getAllRequests()
          .then((l) => setATraiter((Array.isArray(l) ? l : []).filter((d) => !d.lot_id && etatDemande(d).cle === 'demande').length))
          .catch(() => setATraiter(0)),
        listeService.lister()
          .then((l) => setListesOuvertes((Array.isArray(l) ? l : []).filter((x) => x.a_transmettre > 0).length))
          .catch(() => setListesOuvertes(0)),
        requestService.getRegistrePrets()
          .then((l) => setSorties((Array.isArray(l) ? l : []).filter((p) => PRET_OUVERT.has(p.etat))))
          .catch(() => setSorties([])),
      ]);
    } else {
      await requestService.getMyRequests()
        .then((l) => setMesDemandes(Array.isArray(l) ? l : []))
        .catch(() => setMesDemandes([]));
    }
  }, [traite]);

  useEffect(() => {
    charger();
    const recharger = () => charger();
    window.addEventListener('afgc:demande-envoyee', recharger);
    return () => window.removeEventListener('afgc:demande-envoyee', recharger);
  }, [charger]);

  const prenom = prenomDe(user?.full_name) || 'bienvenue';

  // --- Agent ---
  const enCours = (mesDemandes || []).filter((d) => ['demande', 'transmis'].includes(etatDemande(d).cle));
  const transmis = (mesDemandes || []).filter((d) => etatDemande(d).cle === 'transmis');
  const enRetardAgent = transmis.filter((d) => d.loan_etat === 'en_retard').length;

  // --- Archiviste ---
  const enRetard = (sorties || []).filter((p) => p.etat === 'en_retard');

  return (
    <div className="relative p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-4 md:gap-5 mb-8 animate-fade-in-up">
        <img src={edition?.embleme} alt="" className="w-14 h-14 md:w-16 md:h-16 object-contain flex-shrink-0" />
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Bonjour, {prenom}</h1>
          <p className="text-sm md:text-base text-slate-500">
            {traite ? 'Archives de l\'AFGC : les demandes à traiter et les dossiers sortis.' : 'Archives de l\'AFGC'}
          </p>
        </div>
        {traite && can('requests.create') && (
          <Link to="/demandes/nouvelle" className="ml-auto hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:border-docuflow-secondary hover:text-docuflow-secondary transition-colors">
            <PlusCircle size={16} /> Demander un dossier
          </Link>
        )}
      </div>

      {aInstaller && (
        <section className="rounded-3xl border-2 border-dashed border-green-200 bg-green-50/70 p-5 md:p-6 mb-6 flex flex-wrap items-center gap-4 animate-fade-in-up">
          <div className="w-12 h-12 rounded-2xl bg-white text-docuflow-secondary flex items-center justify-center flex-shrink-0"><Settings2 size={22} /></div>
          <div className="min-w-0 flex-1 basis-72">
            <h2 className="font-black text-slate-900">Installer la configuration de l'AFGC</h2>
            <p className="text-sm text-slate-600">
              Les {config.attendus.motifs} motifs de demande, les {config.attendus.types} typologies de dossiers et les {config.attendus.departements} départements, en un clic.
              Ce que vous avez déjà ajouté est gardé, et tout reste modifiable dans Réglages.
            </p>
          </div>
          <button type="button" onClick={installer} disabled={installation}
            className="px-5 py-3 rounded-2xl bg-docuflow-secondary text-white font-bold inline-flex items-center gap-2 disabled:opacity-60">
            {installation ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Installer
          </button>
        </section>
      )}

      {traite ? (
        <>
          <div className="grid gap-5 md:grid-cols-3">
            <CarteAction to="/demandes/a-traiter" icone={ClipboardList} titre="À traiter" principale
              texte="Les demandes et les listes reçues : transmettre le dossier, puis noter son retour.">
              {aTraiter !== null && (
                <span className="px-3 py-1.5 rounded-full bg-white/20 text-white text-xs font-bold">
                  {aTraiter === 0 ? 'Aucune demande' : `${aTraiter} demande${aTraiter > 1 ? 's' : ''}`}
                </span>
              )}
              {listesOuvertes > 0 && (
                <span className="px-3 py-1.5 rounded-full bg-white/20 text-white text-xs font-bold inline-flex items-center gap-1.5">
                  <ListChecks size={13} /> {listesOuvertes} liste{listesOuvertes > 1 ? 's' : ''}
                </span>
              )}
            </CarteAction>
            <CarteAction to="/demandes/prets" icone={BookOpenCheck} titre="Dossiers sortis"
              texte="Qui a quel dossier, pour quel motif, et pour quand il doit revenir.">
              {sorties !== null && <Pastille ton="vert">{sorties.length} transmis</Pastille>}
              {enRetard.length > 0 && <Pastille ton="rouge"><AlertTriangle size={13} /> {enRetard.length} en retard</Pastille>}
            </CarteAction>
            <div className="glass-card-premium rounded-3xl p-7 animate-fade-in-up">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-6">
                <BookOpen size={26} />
              </div>
              <h2 className="text-xl font-black text-slate-900 mb-3">Registres</h2>
              <div className="space-y-1">
                {[
                  { to: '/demandes/prets', label: 'Sorties et retours', icone: BookOpenCheck, visible: true },
                  { to: '/courrier/registre', label: 'Courrier arrivée et départ', icone: Mail, visible: can('mail.register') },
                  { to: '/documents/magasins', label: 'Inventaire des boîtes', icone: Warehouse, visible: can('documents.view') },
                ].filter((r) => r.visible).map((r) => (
                  <Link key={r.to} to={r.to} className="flex items-center gap-3 px-3 py-2 -mx-3 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-docuflow-secondary transition-colors">
                    <r.icone size={16} className="text-slate-400" /> {r.label}
                    <ArrowRight size={14} className="ml-auto text-slate-300" />
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <section className="glass-card-premium rounded-3xl p-6 mt-8 animate-fade-in-up">
            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-4">
              <AlertTriangle size={16} className="text-red-500" /> Dossiers à récupérer
            </h3>
            {sorties === null ? <Chargement /> : enRetard.length ? (
              <ul className="divide-y divide-slate-100">
                {enRetard.slice(0, 6).map((p) => (
                  <li key={p.id} className="py-3 flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-800 line-clamp-2">{intitule(p)}</div>
                      <div className="text-xs text-slate-400 truncate">{[references(p), p.cadre, p.emprunteur_name && `chez ${p.emprunteur_name}`].filter(Boolean).join(' · ')}</div>
                    </div>
                    <Pastille ton="rouge">{joursDeRetard(p.date_retour_prevue)} j de retard</Pastille>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400 py-2">Aucun dossier en retard.</p>
            )}
          </section>
        </>
      ) : (
        <>
          {/* La demande, là où l'on arrive : on tape, Entrée. */}
          <section className="glass-card-premium rounded-3xl p-5 md:p-7 animate-fade-in-up">
            <h2 className="text-lg md:text-xl font-black text-slate-900 mb-4">Quel dossier vous faut-il ?</h2>
            <BoiteDemande grande autoFocus onEnvoye={charger} />
          </section>

          <div className="grid gap-4 sm:grid-cols-2 mt-5">
            <Link to="/demandes/mes-demandes" className="glass-card-premium rounded-2xl p-5 flex items-center gap-4 hover:shadow-elevated hover:-translate-y-0.5 transition-all group animate-fade-in-up">
              <div className="w-12 h-12 rounded-2xl bg-green-50 text-docuflow-secondary flex items-center justify-center flex-shrink-0"><FileSearch size={22} /></div>
              <div className="min-w-0">
                <div className="font-black text-slate-900">Mes dossiers</div>
                <div className="text-sm text-slate-500">{mesDemandes === null ? '…' : `${enCours.length} en cours`}</div>
              </div>
              <ArrowRight size={18} className="ml-auto text-slate-300 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link to="/demandes/mes-demandes" className="glass-card-premium rounded-2xl p-5 flex items-center gap-4 hover:shadow-elevated hover:-translate-y-0.5 transition-all group animate-fade-in-up">
              <div className="w-12 h-12 rounded-2xl bg-green-50 text-docuflow-secondary flex items-center justify-center flex-shrink-0"><Undo2 size={22} /></div>
              <div className="min-w-0">
                <div className="font-black text-slate-900">À retourner</div>
                <div className="text-sm text-slate-500">
                  {mesDemandes === null ? '…' : `${transmis.length} dossier${transmis.length > 1 ? 's' : ''} chez vous`}
                  {enRetardAgent > 0 && <span className="ml-2 font-bold text-red-600">· {enRetardAgent} en retard</span>}
                </div>
              </div>
              <ArrowRight size={18} className="ml-auto text-slate-300 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>

          <section className="glass-card-premium rounded-3xl p-6 mt-5 animate-fade-in-up">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h3 className="font-bold text-slate-900 flex items-center gap-2 flex-1">
                <FileSearch size={16} className="text-docuflow-secondary" /> Mes demandes en cours
              </h3>
              <Link to="/demandes/nouvelle?liste=1" className="text-sm font-bold text-slate-500 hover:text-docuflow-secondary inline-flex items-center gap-1.5">
                <ListChecks size={15} /> Demander une liste (Excel)
              </Link>
            </div>
            {mesDemandes === null ? <Chargement /> : enCours.length ? (
              <ul className="divide-y divide-slate-100">
                {enCours.slice(0, 8).map((d) => {
                  const e = etatDemande(d);
                  return (
                    <li key={d.id} className="py-3 flex items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-800 line-clamp-2">{intitule(d)}</div>
                        <div className="text-xs text-slate-400 truncate">{[references(d), d.motif].filter(Boolean).join(' · ') || 'Sans référence'}</div>
                      </div>
                      <Pastille ton={e.ton}>{e.texte}</Pastille>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-400 py-2">Aucune demande en cours.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default AccueilAfgc;
