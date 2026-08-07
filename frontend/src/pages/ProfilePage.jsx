import React, { useState, useEffect } from 'react';
import { userService } from '../services/userService';
import { sectionService } from '../services/sectionService';
import { authService } from '../services/authService';
import {
  User, Building2, Shield, Calendar, Lock, Save,
  KeyRound, CheckCircle, AlertCircle, Eye, EyeOff
} from 'lucide-react';

const ProfilePage = () => {

  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);

  const [profile, setProfile] = useState(null);
  const [formData, setFormData] = useState({ full_name: '', email: '', section: '' });
  const [passwordData, setPasswordData] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [showPwd, setShowPwd] = useState({ current: false, new: false, confirm: false });

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [profileData, sectionsData] = await Promise.all([
          userService.getProfile(),
          sectionService.getSections()
        ]);
        if (!mounted) return;
        setProfile(profileData);
        setFormData({
          full_name: profileData.full_name || '',
          email: profileData.email || '',
          section: profileData.section || ''
        });
        setSections(sectionsData);
      } catch (err) {
        if (mounted) setErrorMsg('Erreur lors du chargement du profil');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  const clearMessages = () => {
    setSuccessMsg('');
    setErrorMsg('');
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    clearMessages();
    setSaving(true);
    try {
      const res = await userService.updateProfile(formData);
      setProfile(res.user);
      setSuccessMsg('Profil mis à jour avec succès');
      authService.updateUser(res.user);
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    clearMessages();

    if (passwordData.new_password !== passwordData.confirm_password) {
      setErrorMsg('Les nouveaux mots de passe ne correspondent pas');
      return;
    }
    if (passwordData.new_password.length < 6) {
      setErrorMsg('Le nouveau mot de passe doit contenir au moins 6 caractères');
      return;
    }

    setChangingPwd(true);
    try {
      await userService.changePassword({
        current_password: passwordData.current_password,
        new_password: passwordData.new_password
      });
      setSuccessMsg('Mot de passe modifié avec succès');
      setPasswordData({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Erreur lors du changement de mot de passe');
    } finally {
      setChangingPwd(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin"></div>
          <p className="text-slate-400 font-medium">Chargement du profil...</p>
        </div>
      </div>
    );
  }

  const initial = profile?.full_name?.charAt(0)?.toUpperCase() || '?';

  return (
    <div className="relative p-4 md:p-8">
      <div className="absolute top-0 right-0 w-1/3 h-1/3 bg-blue-500/[0.03] rounded-full blur-3xl pointer-events-none"></div>

      <div className="max-w-3xl mx-auto relative z-10 space-y-6 md:space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3 md:gap-4 animate-fade-in-down">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="relative">
              <div className="w-11 h-11 md:w-14 md:h-14 rounded-full bg-gradient-to-br from-docuflow-secondary to-blue-600 flex items-center justify-center text-white font-bold text-lg md:text-xl shadow-md">
                {initial}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 md:w-4 md:h-4 bg-green-500 rounded-full border-2 border-white"></div>
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Mon Profil</h1>
              <p className="text-xs md:text-sm text-slate-500 font-medium">Personnalisez vos informations personnelles</p>
            </div>
          </div>
        </div>

        {/* Messages */}
        {successMsg && (
          <div className="p-4 bg-green-50/80 backdrop-blur-sm text-green-700 rounded-2xl border border-green-200 flex items-center gap-3 font-medium animate-fade-in-down">
            <CheckCircle size={20} className="flex-shrink-0" /> {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="p-4 bg-red-50/80 backdrop-blur-sm text-red-600 rounded-2xl border border-red-200 flex items-center gap-3 font-medium animate-fade-in-down">
            <AlertCircle size={20} className="flex-shrink-0" /> {errorMsg}
          </div>
        )}

        {/* Section 1 : Informations personnelles */}
        <div className="glass-card-premium p-5 md:p-8 animate-fade-in-up delay-100">
          <div className="flex items-center gap-3 mb-6 md:mb-8">
            <div className="p-2 md:p-2.5 bg-blue-100 text-blue-600 rounded-xl">
              <User size={20} />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-bold text-slate-800">Informations personnelles</h2>
              <p className="text-[10px] md:text-xs text-slate-400">Modifiez vos coordonnées et votre section</p>
            </div>
          </div>

          <form onSubmit={handleUpdateProfile} className="space-y-5 md:space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">
                  <User size={12} className="inline mr-1" /> Nom d'utilisateur
                </label>
                <input value={profile?.username || ''} disabled className="input-disabled" />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">
                  <Shield size={12} className="inline mr-1" /> Rôle
                </label>
                <div className="input-disabled flex items-center uppercase tracking-wider">{profile?.role || ''}</div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Nom complet</label>
                <input
                  value={formData.full_name}
                  onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                  required
                  placeholder="Entrez votre nom complet"
                  className="input-premium"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  required
                  placeholder="Entrez votre adresse email"
                  className="input-premium"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">
                  <Building2 size={12} className="inline mr-1" /> Section
                </label>
                <select
                  value={formData.section}
                  onChange={(e) => setFormData({...formData, section: e.target.value})}
                  className="input-premium"
                >
                  <option value="">-- Sélectionnez votre section --</option>
                  {sections.map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">
                  <Calendar size={12} className="inline mr-1" /> Membre depuis
                </label>
                <input
                  value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}
                  disabled
                  className="input-disabled"
                />
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className={`btn-primary flex items-center gap-2 ${saving ? 'opacity-70' : ''}`}
              >
                {saving ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <Save size={18} />
                )}
                {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
              </button>
            </div>
          </form>
        </div>

        {/* Section 2 : Mot de passe */}
        <div className="glass-card-premium p-5 md:p-8 animate-fade-in-up delay-300">
          <div className="flex items-center gap-3 mb-6 md:mb-8">
            <div className="p-2 md:p-2.5 bg-orange-100 text-orange-600 rounded-xl">
              <Lock size={20} />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-bold text-slate-800">Changer le mot de passe</h2>
              <p className="text-[10px] md:text-xs text-slate-400">Sécurisez votre compte en modifiant votre mot de passe</p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-5 md:space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Mot de passe actuel</label>
                <div className="relative">
                  <input type={showPwd.current ? 'text' : 'password'} value={passwordData.current_password}
                    onChange={(e) => setPasswordData({...passwordData, current_password: e.target.value})}
                    required placeholder="Entrez votre mot de passe actuel" className="input-premium pr-12" />
                  <button type="button" onClick={() => setShowPwd({...showPwd, current: !showPwd.current})}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPwd.current ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Nouveau mot de passe</label>
                <div className="relative">
                  <input type={showPwd.new ? 'text' : 'password'} value={passwordData.new_password}
                    onChange={(e) => setPasswordData({...passwordData, new_password: e.target.value})}
                    required minLength={6} placeholder="Entrez un nouveau mot de passe (6 caractères min.)" className="input-premium pr-12" />
                  <button type="button" onClick={() => setShowPwd({...showPwd, new: !showPwd.new})}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPwd.new ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Confirmer le mot de passe</label>
                <div className="relative">
                  <input type={showPwd.confirm ? 'text' : 'password'} value={passwordData.confirm_password}
                    onChange={(e) => setPasswordData({...passwordData, confirm_password: e.target.value})}
                    required placeholder="Répétez le nouveau mot de passe"
                    className={`input-premium pr-12 ${passwordData.confirm_password && passwordData.new_password !== passwordData.confirm_password ? 'border-red-400 ring-1 ring-red-400' : ''}`} />
                  <button type="button" onClick={() => setShowPwd({...showPwd, confirm: !showPwd.confirm})}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPwd.confirm ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {passwordData.confirm_password && passwordData.new_password !== passwordData.confirm_password && (
                  <p className="text-xs text-red-500 font-medium mt-1">Les nouveaux mots de passe ne correspondent pas</p>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={changingPwd || (passwordData.confirm_password !== '' && passwordData.new_password !== passwordData.confirm_password)}
                className="btn-primary flex items-center gap-2 bg-orange-600 hover:bg-orange-700 shadow-lg shadow-orange-500/20 disabled:opacity-50"
              >
                {changingPwd ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <KeyRound size={18} />
                )}
                {changingPwd ? 'Modification...' : 'Changer le mot de passe'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
