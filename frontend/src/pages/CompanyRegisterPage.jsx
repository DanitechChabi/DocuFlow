import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authService } from '../services/authService';
import { useSettings } from '../contexts/SettingsContext';
import { Building2, User, Mail, Lock, UserPlus, AlertCircle, CheckCircle, KeyRound } from 'lucide-react';

// Convertit un nom en code entreprise : minuscules, sans accents, espaces → tirets
const toSlug = (value) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const CompanyRegisterPage = () => {
  const navigate = useNavigate();
  const settings = useSettings();
  const [formData, setFormData] = useState({
    company_name: '',
    slug: '',
    admin_full_name: '',
    admin_username: '',
    admin_email: '',
    admin_password: '',
    contact_email: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [createdSlug, setCreatedSlug] = useState('');

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Le code est auto-suggéré depuis le nom tant que l'utilisateur ne l'a pas modifié
  const handleCompanyName = (e) => {
    const name = e.target.value;
    setFormData((prev) => ({
      ...prev,
      company_name: name,
      slug: slugTouched ? prev.slug : toSlug(name),
    }));
  };

  const handleSlugChange = (e) => {
    setSlugTouched(true);
    setFormData({ ...formData, slug: e.target.value });
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await authService.registerCompany({
        company_name: formData.company_name,
        slug: formData.slug,
        admin_username: formData.admin_username,
        admin_password: formData.admin_password,
        admin_full_name: formData.admin_full_name,
        admin_email: formData.admin_email,
        contact_email: formData.contact_email || undefined,
      });
      if (data.slug) {
        setCreatedSlug(data.slug);
        setSuccess(true);
        setTimeout(() => navigate(`/${data.slug}/login`), 2200);
      } else {
        setError(data.message || 'Une erreur est survenue');
      }
    } catch (err) {
      const msg = err.response?.data?.message;
      if (err.response?.status === 500) {
        setError("Erreur serveur lors de la création. Vérifiez que la base de données est accessible et à jour.");
      } else {
        setError(msg || "Une erreur est survenue lors de la création de l'entreprise");
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50 relative overflow-hidden p-4">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none"></div>
        <div className="glass-card-premium p-12 max-w-md text-center animate-scale-in relative z-10">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={36} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-black text-slate-800 mb-2">Entreprise créée !</h2>
          <p className="text-slate-500">
            Votre compte administrateur est prêt. Redirection vers votre espace{' '}
            <span className="font-bold text-docuflow-secondary">{createdSlug}</span>…
          </p>
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
              <Building2 size={28} className="text-white" />
            </div>
          </div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">
            Créer mon espace entreprise
          </h2>
          <p className="text-slate-400 text-sm mt-1 font-medium">
            {settings.site_name || 'DocuFlow'} — votre espace documentaire dédié, avec son propre compte administrateur.
          </p>
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
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Nom de l'entreprise</label>
              <div className="relative group">
                <Building2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
                <input
                  type="text"
                  name="company_name"
                  className="input-premium pl-12"
                  value={formData.company_name}
                  onChange={handleCompanyName}
                  required
                  placeholder="Ex. Compagnie DocuFlow"
                />
              </div>
            </div>

            <div className="col-span-2 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Code entreprise</label>
              <div className="relative group">
                <KeyRound size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
                <input
                  type="text"
                  name="slug"
                  className="input-premium pl-12"
                  value={formData.slug}
                  onChange={handleSlugChange}
                  required
                  pattern="[a-z0-9-]+"
                  title="Lettres minuscules, chiffres et tirets uniquement"
                  placeholder="ex. compagnie-docuflow"
                />
              </div>
              <p className="text-[11px] text-slate-400 ml-1">
                Sera utilisé dans l'adresse de votre page de connexion : <span className="font-mono">…/{formData.slug || 'code'}/login</span>
              </p>
            </div>

            <div className="col-span-2 border-t border-slate-100 pt-5 mt-1">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Compte administrateur</p>
            </div>

            <div className="col-span-2 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Nom complet</label>
              <div className="relative group">
                <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
                <input
                  type="text"
                  name="admin_full_name"
                  className="input-premium pl-12"
                  value={formData.admin_full_name}
                  onChange={handleChange}
                  required
                  placeholder="Votre nom complet"
                />
              </div>
            </div>

            <div className="col-span-1 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Identifiant</label>
              <div className="relative group">
                <UserPlus size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
                <input
                  type="text"
                  name="admin_username"
                  className="input-premium pl-12"
                  value={formData.admin_username}
                  onChange={handleChange}
                  required
                  placeholder="Votre identifiant"
                />
              </div>
            </div>

            <div className="col-span-1 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Mot de passe</label>
              <div className="relative group">
                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
                <input
                  type="password"
                  name="admin_password"
                  className="input-premium pl-12"
                  value={formData.admin_password}
                  onChange={handleChange}
                  required
                  minLength={6}
                  placeholder="6 caractères min."
                />
              </div>
            </div>

            <div className="col-span-2 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Email administrateur</label>
              <div className="relative group">
                <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
                <input
                  type="email"
                  name="admin_email"
                  className="input-premium pl-12"
                  value={formData.admin_email}
                  onChange={handleChange}
                  required
                  placeholder="admin@entreprise.com"
                />
              </div>
            </div>

            <div className="col-span-2 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Email de contact (optionnel)</label>
              <div className="relative group">
                <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
                <input
                  type="email"
                  name="contact_email"
                  className="input-premium pl-12"
                  value={formData.contact_email}
                  onChange={handleChange}
                  placeholder="contact@entreprise.com"
                />
              </div>
            </div>

            <div className="col-span-2">
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2 text-base py-3.5 relative overflow-hidden group"
              >
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>Création en cours...</span>
                  </div>
                ) : (
                  <span className="flex items-center gap-2">
                    <Building2 size={20} />
                    Créer mon espace entreprise
                  </span>
                )}
              </button>
            </div>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-500">
              Déjà inscrit ?{' '}
              <Link to="/login" className="text-docuflow-secondary font-bold hover:text-blue-700 transition-colors underline-offset-4 hover:underline">
                Se connecter
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center mt-6 text-[10px] text-slate-400 font-medium tracking-wider">
          &copy; {new Date().getFullYear()} ARCHICORP — Tous droits réservés
        </p>
      </div>
    </div>
  );
};

export default CompanyRegisterPage;
