import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  PlusCircle, FileSearch, Undo2, ClipboardList, BookOpenCheck, BookOpen, Mail, Warehouse,
  ArrowRight, AlertTriangle,
} from 'lucide-react';
import { requestService } from '../../services/requestService';
import { authService } from '../../services/authService';
import { usePermissions } from '../../hooks/usePermissions';
import { useTitrePage } from '../../hooks/useTitrePage';
import { edition } from '../../editions';

// ============================================================================
// Accueil de l'édition AFGC : l'essentiel en trois boutons.
//
// Un agent n'a que trois gestes : demander un dossier, voir où en sont ses
// demandes, rendre ce qu'il a emprunté. L'archiviste, lui, traite : la file
// « à traiter », les dossiers sortis (et les retards), les registres.
// Chaque carte mène à une page existante de DocuFlow, et ses compteurs viennent
// des mêmes routes que cette page : l'accueil n'invente aucune donnée.
// ============================================================================

const TERMINAUX = new Set(['livré', 'rejete', 'annulé']);
const PRET_OUVERT = new Set(['en_cours', 'en_retard', 'signale']);

/** Libellé d'avancement d'une demande, dans les mots de l'agent. */
function avancement(d) {
  if (d.loan_etat === 'en_retard') return { texte: 'À rendre (en retard)', ton: 'rouge' };
  if (PRET_OUVERT.has(d.loan_etat)) return { texte: 'Chez vous', ton: 'vert' };
  if (d.loan_etat === 'retourne') return { texte: 'Rendu', ton: 'gris' };
  switch (d.statut) {
    case 'en attente': return { texte: 'Demandé', ton: 'ambre' };
    case 'a traiter': return { texte: 'En recherche', ton: 'ambre' };
    case 'transmis': return { texte: 'Transmis', ton: 'vert' };
    case 'livré': return { texte: 'Reçu', ton: 'gris' };
    case 'rejete': return { texte: 'Refusé', ton: 'rouge' };
    case 'annulé': return { texte: 'Annulé', ton: 'gris' };
    default: return { texte: d.statut || '—', ton: 'gris' };
  }
}

const TONS = {
  vert: 'bg-green-50 text-green-700',
  ambre: 'bg-amber-50 text-amber-700',
  rouge: 'bg-red-50 text-red-700',
  gris: 'bg-slate-100 text-slate-500',
};

/** Comment désigner un dossier : l'entreprise d'abord, sinon la description. */
function intitule(d) {
  return d.nom_entreprise || d.description || 'Dossier sans intitulé';
}

/** Références lisibles : n° de dossier, n° d'acte, année. */
function references(d) {
  return [
    d.num_dossier && `Dossier ${d.num_dossier}`,
    d.num_acte && `Acte ${d.num_acte}`,
    d.annee && String(d.annee),
  ].filter(Boolean).join(' · ');
}

const joursDeRetard = (date) => {
  if (!date) return 0;
  const ecart = Date.now() - new Date(`${String(date).slice(0, 10)}T00:00:00`).getTime();
  return Math.max(0, Math.floor(ecart / 86400000));
};

const Pastille = ({ ton = 'gris', children }) => (
  <span className={`px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5 ${TONS[ton]}`}>{children}</span>
);

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

const Chargement = () => (
  <div className="py-6 text-center"><div className="w-6 h-6 border-2 border-slate-200 border-t-docuflow-secondary rounded-full animate-spin mx-auto" /></div>
);

const AccueilAfgc = () => {
  const { can } = usePermissions();
  const user = authService.getCurrentUser();
  const traite = can('requests.process');

  const [mesDemandes, setMesDemandes] = useState(null);
  const [aTraiter, setATraiter] = useState(null);
  const [sorties, setSorties] = useState(null);

  useTitrePage('Accueil');

  const charger = useCallback(async () => {
    if (traite) {
      await Promise.all([
        requestService.getStats()
          .then((s) => setATraiter((s?.['a traiter'] || 0) + (s?.['en attente'] || 0)))
          .catch(() => setATraiter(0)),
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

  useEffect(() => { charger(); }, [charger]);

  const prenom = (user?.full_name || '').split(' ')[0] || 'bienvenue';

  // --- Agent ---
  const enCours = (mesDemandes || []).filter((d) => !TERMINAUX.has(d.statut) || PRET_OUVERT.has(d.loan_etat));
  const chezMoi = (mesDemandes || []).filter((d) => PRET_OUVERT.has(d.loan_etat));
  const aRendreEnRetard = chezMoi.filter((d) => d.loan_etat === 'en_retard').length;

  // --- Archiviste ---
  const enRetard = (sorties || []).filter((p) => p.etat === 'en_retard');

  return (
    <div className="relative p-4 md:p-8 max-w-6xl mx-auto">
      {/* En-tête : l'emblème de l'AFGC, puis le salut. */}
      <div className="flex items-center gap-4 md:gap-5 mb-8 animate-fade-in-up">
        <img src={edition?.embleme} alt="" className="w-14 h-14 md:w-16 md:h-16 object-contain flex-shrink-0" />
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Bonjour, {prenom}</h1>
          <p className="text-sm md:text-base text-slate-500">
            {traite ? 'Archives de l\'AFGC : les demandes à traiter et les dossiers sortis.' : 'Archives de l\'AFGC : demandez un dossier, suivez-le, rendez-le.'}
          </p>
        </div>
        {traite && can('requests.create') && (
          <Link to="/demandes/nouvelle" className="ml-auto hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:border-docuflow-secondary hover:text-docuflow-secondary transition-colors">
            <PlusCircle size={16} /> Demander un dossier
          </Link>
        )}
      </div>

      {traite ? (
        <>
          <div className="grid gap-5 md:grid-cols-3">
            <CarteAction
              to="/demandes/a-traiter"
              icone={ClipboardList}
              titre="À traiter"
              texte="Les demandes reçues : trouver le dossier, le remettre, noter son retour."
              principale
            >
              {aTraiter !== null && (
                <span className="px-3 py-1.5 rounded-full bg-white/20 text-white text-xs font-bold">
                  {aTraiter === 0 ? 'Rien en attente' : `${aTraiter} demande${aTraiter > 1 ? 's' : ''}`}
                </span>
              )}
            </CarteAction>
            <CarteAction
              to="/demandes/prets"
              icone={BookOpenCheck}
              titre="Dossiers sortis"
              texte="Qui a quel dossier, depuis quand, et pour quand il doit revenir."
            >
              {sorties !== null && <Pastille ton="vert">{sorties.length} sorti{sorties.length > 1 ? 's' : ''}</Pastille>}
              {enRetard.length > 0 && <Pastille ton="rouge"><AlertTriangle size={13} /> {enRetard.length} en retard</Pastille>}
            </CarteAction>
            {/* Registres : trois liens dans une même carte. */}
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
                      <div className="text-sm font-semibold text-slate-800 truncate">{intitule(p)}</div>
                      <div className="text-xs text-slate-400 truncate">{[references(p), p.emprunteur_name && `chez ${p.emprunteur_name}`].filter(Boolean).join(' · ')}</div>
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
          <div className="grid gap-5 md:grid-cols-3">
            <CarteAction
              to="/demandes/nouvelle"
              icone={PlusCircle}
              titre="Demander un dossier"
              texte="Indiquez l'entreprise ou le n° de dossier : l'archiviste est prévenu aussitôt."
              principale
            />
            <CarteAction
              to="/demandes/mes-demandes"
              icone={FileSearch}
              titre="Mes dossiers"
              texte="Où en est chacune de vos demandes, de l'envoi jusqu'au retour."
            >
              {mesDemandes !== null && <Pastille ton={enCours.length ? 'ambre' : 'gris'}>{enCours.length} en cours</Pastille>}
            </CarteAction>
            <CarteAction
              to="/demandes/mes-demandes"
              icone={Undo2}
              titre="Rendre un dossier"
              texte="Rapportez-le à l'archiviste : il note le retour, et vous n'avez plus rien à signer."
            >
              {mesDemandes !== null && <Pastille ton={chezMoi.length ? 'vert' : 'gris'}>{chezMoi.length} chez vous</Pastille>}
              {aRendreEnRetard > 0 && <Pastille ton="rouge"><AlertTriangle size={13} /> {aRendreEnRetard} en retard</Pastille>}
            </CarteAction>
          </div>

          <section className="glass-card-premium rounded-3xl p-6 mt-8 animate-fade-in-up">
            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-4">
              <FileSearch size={16} className="text-docuflow-secondary" /> Mes demandes en cours
            </h3>
            {mesDemandes === null ? <Chargement /> : enCours.length ? (
              <ul className="divide-y divide-slate-100">
                {enCours.slice(0, 6).map((d) => {
                  const a = avancement(d);
                  return (
                    <li key={d.id} className="py-3 flex items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-800 truncate">{intitule(d)}</div>
                        <div className="text-xs text-slate-400 truncate">{references(d) || 'Sans référence'}</div>
                      </div>
                      <Pastille ton={a.ton}>{a.texte}</Pastille>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-400 py-2">
                Aucune demande en cours. <Link to="/demandes/nouvelle" className="font-semibold text-docuflow-secondary hover:underline">Demander un dossier</Link>
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default AccueilAfgc;
