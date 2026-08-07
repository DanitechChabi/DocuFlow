import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { authService } from '../services/authService';
import { googleAuthService } from '../services/googleAuthService';
import { useSettings } from '../contexts/SettingsContext';
import { LogIn, User, Lock, AlertCircle, Eye, EyeOff, Building2, Loader2 } from 'lucide-react';
import { toast } from '../components/Toast';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const navigate = useNavigate();
  const settings = useSettings();
  const { slug } = useParams();
  const googleBtnRef = useRef(null);

  // Entreprise dédiée (page /:slug/login)
  const [company, setCompany] = useState(null);
  const [companyLoading, setCompanyLoading] = useState(Boolean(slug));
  const [companyError, setCompanyError] = useState('');

  // Initialiser Google Identity Services
  useEffect(() => {
    if (!googleAuthService.isConfigured()) return;
    let mounted = true;
    (async () => {
      try {
        await googleAuthService.loadScript();
        if (mounted && googleBtnRef.current) {
          googleAuthService.renderButton(googleBtnRef.current, {
            onSuccess: async (response) => {
              try {
                setLoading(true);
                const data = await googleAuthService.loginWithCredential(response.credential);
                if (data.token) {
                  await settings.refresh();
                  navigate('/dashboard');
                }
              } catch (err) {
                setError(err.response?.data?.message || 'Erreur de connexion Google');
              } finally {
                setLoading(false);
              }
            },
          });
        }
      } catch (err) {
        console.warn('Google GIS non chargé:', err.message);
      }
    })();
    return () => { mounted = false; };
  }, [navigate, settings]);

  useEffect(() => {
    if (!slug) return;
    let mounted = true;
    authService
      .getCompany(slug)
      .then((data) => {
        if (!mounted) return;
        setCompany(data);
        setCompanyLoading(false);
      })
      .catch((err) => {
        if (!mounted) return;
        const status = err.response?.status;
        setCompanyError(
          status === 404
            ? 'Entreprise inconnue. Vérifiez le code ou créez votre espace.'
            : 'Impossible de charger cet espace. Réessayez dans un instant.'
        );
        setCompanyLoading(false);
      });
    return () => { mounted = false; };
  }, [slug]);

  const defaultLogoSrc = '/favicon.svg';
  // Branding : priorité à l'entreprise de l'URL, sinon aux réglages globaux
  const displayName = company?.settings?.site_name || company?.name || settings.site_name || 'DocuFlow';
  const displayDesc = company?.settings?.site_description || settings.site_description || 'Plateforme de gestion documentaire';
  const displayLogo = company?.settings?.site_logo_url || settings.site_logo_url || defaultLogoSrc;
  const suspended = company?.status === 'suspended';

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authService.login(username, password, slug);
      if (data.token) {
        // Recharge les réglages du tenant de l'utilisateur (branding du tableau de bord)
        await settings.refresh();
        navigate('/dashboard');
      } else {
        setError(data.message || 'Identifiants invalides');
        setLoading(false);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Une erreur est survenue lors de la connexion');
      setLoading(false);
    }
  };

  // Écran de chargement de l'entreprise (page dédiée)
  if (slug && companyLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Loader2 size={28} className="animate-spin text-docuflow-secondary" />
          <span className="text-sm font-medium">Chargement de l'espace entreprise…</span>
        </div>
      </div>
    );
  }

  // Entreprise introuvable (page dédiée)
  if (slug && companyError && !company) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden p-4">
        <div className="max-w-md w-full text-center animate-fade-in-up relative z-10">
          <div className="w-20 h-20 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-6">
            <Building2 size={36} className="text-red-500" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mb-3">Entreprise introuvable</h1>
          <p className="text-slate-500 mb-8">{companyError}</p>
          <Link to="/register-company" className="btn-primary inline-flex items-center justify-center gap-2 px-6 py-3">
            Créer mon espace entreprise
          </Link>
          <p className="mt-4">
            <Link to="/login" className="text-sm text-docuflow-secondary font-bold hover:underline">
              ← Revenir à la connexion
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-4"
      style={{ background: `linear-gradient(135deg, ${settings.accent_color || '#f8fafc'} 0%, white 50%, ${(settings.secondary_color || '#3b82f6')}10 100%)` }}>
      {/* Animated background grid */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(${(settings.secondary_color || '#3b82f6')}03 1px, transparent 1px), linear-gradient(90deg, ${(settings.secondary_color || '#3b82f6')}03 1px, transparent 1px)`, backgroundSize: '64px 64px' }}></div>

      {/* Glow orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full blur-3xl pointer-events-none" style={{ backgroundColor: (settings.secondary_color || '#3b82f6') + '15' }}></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full blur-3xl pointer-events-none animate-float delay-300" style={{ backgroundColor: (settings.primary_color || '#0f172a') + '08' }}></div>

      <div className="max-w-md w-full animate-fade-in-up relative z-10">
        {/* Logo section */}
        <div className="text-center mb-8">
          <div className="relative inline-flex mb-5">
            <div className="absolute -inset-3 rounded-full blur-xl opacity-30 animate-glow-pulse" style={{ background: `linear-gradient(135deg, ${settings.secondary_color || '#3b82f6'}, ${settings.primary_color || '#0f172a'})` }}></div>
            <div className="relative w-20 h-20 rounded-2xl shadow-lg flex items-center justify-center overflow-hidden" style={{ background: `linear-gradient(135deg, ${settings.primary_color || '#0f172a'}, ${settings.dark_color || '#1e293b'})` }}>
              {displayLogo ? (
                <img src={displayLogo} alt="Logo" className="w-16 h-16 object-contain" />
              ) : (
                <span className="text-3xl font-black text-white">D</span>
              )}
            </div>
          </div>
          <h1 className="text-3xl font-black tracking-tight" style={{ color: settings.primary_color || '#0f172a' }}>
            {displayName}
          </h1>
          <p className="text-sm mt-1 font-medium" style={{ color: settings.secondary_color || '#3b82f6' }}>{displayDesc}</p>
          {slug && company && (
            <span className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider" style={{ backgroundColor: (settings.secondary_color || '#3b82f6') + '15', color: settings.secondary_color || '#3b82f6' }}>
              <Building2 size={13} />
              Espace {company.name}
            </span>
          )}
        </div>

        <div className="glass-card-premium p-8 shadow-elevated">
          {suspended && (
            <div className="mb-6 p-4 bg-orange-50/80 backdrop-blur-sm text-orange-600 rounded-xl border border-orange-200 text-sm font-bold flex items-center gap-3 animate-fade-in-down">
              <AlertCircle size={18} className="flex-shrink-0" />
              Cette entreprise est suspendue. Contactez le support.
            </div>
          )}
          {error && (
            <div className="mb-6 p-4 bg-red-50/80 backdrop-blur-sm text-red-600 rounded-xl border border-red-200 text-sm font-bold flex items-center gap-3 animate-fade-in-down">
              <AlertCircle size={18} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Bouton Google Identity Services */}
          {googleAuthService.isConfigured() ? (
            <div className="mb-4">
              <div ref={googleBtnRef} className="flex justify-center" />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => toast.info('Connexion Google non configurée. Contactez l\'administrateur.')}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700 transition-all mb-4"
            >
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Continuer avec Google
            </button>
          )}

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-slate-200"></div>
            <span className="text-xs text-slate-400 font-medium">ou</span>
            <div className="flex-1 h-px bg-slate-200"></div>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Identifiant</label>
              <div className="relative group">
                <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
                <input
                  type="text"
                  className="input-premium pl-12"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  disabled={suspended}
                  placeholder="Entrez votre identifiant"
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Mot de passe</label>
              <div className="relative group">
                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
                <input
                  type={showPwd ? 'text' : 'password'}
                  className="input-premium pl-12 pr-12"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={suspended}
                  placeholder="Entrez votre mot de passe"
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
              disabled={loading || suspended}
              className="btn-primary w-full flex items-center justify-center gap-2 text-base py-3.5 relative overflow-hidden group"
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
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

          <div className="mt-8 pt-6 border-t border-slate-100 text-center space-y-3">
            {!slug && (
              <p className="text-sm text-slate-500">
                Votre entreprise n'est pas inscrite ?{' '}
                <Link to="/register-company" className="font-bold transition-colors underline-offset-4 hover:underline" style={{ color: settings.secondary_color || '#3b82f6' }}>
                  Créer mon espace entreprise
                </Link>
              </p>
            )}
          </div>
        </div>

        <div className="text-center mt-6 space-y-2">
          <p className="text-[10px] text-slate-400 font-medium tracking-wider flex items-center justify-center gap-2 flex-wrap">
            <Link to="/about" className="hover:underline transition-colors" style={{ color: settings.secondary_color || '#3b82f6' }}>À propos</Link>
            <span className="text-slate-300">·</span>
            <Link to="/privacy" className="hover:underline transition-colors" style={{ color: settings.secondary_color || '#3b82f6' }}>Politique de confidentialité</Link>
            <span className="text-slate-300">·</span>
            <Link to="/cookies" className="hover:underline transition-colors" style={{ color: settings.secondary_color || '#3b82f6' }}>Politique de cookies</Link>
          </p>
          <p className="text-[10px] text-slate-400">
            © {new Date().getFullYear()} {settings.site_name || 'DocuFlow'} — Tous droits réservés
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
