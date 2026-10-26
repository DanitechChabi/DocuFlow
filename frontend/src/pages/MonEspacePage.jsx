import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  UserCircle, ListChecks, Star, CalendarClock, Search, FileText, Bell, ArrowRight, CheckCircle2, Pin, BellRing,
  ClipboardList, FileSearch,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { circuitService } from '../services/circuitService';
import { collaborationService } from '../services/collaborationService';
import { rechercheService } from '../services/rechercheService';
import { documentService } from '../services/documentService';
import { notificationService } from '../services/notificationService';
import { requestService } from '../services/requestService';
import { authService } from '../services/authService';
import { usePermissions } from '../hooks/usePermissions';
import { useTitrePage } from '../hooks/useTitrePage';

// ============================================================================
// Mon espace — tout ce qui concerne l'utilisateur, sur un seul écran :
// visas qui l'attendent, favoris, échéances qui lui sont adressées,
// recherches enregistrées, derniers documents et notifications non lues.
// Chaque carte se charge seule : une source indisponible n'empêche pas les
// autres de s'afficher.
// ============================================================================

const dateFr = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '');
const quandCourt = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '');

/** Charge une source ; null pendant le chargement, [] en cas d'échec. */
const useSource = (actif, fn) => {
  const [donnees, setDonnees] = useState(actif ? null : []);
  useEffect(() => {
    if (!actif) return undefined;
    let vivant = true;
    fn().then((d) => vivant && setDonnees(d || [])).catch(() => vivant && setDonnees([]));
    return () => { vivant = false; };
  }, [actif]); // eslint-disable-line react-hooks/exhaustive-deps
  return donnees;
};

const Carte = ({ titre, icone: Icone, teinte, lien, lienLibelle = 'Tout voir', total, tour, children }) => (
  <section className="glass-card-premium p-5 flex flex-col min-h-[220px]" data-tour={tour}>
    <header className="flex items-center justify-between gap-2 mb-3">
      <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${teinte}`}><Icone size={16} /></span>
        {titre}
        {total > 0 && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold">{total}</span>}
      </h2>
      {lien && (
        <Link to={lien} className="text-xs font-bold text-docuflow-secondary flex items-center gap-1 hover:underline flex-shrink-0">
          {lienLibelle} <ArrowRight size={12} />
        </Link>
      )}
    </header>
    <div className="flex-1">{children}</div>
  </section>
);

const Squelette = () => <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-xl skeleton" />)}</div>;
const Vide = ({ children }) => (
  <p className="text-xs text-slate-400 flex items-center gap-1.5 py-6 justify-center text-center"><CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" /> {children}</p>
);
const Ligne = ({ to, titre, detail, droite, alerte }) => (
  <li>
    <Link to={to} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800 truncate">{titre}</span>
        {detail && <span className="block text-[11px] text-slate-500 truncate">{detail}</span>}
      </span>
      {droite && <span className={`text-[11px] font-bold flex-shrink-0 ${alerte ? 'text-red-600' : 'text-slate-400'}`}>{droite}</span>}
    </Link>
  </li>
);

const MAX = 5;
const EN_COURS = (r) => !['livré', 'rejete', 'annulé'].includes(r.statut);
const STATUT_DEMANDE = { 'en attente': 'En attente', 'a traiter': 'À traiter', transmis: 'Transmis' };
const objetDemande = (r) => r.description || [r.type_document, r.nom_entreprise].filter(Boolean).join(' — ') || `Demande n° ${r.id}`;

const MonEspacePage = () => {
  useTitrePage('Mon espace');
  const { can } = usePermissions();
  const user = authService.getCurrentUser();
  const docs = can('documents.view');
  const traite = can('requests.process');
  const demande = can('requests.view');

  const taches = useSource(docs, () => circuitService.mesTaches('a_traiter'));
  const favoris = useSource(docs, () => collaborationService.favoris());
  const echeances = useSource(docs, () => rechercheService.echeancier('a_venir')
    .then((l) => (l || []).filter((e) => !e.destinataire_id || String(e.destinataire_id) === String(user?.id))));
  const recherches = useSource(docs, () => rechercheService.recherches()
    .then((l) => [...(l || [])].sort((a, b) => Number(!!b.epinglee) - Number(!!a.epinglee))));
  const recents = useSource(docs, () => documentService.getDocuments({ mes_documents: '1', page_size: MAX })
    .then((r) => r?.documents || []));
  const demandesATraiter = useSource(traite, () => requestService.getMyTasks().then((l) => (l || []).filter(EN_COURS)));
  const mesDemandes = useSource(demande, () => requestService.getMyRequests().then((l) => (l || []).filter(EN_COURS)));
  const notifications = useSource(true, () => notificationService.getNotifications()
    .then((l) => (l || []).filter((n) => !n.is_read)));

  const prenom = (user?.full_name || '').split(' ')[0];
  const nbTaches = taches?.length || 0;
  const nbEcheances = echeances?.filter((e) => e.en_retard).length || 0;
  const nbDemandes = demandesATraiter?.length || 0;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1200px] mx-auto">
      <PageHeader
        title="Mon espace"
        subtitle={prenom ? `${prenom}, voici ce qui vous concerne aujourd'hui` : 'Ce qui vous concerne aujourd\'hui'}
        icon={UserCircle}
        breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Mon espace' }]}
      />

      {taches !== null && echeances !== null && demandesATraiter !== null && (
        <p className="mb-5 text-sm text-slate-600" data-tour="mon-espace-resume">
          {nbTaches === 0 && nbEcheances === 0 && nbDemandes === 0
            ? 'Rien d\'urgent : aucune demande à traiter, aucun visa en attente, aucune échéance dépassée.'
            : [nbDemandes > 0 && `${nbDemandes} demande(s) à traiter`, nbTaches > 0 && `${nbTaches} visa(s) en attente`, nbEcheances > 0 && `${nbEcheances} échéance(s) dépassée(s)`].filter(Boolean).join(' · ')}
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {traite && (
          <Carte titre="Demandes à traiter" icone={ClipboardList} teinte="bg-orange-50 text-orange-600" lien="/demandes/a-traiter" total={nbDemandes} tour="mon-espace-demandes">
            {demandesATraiter === null ? <Squelette /> : demandesATraiter.length === 0 ? <Vide>Aucune demande ne vous attend.</Vide> : (
              <ul className="space-y-0.5">
                {demandesATraiter.slice(0, MAX).map((r) => (
                  <Ligne key={r.id} to="/demandes/a-traiter" titre={objetDemande(r)}
                    detail={[r.requester_name, STATUT_DEMANDE[r.statut]].filter(Boolean).join(' · ')}
                    droite={quandCourt(r.created_at)} alerte={r.priorite === 'urgente' || r.priorite === 'haute'} />
                ))}
              </ul>
            )}
          </Carte>
        )}

        {demande && (
          <Carte titre="Mes demandes en cours" icone={FileSearch} teinte="bg-sky-50 text-sky-600" lien="/demandes/mes-demandes" total={mesDemandes?.length} tour="mon-espace-mes-demandes">
            {mesDemandes === null ? <Squelette /> : mesDemandes.length === 0 ? <Vide>Aucune demande en cours.</Vide> : (
              <ul className="space-y-0.5">
                {mesDemandes.slice(0, MAX).map((r) => (
                  <Ligne key={r.id} to="/demandes/mes-demandes" titre={objetDemande(r)}
                    detail={[STATUT_DEMANDE[r.statut], r.assignee_name && `suivie par ${r.assignee_name}`].filter(Boolean).join(' · ')}
                    droite={quandCourt(r.created_at)} />
                ))}
              </ul>
            )}
          </Carte>
        )}

        {docs && (
          <Carte titre="Mes tâches" icone={ListChecks} teinte="bg-amber-50 text-amber-600" lien="/documents/taches" total={nbTaches} tour="mon-espace-taches">
            {taches === null ? <Squelette /> : taches.length === 0 ? <Vide>Aucun document n'attend votre visa.</Vide> : (
              <ul className="space-y-0.5">
                {taches.slice(0, MAX).map((t) => (
                  <Ligne key={t.id} to={`/documents/taches`} titre={t.reference}
                    detail={`« ${t.circuit_nom} » · ${t.etape_libelle}`} />
                ))}
              </ul>
            )}
          </Carte>
        )}

        {docs && (
          <Carte titre="Échéances" icone={CalendarClock} teinte="bg-red-50 text-red-600" lien="/documents/echeances" total={echeances?.length} tour="mon-espace-echeances">
            {echeances === null ? <Squelette /> : echeances.length === 0 ? <Vide>Aucune échéance à venir.</Vide> : (
              <ul className="space-y-0.5">
                {echeances.slice(0, MAX).map((e) => (
                  <Ligne key={e.id} to={`/documents/liste?doc=${e.document_id}`} titre={e.libelle}
                    detail={e.reference_mfile} droite={dateFr(e.date_echeance)} alerte={e.en_retard} />
                ))}
              </ul>
            )}
          </Carte>
        )}

        <Carte titre="Notifications non lues" icone={Bell} teinte="bg-blue-50 text-blue-600" total={notifications?.length} tour="mon-espace-notifications">
          {notifications === null ? <Squelette /> : notifications.length === 0 ? <Vide>Vous êtes à jour.</Vide> : (
            <ul className="space-y-0.5">
              {notifications.slice(0, MAX).map((n) => (
                <Ligne key={n.id} to={n.document_id ? `/documents/liste?doc=${n.document_id}` : '/profile'}
                  titre={n.title} detail={n.message} droite={quandCourt(n.created_at)} />
              ))}
            </ul>
          )}
        </Carte>

        {docs && (
          <Carte titre="Mes favoris" icone={Star} teinte="bg-yellow-50 text-yellow-600" lien="/documents/favoris" total={favoris?.length} tour="mon-espace-favoris">
            {favoris === null ? <Squelette /> : favoris.length === 0 ? <Vide>Marquez un document d'une étoile pour le retrouver ici.</Vide> : (
              <ul className="space-y-0.5">
                {favoris.slice(0, MAX).map((d) => (
                  <Ligne key={d.id} to={`/documents/liste?doc=${d.id}`} titre={d.reference_mfile}
                    detail={[d.nom_entreprise, d.type_document].filter(Boolean).join(' · ')} />
                ))}
              </ul>
            )}
          </Carte>
        )}

        {docs && (
          <Carte titre="Mes recherches" icone={Search} teinte="bg-violet-50 text-violet-600" lien="/documents/recherche" lienLibelle="Rechercher" total={recherches?.length} tour="mon-espace-recherches">
            {recherches === null ? <Squelette /> : recherches.length === 0 ? <Vide>Enregistrez une recherche avancée pour la relancer d'un clic.</Vide> : (
              <ul className="space-y-0.5">
                {recherches.slice(0, MAX).map((r) => (
                  <Ligne key={r.id} to={`/documents/recherche?r=${r.id}`} titre={r.nom}
                    detail={r.proprietaire === false ? `Partagée par ${r.auteur || 'un collègue'}` : r.description}
                    droite={r.alerte ? <BellRing size={13} /> : r.epinglee ? <Pin size={13} /> : null} />
                ))}
              </ul>
            )}
          </Carte>
        )}

        {docs && (
          <Carte titre="Mes derniers documents" icone={FileText} teinte="bg-emerald-50 text-emerald-600" lien="/documents/liste" total={0} tour="mon-espace-recents">
            {recents === null ? <Squelette /> : recents.length === 0 ? <Vide>Vous n'avez encore déposé aucun document.</Vide> : (
              <ul className="space-y-0.5">
                {recents.map((d) => (
                  <Ligne key={d.id} to={`/documents/liste?doc=${d.id}`} titre={d.reference_mfile}
                    detail={[d.nom_entreprise, d.type_document].filter(Boolean).join(' · ')} droite={quandCourt(d.created_at)} />
                ))}
              </ul>
            )}
          </Carte>
        )}
      </div>
    </div>
  );
};

export default MonEspacePage;
