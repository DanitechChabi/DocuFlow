import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import ChoisirMotDePasse from './pages/ChoisirMotDePasse';
import RegisterPage from './pages/RegisterPage';
import CompanyRegisterPage from './pages/CompanyRegisterPage';
import Dashboard from './pages/Dashboard';
import HomePage from './pages/HomePage';
import MonEspacePage from './pages/MonEspacePage';
import BordereauImprimablePage from './pages/BordereauImprimablePage';
import RapportAnnuelPage from './pages/RapportAnnuelPage';
import RepertoirePage from './pages/RepertoirePage';
import EtiquettesPage from './pages/EtiquettesPage';
import SaisieTableauPage from './pages/SaisieTableauPage';
import OutilsGestionPage from './pages/OutilsGestionPage';
import ArchivothequePage from './pages/ArchivothequePage';
import ArchivothequeGestionPage from './pages/ArchivothequeGestionPage';
import PortailCitoyenPage from './pages/PortailCitoyenPage';
import AffichePortailPage from './pages/AffichePortailPage';
import CourrierPage from './pages/CourrierPage';
import CourrierNouveauPage from './pages/CourrierNouveauPage';
import CourrierFichePage from './pages/CourrierFichePage';
import CourrierRegistrePage from './pages/CourrierRegistrePage';
import VerificationCopiePage from './pages/VerificationCopiePage';
import MagasinsPage from './pages/MagasinsPage';
import RecolementPvPage from './pages/RecolementPvPage';
import DocumentsPage from './pages/DocumentsPage';
import CorbeillePage from './pages/CorbeillePage';
import PretsPage from './pages/PretsPage';
import IndexationPage from './pages/IndexationPage';
import SuperAdminPage from './pages/SuperAdminPage';
import CompanyAdminPage from './pages/CompanyAdminPage';
import ClassesPage from './pages/ClassesPage';
import ConformitePage from './pages/ConformitePage';
import FournisseursPage from './pages/FournisseursPage';
import ArchivagePage from './pages/ArchivagePage';
import CertificatPage from './pages/CertificatPage';
import FavorisPage from './pages/FavorisPage';
import PartagePublicPage from './pages/PartagePublicPage';
import MesTachesPage from './pages/MesTachesPage';
import CircuitsPage from './pages/CircuitsPage';
import RecherchePage from './pages/RecherchePage';
import EcheancesPage from './pages/EcheancesPage';
import ProcesVerbalPage from './pages/ProcesVerbalPage';
import AdminAuditLogsPage from './pages/AdminAuditLogsPage';
import ProfilePage from './pages/ProfilePage';
import AboutPage from './pages/AboutPage';
import PrivacyPage from './pages/PrivacyPage';
import LicensePage from './pages/LicensePage';
import NotFoundPage from './pages/NotFoundPage';
import AppLayout from './layouts/AppLayout';
import MessagingFloatingButton from './components/MessagingFloatingButton';
import ToastContainer from './components/Toast';
import { ConfirmerHote } from './components/Confirmer';
import { SettingsProvider } from './contexts/SettingsContext';
import { PermissionsProvider } from './hooks/usePermissions';
import { LicenseProvider, useLicense } from './contexts/LicenseContext';
import { authService } from './services/authService';
import ErrorBoundary from './components/ErrorBoundary';
import LicenseGuard from './components/LicenseGuard';
import { edition } from './editions';

// Accueil d'une édition dédiée (ex. AFGC), chargé à la demande : la plateforme
// générale n'en télécharge rien.
const AccueilEdition = edition?.accueil ? lazy(edition.accueil) : null;

// Écrans qu'une édition substitue à ceux de DocuFlow, adresse par adresse.
const PAGES_EDITION = Object.fromEntries(
  Object.entries(edition?.pages || {}).map(([chemin, charger]) => [chemin, lazy(charger)])
);
// Écrans PROPRES à une édition, à des adresses que la plateforme générale
// n'a pas (ex. l'entrée des dossiers de l'AFGC).
const ROUTES_EDITION = Object.entries(edition?.routes || {}).map(([chemin, charger]) => [chemin, lazy(charger)]);
/** L'écran de l'édition pour cette adresse s'il en existe un, sinon celui de DocuFlow. */
const ecran = (chemin, defaut) => {
  const Page = PAGES_EDITION[chemin];
  return Page ? <Suspense fallback={null}><Page /></Suspense> : defaut;
};

const ProtectedRoute = ({ children, allowedRoles }) => {
  const user = authService.getCurrentUser();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  // Mot de passe provisoire (061) : rien d'autre tant qu'il n'est pas remplacé.
  if (user.mdp_a_changer) return <Navigate to="/mot-de-passe" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
};

/**
 * Éléments flottants communs (messagerie), masqués tant que la licence bloque.
 *
 * Sans cette garde, le bouton de messagerie resterait affiché par-dessus l'écran
 * d'activation et son minuteur interrogerait l'API toutes les 30 secondes — donc
 * une rafale de 402 en boucle, et un bouton qui ne peut rien ouvrir.
 */
const FloatingLayer = () => {
  const license = useLicense();
  if (!license || !license.allowed) return null;
  return <MessagingFloatingButton />;
};

function App() {
  return (
    <Router>
      <SettingsProvider>
      <PermissionsProvider>
      <LicenseProvider>
      <ErrorBoundary>
      <Routes>
        <Route path="/login" element={ecran('/login', <LoginPage />)} />
        <Route path="/mot-de-passe" element={<ChoisirMotDePasse />} />
        <Route path="/:slug/login" element={<LoginPage />} />
        <Route path="/register" element={ecran('/register', <RegisterPage />)} />
        <Route path="/:slug/register" element={<RegisterPage />} />
        {/* Le site d'une édition dédiée sert une seule organisation : on n'y
            crée pas d'autre espace entreprise. */}
        <Route path="/register-company" element={edition ? <Navigate to="/login" replace /> : <CompanyRegisterPage />} />
        <Route path="/about" element={<AboutPage />} />
        {/* Lien de partage public (033) : hors connexion, hors mise en page. */}
        <Route path="/partage/:jeton" element={<PartagePublicPage />} />
        {/* Portail citoyen et vérification des copies (040) : publics. */}
        <Route path="/portail/:slug" element={<PortailCitoyenPage />} />
        {/* Archivothèque virtuelle (045) : vitrine publique, hors connexion. */}
        <Route path="/archivotheque/:slug" element={<ArchivothequePage />} />
        <Route path="/verifier/:jeton" element={<VerificationCopiePage />} />
        <Route path="/privacy" element={<PrivacyPage type="privacy" />} />
        <Route path="/cookies" element={<PrivacyPage type="cookies" />} />
        {/* Hors ProtectedRoute : au premier lancement d'un poste sans licence,
            aucune session n'existe encore et l'écran d'activation doit rester
            atteignable. Il n'affiche aucune donnée métier. */}
        <Route path="/license" element={<LicensePage />} />

        {/* Layout partagé : sidebar à deux modules + barre d'outils + contenu */}
        <Route element={<ProtectedRoute><LicenseGuard><AppLayout /></LicenseGuard></ProtectedRoute>}>
          {/* Accueil global — vision synthétique des deux modules ; sur le site
              d'une édition dédiée, son accueil propre. */}
          <Route path="/" element={AccueilEdition ? <Suspense fallback={null}><AccueilEdition /></Suspense> : <HomePage />} />
          <Route path="/mon-espace" element={<MonEspacePage />} />

          {/* Module DEMANDES — les anciennes routes /dashboard/* redirigent
              (liens partagés, favoris, tour guidé) : la page est la même. */}
          <Route path="/demandes" element={<Dashboard tab="overview" />} />
          <Route path="/demandes/portail/affiche" element={<AffichePortailPage />} />
          {/* Courrier — bureau d'ordre (041) */}
          <Route path="/courrier" element={<CourrierPage />} />
          <Route path="/courrier/nouveau" element={<CourrierNouveauPage />} />
          <Route path="/courrier/registre" element={<CourrierRegistrePage />} />
          <Route path="/courrier/:id" element={<CourrierFichePage />} />
          <Route path="/demandes/mes-demandes" element={ecran('/demandes/mes-demandes', <Dashboard tab="requests" />)} />
          <Route path="/demandes/nouvelle" element={ecran('/demandes/nouvelle', <Dashboard tab="requests" nouveau />)} />
          <Route path="/demandes/a-traiter" element={ecran('/demandes/a-traiter', <Dashboard tab="my_tasks" />)} />
          <Route path="/demandes/historique" element={<Dashboard tab="history" />} />
          <Route path="/demandes/toutes" element={<Dashboard tab="all_requests" />} />
          <Route path="/demandes/prets" element={ecran('/demandes/prets', <PretsPage />)} />
          <Route path="/dashboard" element={<Navigate to="/demandes" replace />} />
          <Route path="/dashboard/requests" element={<Navigate to="/demandes/mes-demandes" replace />} />
          <Route path="/dashboard/tasks" element={<Navigate to="/demandes/a-traiter" replace />} />
          <Route path="/dashboard/history" element={<Navigate to="/demandes/historique" replace />} />
          <Route path="/dashboard/all" element={<Navigate to="/demandes/toutes" replace />} />

          {/* Module DOCUMENTS — vue d'ensemble, liste (recherche/filtres),
              file « à indexer », archives. L'ancien /documents redirige. */}
          <Route path="/documents" element={<DocumentsPage vue="ensemble" />} />
          <Route path="/documents/liste" element={<DocumentsPage />} />
          <Route path="/documents/a-indexer" element={<DocumentsPage statutFiltre="à indexer" />} />
          <Route path="/documents/a-indexer/poste" element={<IndexationPage />} />
          <Route path="/documents/classes" element={<ClassesPage />} />
          <Route path="/documents/conformite" element={<ConformitePage />} />
          <Route path="/documents/fournisseurs" element={<FournisseursPage />} />
          <Route path="/documents/archivage" element={<ArchivagePage />} />
          <Route path="/documents/certificat/:id" element={<CertificatPage />} />
          <Route path="/documents/favoris" element={<FavorisPage />} />
          <Route path="/documents/taches" element={<MesTachesPage />} />
          <Route path="/documents/circuits" element={<CircuitsPage />} />
          <Route path="/documents/recherche" element={<RecherchePage />} />
          <Route path="/documents/echeances" element={<EcheancesPage />} />
          <Route path="/documents/archivage/bordereaux/:id/pv" element={<ProcesVerbalPage />} />
          <Route path="/documents/archivage/bordereaux/:id/imprimer" element={<BordereauImprimablePage type="elimination" />} />
          <Route path="/documents/archivage/versements/:id/imprimer" element={<BordereauImprimablePage type="versement" />} />
          <Route path="/documents/archivage/rapport/:annee" element={<RapportAnnuelPage />} />
          <Route path="/documents/magasins" element={<MagasinsPage />} />
          <Route path="/documents/magasins/recolements/:id/pv" element={<RecolementPvPage />} />
          <Route path="/documents/magasins/:id/repertoire" element={<RepertoirePage />} />
          <Route path="/documents/magasins/:id/etiquettes" element={<EtiquettesPage />} />
          <Route path="/documents/saisie" element={<SaisieTableauPage />} />
          <Route path="/documents/outils" element={<OutilsGestionPage />} />
          <Route path="/documents/archivotheque" element={<ArchivothequeGestionPage />} />
          <Route path="/documents/archives" element={<DocumentsPage statutFiltre="archivé" />} />
          <Route path="/documents/corbeille" element={<CorbeillePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/super-admin-portal" element={<ProtectedRoute allowedRoles={['superadmin']}><SuperAdminPage /></ProtectedRoute>} />
          <Route path="/admin-portal" element={<ProtectedRoute allowedRoles={['superadmin', 'admin']}><CompanyAdminPage /></ProtectedRoute>} />
          <Route path="/admin/audit-logs" element={<ProtectedRoute allowedRoles={['admin', 'superadmin']}><AdminAuditLogsPage /></ProtectedRoute>} />
          {ROUTES_EDITION.map(([chemin, Page]) => (
            <Route key={chemin} path={chemin} element={<Suspense fallback={null}><Page /></Suspense>} />
          ))}
        </Route>

        {/* Adresse inconnue — UNE SEULE route, déclarée en dernier.

            Une seconde `path="*"` placée à l'intérieur du layout aurait été
            inutile : à score de correspondance égal, React Router conserve
            l'ordre de déclaration, donc la route interne aurait capté toutes les
            adresses inconnues et celle-ci n'aurait jamais servi. Pire, la route
            interne étant sous ProtectedRoute, un visiteur ayant fait une faute
            de frappe sur /about aurait été redirigé vers l'écran de connexion —
            ce qui se lit comme « il faut un compte pour lire cette page », alors
            que la page est publique et que l'adresse était simplement fausse.

            NotFoundPage affiche donc elle-même la topbar quand une session
            existe : l'orientation est préservée dans les deux cas, sans dupliquer
            le layout ni déclencher les appels réseau de ses panneaux flottants. */}
        <Route path="*" element={<NotFoundPage />} />

      </Routes>
      <FloatingLayer />
      <ToastContainer />
      <ConfirmerHote />
      </ErrorBoundary>
      </LicenseProvider>
      </PermissionsProvider>
      </SettingsProvider>
    </Router>
  );
}

export default App;
