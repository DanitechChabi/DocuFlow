import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import CompanyRegisterPage from './pages/CompanyRegisterPage';
import Dashboard from './pages/Dashboard';
import HomePage from './pages/HomePage';
import DocumentsPage from './pages/DocumentsPage';
import CorbeillePage from './pages/CorbeillePage';
import SuperAdminPage from './pages/SuperAdminPage';
import CompanyAdminPage from './pages/CompanyAdminPage';
import AdminAuditLogsPage from './pages/AdminAuditLogsPage';
import ProfilePage from './pages/ProfilePage';
import AboutPage from './pages/AboutPage';
import PrivacyPage from './pages/PrivacyPage';
import LicensePage from './pages/LicensePage';
import NotFoundPage from './pages/NotFoundPage';
import AppLayout from './layouts/AppLayout';
import MessagingFloatingButton from './components/MessagingFloatingButton';
import ToastContainer from './components/Toast';
import { SettingsProvider } from './contexts/SettingsContext';
import { PermissionsProvider } from './hooks/usePermissions';
import { LicenseProvider, useLicense } from './contexts/LicenseContext';
import { authService } from './services/authService';
import ErrorBoundary from './components/ErrorBoundary';
import LicenseGuard from './components/LicenseGuard';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const user = authService.getCurrentUser();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
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
        <Route path="/login" element={<LoginPage />} />
        <Route path="/:slug/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/:slug/register" element={<RegisterPage />} />
        <Route path="/register-company" element={<CompanyRegisterPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/privacy" element={<PrivacyPage type="privacy" />} />
        <Route path="/cookies" element={<PrivacyPage type="cookies" />} />
        {/* Hors ProtectedRoute : au premier lancement d'un poste sans licence,
            aucune session n'existe encore et l'écran d'activation doit rester
            atteignable. Il n'affiche aucune donnée métier. */}
        <Route path="/license" element={<LicensePage />} />

        {/* Layout partagé : sidebar à deux modules + barre d'outils + contenu */}
        <Route element={<ProtectedRoute><LicenseGuard><AppLayout /></LicenseGuard></ProtectedRoute>}>
          {/* Accueil global — vision synthétique des deux modules */}
          <Route path="/" element={<HomePage />} />

          {/* Module DEMANDES — les anciennes routes /dashboard/* redirigent
              (liens partagés, favoris, tour guidé) : la page est la même. */}
          <Route path="/demandes" element={<Dashboard tab="overview" />} />
          <Route path="/demandes/mes-demandes" element={<Dashboard tab="requests" />} />
          <Route path="/demandes/nouvelle" element={<Dashboard tab="requests" nouveau />} />
          <Route path="/demandes/a-traiter" element={<Dashboard tab="my_tasks" />} />
          <Route path="/demandes/historique" element={<Dashboard tab="history" />} />
          <Route path="/demandes/toutes" element={<Dashboard tab="all_requests" />} />
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
          <Route path="/documents/archives" element={<DocumentsPage statutFiltre="archivé" />} />
          <Route path="/documents/corbeille" element={<CorbeillePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/super-admin-portal" element={<ProtectedRoute allowedRoles={['superadmin']}><SuperAdminPage /></ProtectedRoute>} />
          <Route path="/admin-portal" element={<ProtectedRoute allowedRoles={['superadmin', 'admin']}><CompanyAdminPage /></ProtectedRoute>} />
          <Route path="/admin/audit-logs" element={<ProtectedRoute allowedRoles={['admin', 'superadmin']}><AdminAuditLogsPage /></ProtectedRoute>} />
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
      </ErrorBoundary>
      </LicenseProvider>
      </PermissionsProvider>
      </SettingsProvider>
    </Router>
  );
}

export default App;
