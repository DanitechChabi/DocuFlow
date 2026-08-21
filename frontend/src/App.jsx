import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import CompanyRegisterPage from './pages/CompanyRegisterPage';
import Dashboard from './pages/Dashboard';
import DocumentsPage from './pages/DocumentsPage';
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
import { LicenseProvider, useLicense } from './contexts/LicenseContext';
import { authService } from './services/authService';
import ErrorBoundary from './components/ErrorBoundary';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const user = authService.getCurrentUser();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
};

/**
 * Renvoie vers l'écran de licence quand l'abonnement du poste ne permet plus
 * l'accès (version bureau uniquement).
 *
 * PAS DE BOUCLE DE REDIRECTION : /license est déclarée hors de ProtectedRoute,
 * donc elle ne renvoie jamais vers /login, et cette garde ne s'applique qu'aux
 * routes métier. Un poste sans licence peut ainsi se connecter puis atterrir sur
 * l'écran d'activation, sans jamais rebondir entre les deux.
 *
 * Sur le web, `allowed` vaut toujours vrai (LicenseProvider est inerte) : ce
 * composant y est donc un simple passe-plat, sans requête ni redirection.
 */
const LicenseGate = ({ children }) => {
  const { allowed, loading } = useLicense();
  // `loading` protège le tout premier rendu : l'état initial est permissif, mais
  // rediriger pendant la vérification ferait clignoter l'écran d'activation
  // devant un client parfaitement à jour.
  if (!loading && !allowed) return <Navigate to="/license" replace />;
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
  const { allowed } = useLicense();
  if (!allowed) return null;
  return <MessagingFloatingButton />;
};

function App() {
  return (
    <Router>
      <SettingsProvider>
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

        {/* Layout partagé : topbar horizontale + contenu */}
        <Route element={<ProtectedRoute><LicenseGate><AppLayout /></LicenseGate></ProtectedRoute>}>
          <Route path="/dashboard" element={<Dashboard tab="dashboard" />} />
          <Route path="/dashboard/requests" element={<Dashboard tab="requests" />} />
          <Route path="/dashboard/tasks" element={<Dashboard tab="my_tasks" />} />
          <Route path="/dashboard/history" element={<Dashboard tab="history" />} />
          <Route path="/dashboard/all" element={<Dashboard tab="all_requests" />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/super-admin-portal" element={<ProtectedRoute allowedRoles={['superadmin']}><SuperAdminPage /></ProtectedRoute>} />
          <Route path="/admin-portal" element={<ProtectedRoute allowedRoles={['superadmin']}><CompanyAdminPage /></ProtectedRoute>} />
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

        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
      <FloatingLayer />
      <ToastContainer />
      </ErrorBoundary>
      </LicenseProvider>
      </SettingsProvider>
    </Router>
  );
}

export default App;
