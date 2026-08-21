import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import RequestForm from '../components/RequestForm';
import RequestTable from '../components/RequestTable';
import HistoryTable from '../components/HistoryTable';
import OnboardingTour from '../components/OnboardingTour';
import { DEFAULT_TOUR_STEPS, SUPERADMIN_TOUR_STEPS } from '../components/OnboardingTour';
import RequestDetailsModal from '../components/RequestDetailsModal';
import DashboardAnalytics from '../components/DashboardAnalytics';
import PageHeader from '../components/PageHeader';
import { requestService } from '../services/requestService';
import { requestDetailsService } from '../services/requestDetailsService';
import { authService } from '../services/authService';
import { toast } from '../components/Toast';
import {
  Plus, FileText, Package, Clock,
  AlertCircle, ArrowUpRight, RefreshCw, Search, ClipboardList, CheckCircle2,
  LayoutDashboard, History
} from 'lucide-react';

// Le squelette reproduit les dimensions exactes de `.stat-card` : hauteurs de
// libellé et de valeur, taille de la pastille. Un squelette approximatif fait
// sauter la mise en page à l'arrivée des données, ce qui se remarque plus qu'un
// écran vide.
const SkeletonCard = ({ delay = 0 }) => (
  <div className="stat-card" style={{ animationDelay: `${delay}ms` }}>
    <div className="flex-1 space-y-2">
      <div className="skeleton h-3 w-24"></div>
      <div className="skeleton h-6 w-12"></div>
    </div>
    <div className="skeleton h-9 w-9 flex-shrink-0"></div>
  </div>
);

// Onglets réservés au staff (archiviste, admin, superadmin). Hors du composant :
// une constante recréée à chaque rendu déclencherait l'effet de redirection en
// boucle si elle figurait dans ses dépendances.
const STAFF_TABS = ['my_tasks', 'history', 'all_requests'];

// Étapes du tour guidé, calculées une fois pour toutes hors du composant. Un
// littéral construit dans le corps du rendu produisait un tableau d'identité
// différente à chaque passe : le tour se réinitialisait à l'étape 1 dès le
// moindre rafraîchissement du tableau de bord.
const OWNER_TOUR_STEPS = [...DEFAULT_TOUR_STEPS, ...SUPERADMIN_TOUR_STEPS];

const Dashboard = ({ tab = 'dashboard' }) => {
  const navigate = useNavigate();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState({});
  const [logs, setLogs] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [details, setDetails] = useState(null);
  const [search, setSearch] = useState('');

  const user = authService.getCurrentUser();
  const isAdmin = user?.role === 'archiviste' || user?.role === 'admin' || user?.role === 'superadmin';

  // Onglets réservés au staff : rediriger les demandeurs
  useEffect(() => {
    if (!isAdmin && STAFF_TABS.includes(tab)) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAdmin, tab, navigate]);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const data = isAdmin
        ? await requestService.getAllRequests()
        : await requestService.getMyRequests();
      setRequests(data);
    } catch (err) {
      console.error('Erreur lors du chargement des demandes', err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  const fetchStats = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await requestService.getStats();
      setStats(data);
    } catch (err) {
      console.error('Erreur lors du chargement des stats', err);
    }
  }, [isAdmin]);

  const fetchLogs = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await requestService.getAuditLogs();
      setLogs(data);
    } catch (err) {
      console.error('Erreur lors du chargement de l\'historique', err);
    }
  }, [isAdmin]);

  const fetchTasks = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await requestService.getMyTasks();
      setTasks(data);
    } catch (err) {
      console.error('Erreur lors du chargement des tâches', err);
    }
  }, [isAdmin]);

  const refreshAll = useCallback(() => {
    fetchRequests();
    fetchStats();
    fetchLogs();
    fetchTasks();
  }, [fetchRequests, fetchStats, fetchLogs, fetchTasks]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const handleOpenDetails = async (id) => {
    setSelectedRequest(id);
    try {
      const data = await requestDetailsService.getDetails(id);
      setDetails(data);
    } catch (err) {
      toast.error('Erreur lors du chargement des détails');
    }
  };

  const handleCloseDetails = () => {
    setSelectedRequest(null);
    setDetails(null);
    refreshAll();
  };

  // Fond et texte de la pastille d'icône de chaque carte, tirés des jetons
  // sémantiques de la feuille de style plutôt que des couleurs Tailwind brutes
  // (bg-orange-50, text-purple-600…) employées jusqu'ici. Un même statut garde
  // ainsi la même couleur dans les cartes, les pastilles de tableau et les
  // graphiques, et un changement de palette se fait en un seul endroit.
  //
  // `accent` suit la couleur de l'organisation : « à traiter » n'est ni une
  // alerte ni un succès, c'est l'état sur lequel le service travaille.
  const tons = {
    warn: { background: 'var(--df-warn-bg)', color: 'var(--df-warn)' },
    accent: { background: 'var(--df-accent-05)', color: 'var(--color-docuflow-secondary)' },
    ok: { background: 'var(--df-ok-bg)', color: 'var(--df-ok)' },
    info: { background: 'var(--df-info-bg)', color: 'var(--df-info)' },
    danger: { background: 'var(--df-danger-bg)', color: 'var(--df-danger)' },
  };

  // Les clés reprennent au caractère près celles de la machine à états du
  // backend (requestStateMachine.js) — accents compris : `getStats` indexe son
  // objet sur la valeur brute de la colonne `statut`, donc `livre` sans accent
  // ne correspondrait à rien et la carte resterait figée à zéro.
  // « Livré » manquait : l'état final normal d'une demande n'était pas affiché,
  // si bien qu'une demande aboutie disparaissait des compteurs.
  const statCards = [
    { key: 'en attente', label: 'En attente', icon: Clock, ton: 'warn' },
    { key: 'a traiter', label: 'À traiter', icon: AlertCircle, ton: 'accent' },
    { key: 'transmis', label: 'Transmis', icon: ArrowUpRight, ton: 'ok' },
    { key: 'livré', label: 'Livré', icon: CheckCircle2, ton: 'info' },
    { key: 'rejete', label: 'Rejeté', icon: AlertCircle, ton: 'danger' },
  ];

  const totalRequests = requests.length;

  // Nombre de lignes réellement présentées par l'onglet courant. Le tableau du
  // bas ne montre pas les mêmes données selon l'onglet : afficher `requests`
  // partout donnerait un décompte faux sur « Mes tâches », qui lit `tasks`.
  const nbLignes = tab === 'my_tasks'
    ? tasks.length
    : tab === 'history'
      ? logs.length
      : requests.length;

  // Titre, sous-titre et fil d'Ariane de chacun des cinq onglets, réunis en une
  // table plutôt que dispersés dans le rendu.
  //
  // Le sous-titre affichait auparavant « Session active : <nom> » sur les cinq
  // onglets. C'est une information que la topbar donne déjà (avatar et menu
  // utilisateur), et qui ne dit rien de la page où l'on se trouve : la place la
  // plus visible de l'écran, sous le titre, servait donc à répéter ce qu'on savait
  // déjà. Elle décrit maintenant ce que l'onglet contient et à quoi il sert.
  const PAGES = {
    dashboard: {
      titre: 'Tableau de bord',
      sousTitre: "Vue d'ensemble de l'activité documentaire",
      icone: LayoutDashboard,
      fil: [{ label: 'Tableau de bord' }],
    },
    requests: {
      titre: 'Mes demandes',
      sousTitre: 'Les demandes que vous avez déposées, et leur avancement',
      icone: FileText,
      fil: [{ label: 'Tableau de bord', to: '/dashboard' }, { label: 'Mes demandes' }],
    },
    my_tasks: {
      titre: 'Mes tâches',
      sousTitre: 'Les demandes qui vous sont assignées et attendent votre action',
      icone: ClipboardList,
      fil: [{ label: 'Tableau de bord', to: '/dashboard' }, { label: 'Mes tâches' }],
    },
    history: {
      titre: 'Historique des flux',
      sousTitre: 'Journal chronologique des actions sur les demandes',
      icone: History,
      fil: [{ label: 'Tableau de bord', to: '/dashboard' }, { label: 'Historique' }],
    },
    all_requests: {
      titre: 'Gestion des archives',
      sousTitre: "Toutes les demandes de l'organisation, tous statuts confondus",
      icone: Package,
      fil: [{ label: 'Tableau de bord', to: '/dashboard' }, { label: 'Toutes les demandes' }],
    },
  };
  const page = PAGES[tab] || PAGES.dashboard;

  return (
    <div className="relative p-4 md:p-8 max-w-7xl mx-auto">
      <div className="fixed top-0 right-0 w-1/3 h-1/3 bg-blue-500/[0.03] rounded-full blur-3xl pointer-events-none"></div>

      <PageHeader
        title={page.titre}
        subtitle={page.sousTitre}
        icon={page.icone}
        breadcrumb={page.fil}
        actions={
          <>
            <button onClick={refreshAll} className="btn btn-secondary btn-icon" title="Rafraîchir">
              <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
            </button>
            {user?.role === 'demandeur' && (
              <div className="relative">
                {/* Halo pulsant derrière le bouton — le bouton reste net */}
                <div
                  className="absolute -inset-2 bg-gradient-to-r from-docuflow-secondary to-blue-400 rounded-full blur-xl opacity-30 animate-glow-pulse pointer-events-none"
                  aria-hidden="true"
                ></div>
                <button
                  onClick={() => setIsFormOpen(true)}
                  className="relative btn btn-primary"
                  data-tour="new-request"
                >
                  <Plus size={16} />
                  <span>Nouvelle demande</span>
                </button>
              </div>
            )}
          </>
        }
      />

      {/* Dashboard Tab */}
      {tab === 'dashboard' && (
        <>
        <div className="animate-fade-in-up">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5 mb-8 md:mb-10">
            {loading ? (
              <>
                <SkeletonCard delay={0} />
                <SkeletonCard delay={100} />
                <SkeletonCard delay={200} />
                <SkeletonCard delay={300} />
              </>
            ) : (
              <>
                <div className="stat-card animate-fade-in-up delay-100">
                  <div className="min-w-0">
                    <p className="stat-card-label">Total des demandes</p>
                    <p className="stat-card-value">{totalRequests}</p>
                  </div>
                  <div className="stat-card-icon" style={tons.accent} aria-hidden="true">
                    <FileText size={18} />
                  </div>
                </div>
                {statCards.map(({ key, label, icon: Icon, ton }, idx) => {
                  // Pour les demandeurs : stats calculées depuis leurs propres demandes
                  const count = isAdmin
                    ? (stats[key] || 0)
                    : requests.filter(r => r.statut === key).length;
                  return (
                    <div key={key} className="stat-card animate-fade-in-up"
                      style={{ animationDelay: `${(idx + 1) * 60}ms` }}>
                      <div className="min-w-0">
                        <p className="stat-card-label">{label}</p>
                        <p className="stat-card-value">{count}</p>
                      </div>
                      <div className="stat-card-icon" style={tons[ton]} aria-hidden="true">
                        <Icon size={18} />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

          {/* Analytics — admin seulement */}
          {isAdmin && tab === 'dashboard' && <DashboardAnalytics />}
      </>
      )}

          {/* Contenu principal */}
          <div className="space-y-4 animate-fade-in-up delay-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* Le titre de section n'apparaît que sur le tableau de bord, où
                    la liste n'est qu'un bloc parmi d'autres (indicateurs,
                    graphiques). Sur les onglets dédiés, la liste EST la page :
                    l'en-tête l'a déjà nommée deux centimètres plus haut, et le
                    répéter n'ajoutait rien — pire, « Mes demandes » en titre et
                    « Mes requêtes » en sous-titre désignaient la même chose avec
                    deux mots différents, ce qui laisse croire à deux listes. */}
                {tab === 'dashboard' && (
                  <h2 className="flex items-center gap-2 truncate">
                    {isAdmin
                      ? <><Package size={18} className="text-docuflow-secondary flex-shrink-0" aria-hidden="true" /> <span>File d'attente</span></>
                      : <><FileText size={18} className="text-docuflow-secondary flex-shrink-0" aria-hidden="true" /> <span>Mes requêtes</span></>
                    }
                  </h2>
                )}
                {/* Le décompte est masqué pendant une recherche : le tableau
                    filtre ses lignes, donc afficher le total ferait mentir le
                    chiffre par rapport à ce qui est visible. */}
                {!loading && !search && (
                  <span className="badge badge-neutral">
                    {nbLignes} {nbLignes > 1 ? 'entrées' : 'entrée'}
                  </span>
                )}
                {loading && (
                  <span className="flex items-center gap-2 text-sm text-slate-400">
                    <span className="w-3.5 h-3.5 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" aria-hidden="true"></span>
                    Chargement…
                  </span>
                )}
              </div>
              {tab !== 'history' && (
                <div className="relative w-full sm:w-80">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher : entreprise, dossier, acte, motif…"
                    // Le champ n'a pas d'étiquette visible : sans aria-label, un
                    // lecteur d'écran n'annonce qu'« zone de saisie ».
                    aria-label="Rechercher une demande"
                    className="input-premium pl-9"
                  />
                </div>
              )}
            </div>

            <div className="surface overflow-hidden">
              {tab === 'history' ? (
                <HistoryTable logs={logs} onRequestClick={handleOpenDetails} />
              ) : (
                <RequestTable
                  requests={tab === 'my_tasks' ? tasks : requests}
                  onOpenDetails={handleOpenDetails}
                  search={search}
                />
              )}
            </div>
          </div>

      {/* Modals */}
      <RequestForm isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} onSuccess={refreshAll} />
      {selectedRequest && (
        <RequestDetailsModal request={details?.request} history={details?.history || []} stateHistory={details?.stateHistory || []} role={user?.role} onClose={handleCloseDetails} />
      )}

      {/* Onboarding Tour — l'étape "Gestion système" n'apparaît que pour le
          propriétaire de la plateforme (tenant 1). Les superadmins d'entreprise
          ont leur propre portail scoped, pas le tour du portail global. */}
      <OnboardingTour
        steps={user?.role === 'superadmin' && user?.tenant_id === 1
          ? OWNER_TOUR_STEPS
          : DEFAULT_TOUR_STEPS}
        userId={user?.id}
        autoStart={true}
      />
    </div>
  );
};

export default Dashboard;
