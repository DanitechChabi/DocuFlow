import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import CompanyRegisterPage from './pages/CompanyRegisterPage';
import Dashboard from './pages/Dashboard';
import DocumentsPage from './pages/DocumentsPage';
import SuperAdminPage from './pages/SuperAdminPage';
import CompanyAdminPage from './pages/CompanyAdminPage';
import ProfilePage from './pages/ProfilePage';
import AboutPage from './pages/AboutPage';
import AppLayout from './layouts/AppLayout';
import MessagingFloatingButton from './components/MessagingFloatingButton';
import ToastContainer from './components/Toast';
import { SettingsProvider } from './contexts/SettingsContext';
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

function App() {
  return (
    <Router>
      <SettingsProvider>
      <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/:slug/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/:slug/register" element={<RegisterPage />} />
        <Route path="/register-company" element={<CompanyRegisterPage />} />

        {/* Layout partagé : topbar horizontale + contenu */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<Dashboard tab="dashboard" />} />
          <Route path="/dashboard/requests" element={<Dashboard tab="requests" />} />
          <Route path="/dashboard/tasks" element={<Dashboard tab="my_tasks" />} />
          <Route path="/dashboard/history" element={<Dashboard tab="history" />} />
          <Route path="/dashboard/all" element={<Dashboard tab="all_requests" />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/super-admin-portal" element={<ProtectedRoute allowedRoles={['superadmin']}><SuperAdminPage /></ProtectedRoute>} />
          <Route path="/admin-portal" element={<ProtectedRoute allowedRoles={['superadmin']}><CompanyAdminPage /></ProtectedRoute>} />
          <Route path="/about" element={<AboutPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
      <MessagingFloatingButton />
      <ToastContainer />
      </ErrorBoundary>
      </SettingsProvider>
    </Router>
  );
}

export default App;
