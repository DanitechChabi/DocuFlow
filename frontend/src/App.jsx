import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import SuperAdminPage from './pages/SuperAdminPage';
import ProfilePage from './pages/ProfilePage';
import AboutPage from './pages/AboutPage';
import MessagingFloatingButton from './components/MessagingFloatingButton';
import { SettingsProvider } from './contexts/SettingsContext';
import { authService } from './services/authService';

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
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/super-admin-portal"
          element={
            <ProtectedRoute allowedRoles={['superadmin']}>
              <SuperAdminPage />
            </ProtectedRoute>
          }
        />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
      <MessagingFloatingButton />
      </SettingsProvider>
    </Router>
  );
}

export default App;
