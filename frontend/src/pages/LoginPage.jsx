import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authService } from '../services/authService';
import { useSettings } from '../contexts/SettingsContext';
import { LogIn, User, Lock, AlertCircle, Eye, EyeOff } from 'lucide-react';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const navigate = useNavigate();
  const settings = useSettings();
  const logoSrc = settings.site_logo_url || 'https://th.bing.com/th/id/R.d7f2f165ad7ca819fe72a5f20a08a7c7?rik=cmptSS4F09F1Hw&riu=http%3a%2f%2fapiga.africa%2fimg%2fafgc.jpg&ehk=BW9PLt5Ge5oLmVWHbZvaEzZCStjt7IWIJj4n%2bEJym5M%3d&risl=&pid=ImgRaw&r=0';

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authService.login(username, password);
      if (data.token) {
        navigate('/dashboard');
      } else {
        setError('Identifiants invalides');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Une erreur est survenue lors de la connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden p-4">
      {/* Animated background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none"></div>

      {/* Glow orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-500/10 rounded-full blur-3xl pointer-events-none animate-float"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none animate-float delay-300"></div>

      <div className="max-w-md w-full animate-fade-in-up relative z-10">
        {/* Logo section */}
        <div className="text-center mb-8">
          <div className="relative inline-flex mb-5">
            <div className="absolute -inset-2 bg-gradient-to-r from-afgc-secondary to-blue-400 rounded-full blur-xl opacity-40 animate-glow-pulse"></div>
            <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-afgc-secondary to-blue-600 shadow-lg flex items-center justify-center">
              <img
                src={logoSrc}
                alt="Logo"
                className="w-16 h-16 rounded-full border-2 border-white/40 shadow-inner object-cover"
              />
            </div>
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            {settings.site_name || 'DocuFlow'}
          </h1>
          <p className="text-slate-400 text-sm mt-1 font-medium">{settings.site_description || 'Plateforme de gestion documentaire'}</p>
        </div>

        <div className="glass-card-premium p-8 shadow-elevated">
          {error && (
            <div className="mb-6 p-4 bg-red-50/80 backdrop-blur-sm text-red-600 rounded-xl border border-red-200 text-sm font-bold flex items-center gap-3 animate-fade-in-down">
              <AlertCircle size={18} className="flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Identifiant</label>
              <div className="relative group">
                <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-afgc-secondary transition-colors pointer-events-none" />
                <input
                  type="text"
                  className="input-premium pl-11"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder="Nom d'utilisateur"
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Mot de passe</label>
              <div className="relative group">
                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-afgc-secondary transition-colors pointer-events-none" />
                <input
                  type={showPwd ? 'text' : 'password'}
                  className="input-premium pl-11 pr-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 text-base py-3.5 relative overflow-hidden group"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Connexion en cours...</span>
                </div>
              ) : (
                <span className="flex items-center gap-2">
                  <LogIn size={20} />
                  Se connecter
                </span>
              )}
              {!loading && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-500">
              Pas encore de compte ?{' '}
              <Link to="/register" className="text-afgc-secondary font-bold hover:text-blue-700 transition-colors underline-offset-4 hover:underline">
                S'inscrire maintenant
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center mt-6 text-[10px] text-slate-400 font-medium tracking-wider flex items-center justify-center gap-2">
          &copy; {new Date().getFullYear()} ARCHICORP — Tous droits réservés
          <span className="text-slate-300">·</span>
          <Link to="/about" className="hover:text-afgc-secondary transition-colors">À propos</Link>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
