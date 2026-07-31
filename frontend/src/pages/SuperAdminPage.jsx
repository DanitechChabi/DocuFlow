import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { userService } from '../services/userService';
import { sectionService } from '../services/sectionService';
import { settingsService } from '../services/settingsService';
import { tenantService } from '../services/tenantService';
import { useSettings } from '../contexts/SettingsContext';
import {
  UserPlus, Trash2, ShieldAlert, Layers,
  Users, LayoutDashboard, X, Plus, AlertCircle, CheckCircle, Search,
  Image, Save, Upload, Palette, Building2, Globe, ToggleLeft, ToggleRight
} from 'lucide-react';

const roleColors = {
  superadmin: { bg: 'bg-red-100', text: 'text-red-600', dot: 'bg-red-500' },
  admin: { bg: 'bg-purple-100', text: 'text-purple-600', dot: 'bg-purple-500' },
  archiviste: { bg: 'bg-blue-100', text: 'text-blue-600', dot: 'bg-blue-500' },
  demandeur: { bg: 'bg-green-100', text: 'text-green-600', dot: 'bg-green-500' },
};

const SuperAdminPage = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isUserFormOpen, setIsUserFormOpen] = useState(false);
  const [isSectionFormOpen, setIsSectionFormOpen] = useState(false);
  const [activePanel, setActivePanel] = useState('users'); // 'users' | 'sections' | 'branding' | 'tenants'
  const [searchTerm, setSearchTerm] = useState('');

  const [newUser, setNewUser] = useState({
    username: '', password: '', full_name: '', email: '', section: '', role: 'demandeur'
  });
  const [newSection, setNewSection] = useState({ name: '' });

  // Tenants state
  const [tenants, setTenants] = useState([]);
  const [isTenantFormOpen, setIsTenantFormOpen] = useState(false);
  const [tenantForm, setTenantForm] = useState({ name: '', slug: '', email_domain: '', contact_email: '' });
  const [tenantToggling, setTenantToggling] = useState(null);

  // Branding state
  const settings = useSettings();
  const [branding, setBranding] = useState({ site_name: '', site_description: '' });
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [brandSaving, setBrandSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [brandMsg, setBrandMsg] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    setBranding({
      site_name: settings.site_name || '',
      site_description: settings.site_description || ''
    });
    setLogoPreview(settings.site_logo_url);
  }, [settings.site_name, settings.site_description, settings.site_logo_url]);

  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const handleUploadLogo = async () => {
    if (!logoFile) return;
    setLogoUploading(true);
    try {
      await settings.uploadLogo(logoFile);
      setLogoFile(null);
      setBrandMsg('Logo mis à jour avec succès');
      setTimeout(() => setBrandMsg(''), 3000);
    } catch (err) {
      setBrandMsg('Erreur lors de l\'upload du logo');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSaveBranding = async () => {
    setBrandSaving(true);
    try {
      await settingsService.updateSettings({
        site_name: branding.site_name,
        site_description: branding.site_description
      });
      await settings.refresh();
      setBrandMsg('Paramètres enregistrés');
      setTimeout(() => setBrandMsg(''), 3000);
    } catch (err) {
      setBrandMsg('Erreur lors de la sauvegarde');
    } finally {
      setBrandSaving(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersData, sectionsData, tenantsData] = await Promise.all([
        userService.getAllUsers().catch(e => { console.error('Erreur users:', e); return []; }),
        sectionService.getSections().catch(e => { console.error('Erreur sections:', e); return []; }),
        tenantService.getAllTenants().catch(e => { console.error('Erreur tenants:', e); return []; })
      ]);
      setUsers(usersData);
      setSections(sectionsData);
      setTenants(tenantsData);
    } catch (err) {
      setError('Erreur critique lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  const showSuccess = (msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await userService.createUser(newUser);
      setNewUser({ username: '', password: '', full_name: '', email: '', section: '', role: 'demandeur' });
      setIsUserFormOpen(false);
      fetchData();
      showSuccess('Utilisateur créé avec succès');
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors de la création');
    }
  };

  const handleDeleteUser = async (id) => {
    if (!confirm('Supprimer cet utilisateur ? Cette action est irréversible.')) return;
    try {
      await userService.deleteUser(id);
      fetchData();
      showSuccess('Utilisateur supprimé');
    } catch (err) {
      setError('Erreur lors de la suppression');
    }
  };

  const handleCreateSection = async (e) => {
    e.preventDefault();
    try {
      await sectionService.createSection(newSection.name);
      setNewSection({ name: '' });
      setIsSectionFormOpen(false);
      fetchData();
      showSuccess('Section créée');
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur');
    }
  };

  const handleDeleteSection = async (id) => {
    if (!confirm('Supprimer cette section ?')) return;
    try {
      await sectionService.deleteSection(id);
      fetchData();
      showSuccess('Section supprimée');
    } catch (err) {
      setError('Erreur');
    }
  };

  // === Tenants handlers ===
  const handleCreateTenant = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await tenantService.createTenant(tenantForm);
      setTenantForm({ name: '', slug: '', email_domain: '', contact_email: '' });
      setIsTenantFormOpen(false);
      fetchData();
      showSuccess('Entreprise créée avec succès');
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors de la création');
    }
  };

  const handleToggleTenant = async (tenant) => {
    const newStatus = tenant.status === 'active' ? 'suspended' : 'active';
    const action = newStatus === 'active' ? 'réactiver' : 'suspendre';
    if (!confirm(`Voulez-vous ${action} l'entreprise "${tenant.name}" ?`)) return;
    setTenantToggling(tenant.id);
    try {
      await tenantService.updateTenantStatus(tenant.id, newStatus);
      fetchData();
      showSuccess(`Entreprise "${tenant.name}" ${newStatus === 'active' ? 'réactivée' : 'suspendue'}`);
    } catch (err) {
      setError('Erreur lors du changement de statut');
    } finally {
      setTenantToggling(null);
    }
  };

  const handleDeleteTenant = async (tenant) => {
    if (!confirm(`Supprimer l'entreprise "${tenant.name}" ?\n\nCette action supprimera TOUTES les données associées (utilisateurs, demandes, messages…). Cette opération est irréversible.`)) return;
    try {
      await tenantService.deleteTenant(tenant.id);
      fetchData();
      showSuccess(`Entreprise "${tenant.name}" supprimée`);
    } catch (err) {
      setError('Erreur lors de la suppression');
    }
  };

  const filteredUsers = users.filter(u =>
    u.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in-down">
          <div className="flex items-center gap-3 md:gap-5">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-3 bg-white text-slate-700 rounded-2xl shadow-sm border border-slate-200 hover:bg-slate-50 transition-all hover:shadow-md"
            >
              <LayoutDashboard size={22} />
            </button>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2 md:p-2.5 bg-gradient-to-br from-red-500 to-red-700 text-white rounded-2xl shadow-lg">
                  <ShieldAlert size={22} />
                </div>
                <h1 className="text-xl md:text-3xl font-black text-slate-900 tracking-tight">Administration</h1>
              </div>
              <p className="text-xs md:text-sm text-slate-500 font-medium md:ml-1">Gestion des utilisateurs, rôles et sections</p>
            </div>
          </div>
        </div>

        {/* Messages */}
        {success && (
          <div className="p-4 bg-green-50/80 backdrop-blur-sm text-green-700 rounded-2xl border border-green-200 flex items-center gap-3 font-medium animate-fade-in-down">
            <CheckCircle size={20} className="flex-shrink-0" /> {success}
          </div>
        )}
        {error && (
          <div className="p-4 bg-red-50/80 backdrop-blur-sm text-red-600 rounded-2xl border border-red-200 flex items-center gap-3 font-medium animate-fade-in-down">
            <AlertCircle size={20} className="flex-shrink-0" /> {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 bg-white rounded-2xl p-1.5 shadow-sm border border-slate-100 w-fit overflow-x-auto">
          <button
            onClick={() => setActivePanel('users')}
            className={`px-4 md:px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all flex items-center gap-2 whitespace-nowrap ${
              activePanel === 'users' ? 'bg-afgc-primary text-white shadow-md' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users size={15} /> Utilisateurs
          </button>
          <button
            onClick={() => setActivePanel('sections')}
            className={`px-4 md:px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all flex items-center gap-2 whitespace-nowrap ${
              activePanel === 'sections' ? 'bg-afgc-primary text-white shadow-md' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers size={15} /> Sections
          </button>
          <button
            onClick={() => setActivePanel('branding')}
            className={`px-4 md:px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all flex items-center gap-2 whitespace-nowrap ${
              activePanel === 'branding' ? 'bg-afgc-primary text-white shadow-md' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Palette size={15} /> Branding
          </button>
          <button
            onClick={() => setActivePanel('tenants')}
            className={`px-4 md:px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all flex items-center gap-2 whitespace-nowrap ${
              activePanel === 'tenants' ? 'bg-afgc-primary text-white shadow-md' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Building2 size={15} /> Entreprises
          </button>
        </div>

        {/* Users Panel */}
        {activePanel === 'users' && (
          <div className="space-y-6 animate-fade-in-up">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-full md:max-w-sm">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="input-premium pl-9"
                  placeholder="Rechercher..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button onClick={() => setIsUserFormOpen(true)} className="btn-primary flex items-center justify-center gap-2">
                <UserPlus size={18} /> <span className="sm:hidden md:inline">Nouvel</span> Utilisateur
              </button>
            </div>

            {/* Loading skeleton */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="bg-white rounded-2xl p-5 border border-slate-100 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="skeleton w-12 h-12 rounded-full"></div>
                      <div className="space-y-2 flex-1">
                        <div className="skeleton h-4 w-3/4 rounded"></div>
                        <div className="skeleton h-3 w-1/2 rounded"></div>
                      </div>
                    </div>
                    <div className="skeleton h-10 w-full rounded-xl"></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
                {filteredUsers.map((u, idx) => {
                  const roleStyle = roleColors[u.role] || roleColors.demandeur;
                  return (
                    <div
                      key={u.id}
                      className="bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-lg hover:border-blue-200/50 transition-all duration-300 group animate-fade-in-up"
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-afgc-secondary to-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-sm group-hover:shadow-md transition-all">
                          {u.full_name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-800 truncate">{u.full_name || 'N/A'}</p>
                          <p className="text-xs text-slate-400">@{u.username}</p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider ${roleStyle.bg} ${roleStyle.text}`}>
                          {u.role}
                        </span>
                      </div>
                      <div className="space-y-1 text-sm text-slate-500 mb-4">
                        <p className="truncate">{u.email || 'N/A'}</p>
                        <p>{u.section || 'N/A'}</p>
                      </div>
                      <div className="flex gap-2 pt-3 border-t border-slate-100">
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-red-500 hover:bg-red-50 transition-colors text-sm font-semibold"
                        >
                          <Trash2 size={14} /> Supprimer
                        </button>
                      </div>
                    </div>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <div className="col-span-full text-center py-16 text-slate-400">
                    <Users size={48} className="mx-auto mb-4 text-slate-200" />
                    <p className="font-bold text-lg">Aucun utilisateur trouvé</p>
                    <p>Essayez de modifier votre recherche</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Branding Panel */}
        {activePanel === 'branding' && (
          <div className="space-y-6 animate-fade-in-up">
            {brandMsg && (
              <div className="p-4 bg-green-50/80 backdrop-blur-sm text-green-700 rounded-2xl border border-green-200 flex items-center gap-3 font-medium animate-fade-in-down">
                <CheckCircle size={20} className="flex-shrink-0" /> {brandMsg}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Logo */}
              <div className="glass-card-premium p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2.5 bg-purple-100 text-purple-600 rounded-xl">
                    <Image size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">Logo de l'application</h3>
                    <p className="text-xs text-slate-400">PNG, JPG, SVG — 5 Mo max</p>
                  </div>
                </div>

                <div className="flex flex-col items-center gap-4">
                  <div className="w-32 h-32 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                    {logoPreview ? (
                      <img src={logoPreview} alt="Logo preview" className="w-full h-full object-contain p-2" />
                    ) : (
                      <Image size={40} className="text-slate-300" />
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoChange}
                    className="hidden"
                  />
                  <div className="flex gap-3">
                    <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex items-center gap-2">
                      <Upload size={16} /> Choisir un fichier
                    </button>
                    {logoFile && (
                      <button onClick={handleUploadLogo} disabled={logoUploading} className="btn-primary flex items-center gap-2">
                        {logoUploading ? (
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : <Save size={16} />}
                        {logoUploading ? 'Upload...' : 'Enregistrer'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Infos */}
              <div className="glass-card-premium p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl">
                    <Palette size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">Identité du site</h3>
                    <p className="text-xs text-slate-400">Nom et description affichés dans l'application</p>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Nom du site</label>
                    <input className="input-premium" value={branding.site_name}
                      onChange={(e) => setBranding({...branding, site_name: e.target.value})}
                      placeholder="DocuFlow" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Description</label>
                    <input className="input-premium" value={branding.site_description}
                      onChange={(e) => setBranding({...branding, site_description: e.target.value})}
                      placeholder="Plateforme de gestion documentaire" />
                  </div>
                  <button onClick={handleSaveBranding} disabled={brandSaving}
                    className="btn-primary w-full flex items-center justify-center gap-2 mt-4">
                    {brandSaving ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : <Save size={18} />}
                    {brandSaving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
                  </button>
                </div>
              </div>
            </div>

            {/* Aperçu */}
            <div className="glass-card-premium p-6">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Aperçu en direct</h3>
              <div className="flex items-center gap-4 p-4 bg-gradient-to-br from-afgc-primary to-slate-900 rounded-2xl">
                <div className="w-12 h-12 rounded-full bg-white/10 overflow-hidden flex-shrink-0 border-2 border-white/20">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/50 font-bold text-lg">?</div>
                  )}
                </div>
                <div>
                  <p className="text-white font-bold text-lg">{branding.site_name || 'DocuFlow'}</p>
                  <p className="text-white/50 text-xs">{branding.site_description || 'Plateforme'}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sections Panel */}
        {activePanel === 'sections' && (
          <div className="space-y-6 animate-fade-in-up">
            <div className="flex justify-end">
              <button onClick={() => setIsSectionFormOpen(true)} className="btn-primary flex items-center gap-2">
                <Plus size={18} /> Nouvelle section
              </button>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-white rounded-2xl p-5 md:p-6 border border-slate-100">
                    <div className="flex justify-between items-start">
                      <div className="space-y-2">
                        <div className="skeleton h-5 w-32 rounded"></div>
                        <div className="skeleton h-3 w-20 rounded"></div>
                      </div>
                      <div className="skeleton h-9 w-9 rounded-lg"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
                {sections.map((s, idx) => (
                  <div
                    key={s.id}
                    className="bg-white rounded-2xl p-6 border border-slate-100 hover:shadow-lg hover:border-blue-200/50 transition-all duration-300 group animate-fade-in-up"
                    style={{ animationDelay: `${idx * 80}ms` }}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800">{s.name}</h3>
                        <p className="text-xs text-slate-400 mt-1">Créée le {new Date(s.created_at).toLocaleDateString()}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteSection(s.id)}
                        className="p-2 rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tenants Panel */}
        {activePanel === 'tenants' && (
          <div className="space-y-6 animate-fade-in-up">
            <div className="flex justify-end">
              <button onClick={() => setIsTenantFormOpen(true)} className="btn-primary flex items-center gap-2">
                <Building2 size={18} /> Nouvelle entreprise
              </button>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-white rounded-2xl p-5 md:p-6 border border-slate-100">
                    <div className="skeleton h-5 w-32 rounded mb-3"></div>
                    <div className="skeleton h-3 w-20 rounded mb-4"></div>
                    <div className="skeleton h-4 w-24 rounded"></div>
                  </div>
                ))}
              </div>
            ) : tenants.length === 0 ? (
              <div className="glass-card-premium p-10 text-center">
                <Building2 size={40} className="mx-auto text-slate-300 mb-4" />
                <p className="text-slate-500 font-medium">Aucune entreprise</p>
                <p className="text-slate-400 text-sm mt-1">Créez votre première entreprise</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
                {tenants.map((t) => {
                  const suspended = t.status === 'suspended';
                  return (
                    <div key={t.id} className={`glass-card-premium p-5 md:p-6 border transition-all duration-200 ${
                      suspended ? 'opacity-60 border-red-200' : 'border-transparent'
                    }`}>
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-xl ${
                            suspended ? 'bg-red-100 text-red-500' : 'bg-emerald-100 text-emerald-600'
                          }`}>
                            <Building2 size={20} />
                          </div>
                          <div>
                            <h3 className="font-bold text-slate-800 text-sm md:text-base">{t.name}</h3>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <Globe size={12} className="text-slate-400" />
                              <span className="text-xs text-slate-400 font-mono">{t.slug}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap ${
                          suspended
                            ? 'bg-red-100 text-red-600'
                            : 'bg-emerald-100 text-emerald-600'
                        }`}>
                          {suspended ? 'Suspendue' : 'Active'}
                        </span>
                      </div>

                      <p className="text-xs text-slate-400 mb-4">
                        Créée le {new Date(t.created_at).toLocaleDateString('fr-FR')}
                      </p>

                      <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                        <button
                          onClick={() => handleToggleTenant(t)}
                          disabled={tenantToggling === t.id}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                            suspended
                              ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                              : 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                          } disabled:opacity-50`}
                        >
                          {tenantToggling === t.id ? (
                            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : suspended ? (
                            <ToggleRight size={14} />
                          ) : (
                            <ToggleLeft size={14} />
                          )}
                          {suspended ? 'Réactiver' : 'Suspendre'}
                        </button>
                        <button
                          onClick={() => handleDeleteTenant(t)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-red-50 text-red-500 hover:bg-red-100 transition-all ml-auto"
                        >
                          <Trash2 size={14} /> Supprimer
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal: Nouvel utilisateur */}
      {isUserFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setIsUserFormOpen(false)}>
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl animate-scale-in overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 text-blue-600 rounded-xl">
                  <UserPlus size={22} />
                </div>
                <h2 className="text-xl font-bold text-slate-800">Nouvel utilisateur</h2>
              </div>
              <button onClick={() => setIsUserFormOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="p-8 space-y-5">
              <div className="grid grid-cols-2 gap-5">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Nom complet</label>
                  <input className="input-premium" value={newUser.full_name} onChange={e => setNewUser({...newUser, full_name: e.target.value})} required />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Identifiant</label>
                  <input className="input-premium" value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} required />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Email</label>
                  <input type="email" className="input-premium" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} required />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Mot de passe</label>
                  <input type="password" className="input-premium" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} required minLength={6} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Section</label>
                  <select className="input-premium" value={newUser.section} onChange={e => setNewUser({...newUser, section: e.target.value})}>
                    <option value="">--</option>
                    {sections.map(s => (<option key={s.id} value={s.name}>{s.name}</option>))}
                  </select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Rôle</label>
                  <div className="flex gap-2">
                    {['demandeur', 'admin', 'archiviste', 'superadmin'].map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setNewUser({...newUser, role: r})}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                          newUser.role === r
                            ? 'bg-afgc-primary text-white shadow-md'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="pt-4 flex gap-3">
                <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2">
                  <UserPlus size={18} /> Créer
                </button>
                <button type="button" onClick={() => setIsUserFormOpen(false)} className="btn-secondary flex-1">
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nouvelle section */}
      {isSectionFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setIsSectionFormOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl animate-scale-in overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-3">
                <Layers size={22} className="text-blue-500" /> Nouvelle section
              </h2>
              <button onClick={() => setIsSectionFormOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateSection} className="p-8 space-y-6">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Nom de la section</label>
                <input className="input-premium" value={newSection.name} onChange={e => setNewSection({name: e.target.value})} required placeholder="Ex: Direction Financière" />
              </div>
              <div className="flex gap-3">
                <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2">
                  <Plus size={18} /> Ajouter
                </button>
                <button type="button" onClick={() => setIsSectionFormOpen(false)} className="btn-secondary flex-1">
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nouvelle entreprise */}
      {isTenantFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setIsTenantFormOpen(false)}>
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl animate-scale-in overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 text-emerald-600 rounded-xl">
                  <Building2 size={22} />
                </div>
                <h2 className="text-xl font-bold text-slate-800">Nouvelle entreprise</h2>
              </div>
              <button onClick={() => setIsTenantFormOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X size={20} className="text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateTenant} className="p-8 space-y-5">
              <div className="grid grid-cols-2 gap-5">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Nom de l'entreprise</label>
                  <input className="input-premium" value={tenantForm.name}
                    onChange={e => setTenantForm({...tenantForm, name: e.target.value})}
                    placeholder="Ex: AFGC" required />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Slug</label>
                  <input className="input-premium" value={tenantForm.slug}
                    onChange={e => setTenantForm({...tenantForm, slug: e.target.value.toLowerCase().replace(/\s+/g, '-')})}
                    placeholder="afgc" required />
                  <p className="text-[10px] text-slate-400 mt-1">Identifiant unique utilisé dans l'URL</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Domaine email</label>
                  <input className="input-premium" value={tenantForm.email_domain}
                    onChange={e => setTenantForm({...tenantForm, email_domain: e.target.value})}
                    placeholder="afgc.com" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Email de contact</label>
                  <input className="input-premium" type="email" value={tenantForm.contact_email}
                    onChange={e => setTenantForm({...tenantForm, contact_email: e.target.value})}
                    placeholder="contact@entreprise.com" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2">
                  <Building2 size={18} /> Créer l'entreprise
                </button>
                <button type="button" onClick={() => setIsTenantFormOpen(false)} className="btn-secondary flex-1">
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperAdminPage;
