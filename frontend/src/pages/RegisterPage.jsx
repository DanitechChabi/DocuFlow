import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { authService } from '../services/authService';
import { useSettings } from '../contexts/SettingsContext';
import { sectionService } from '../services/sectionService';
import { UserPlus, User, Mail, Building2, Lock, AlertCircle, CheckCircle } from 'lucide-react';
import { useTitrePage } from '../hooks/useTitrePage';

const RegisterPage = () => {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    full_name: '',
    email: '',
    section: '',
  });
  const [sections, setSections] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const settings = useSettings();
  const { slug } = useParams(); // Récupérer le tenant_slug de l'URL /:slug/register

  useEffect(() => {
    let mounted = true;
    const loadSections = async () => {
      try {
        const data = await sectionService.getSections();
        if (mounted) setSections(data);
      } catch (err) {
        console.error('Erreur chargement sections', err);
      }
    };
    loadSections();
    return () => { mounted = false; };
  }, []);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Déclaré avant le `return` de l'écran de succès : un hook doit être appelé à
  // chaque rendu, quelle que soit la branche empruntée ensuite.
  useTitrePage(success ? 'Inscription réussie' : 'Créer un compte');

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authService.register({ ...formData, tenant_slug: slug });
      if (data.user) {
        setSuccess(true);
        setTimeout(() => navigateRef.current(slug ? `/${slug}/login` : '/login'), 1500);
      } else {
        setError(data.message || 'Une erreur est survenue');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Une erreur est survenue lors de l\'inscription');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden p-4">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none"></div>
        <div className="glass-card-premium p-12 max-w-md text-center animate-scale-in">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={36} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-black text-slate-800 mb-2">Inscription réussie !</h2>
          <p className="text-slate-500">Redirection vers la connexion...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden py-12 px-4">
      {/* Background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none"></div>
      <div className="absolute top-[-15%] right-[-10%] w-[45%] h-[45%] bg-blue-500/10 rounded-full blur-3xl pointer-events-none animate-float"></div>
      <div className="absolute bottom-[-15%] left-[-10%] w-[45%] h-[45%] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none animate-float delay-500"></div>

      <div className="max-w-lg w-full animate-fade-in-up relative z-10">
        <div className="text-center mb-8">
          <div className="relative inline-flex mb-4">
            <div className="absolute -inset-2 bg-gradient-to-r from-docuflow-secondary to-blue-400 rounded-full blur-xl opacity-30 animate-glow-pulse"></div>
            <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-docuflow-secondary to-blue-600 shadow-lg flex items-center justify-center">
              <UserPlus size={28} className="text-white" />
            </div>
          </div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">
            Créer un compte
          </h2>
          <p className="text-slate-400 text-sm mt-1 font-medium">{settings.site_name || 'DocuFlow'} — {settings.site_description || 'Plateforme de gestion documentaire'}</p>
        </div>

        <div className="glass-card-premium p-8 shadow-elevated">
          {error && (
            <div className="mb-6 p-4 bg-red-50/80 backdrop-blur-sm text-red-600 rounded-xl border border-red-200 text-sm font-bold flex items-center gap-3 animate-fade-in-down">
              <AlertCircle size={18} className="flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleRegister} className="grid grid-cols-2 gap-x-6 gap-y-5">
            <div className="col-span-2 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Nom complet</label>
              <input
                type="text"
                name="full_name"
                className="input-premium"
                value={formData.full_name}
                onChange={handleChange}
                required
                placeholder="Entrez votre nom complet"
              />
            </div>

            <div className="col-span-1 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Nom d'utilisateur</label>
              <div className="relative">
                <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  name="username"
                  className="input-premium pl-12"
                  value={formData.username}
                  onChange={handleChange}
                  required
                  placeholder="Entrez votre nom d'utilisateur"
                />
              </div>
            </div>

            <div className="col-span-1 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Email</label>
              <div className="relative">
                <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="email"
                  name="email"
                  className="input-premium pl-12"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  placeholder="Entrez votre adresse email"
                />
              </div>
            </div>

            <div className="col-span-2 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Section</label>
              <div className="relative">
                <Building2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select
                  name="section"
                  className="input-premium pl-12"
                  value={formData.section}
                  onChange={handleChange}
                  required
                >
                  <option value="">-- Sélectionnez votre section --</option>
                  {sections.map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="col-span-2 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Mot de passe</label>
              <div className="relative">
                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="password"
                  name="password"
                  className="input-premium pl-12"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  minLength={6}
                  placeholder="Entrez un mot de passe (6 caractères min.)"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="col-span-2 btn-primary text-base py-3.5 flex items-center justify-center gap-2 mt-2 relative overflow-hidden group"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Inscription en cours...</span>
                </div>
              ) : (
                <span className="flex items-center gap-2">
                  <UserPlus size={20} />
                  S'inscrire
                </span>
              )}
              {!loading && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-500">
              Déjà un compte ?{' '}
              <Link to={slug ? `/${slug}/login` : '/login'} className="text-docuflow-secondary font-bold hover:text-blue-700 transition-colors underline-offset-4 hover:underline">
                Se connecter
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
