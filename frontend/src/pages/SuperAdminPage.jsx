import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superadminService } from '../services/superadminService';
import { sectionService } from '../services/sectionService';
import { settingsService } from '../services/settingsService';
import { tenantService } from '../services/tenantService';
import { useSettings } from '../contexts/SettingsContext';
import {
  ShieldAlert, Users, Layers, Building2, Palette, LayoutDashboard,
  X, Plus, Trash2, Search, CheckCircle, AlertCircle, Save, Upload,
  Globe, ToggleLeft, ToggleRight, Crown, UserCog, KeyRound,
  TrendingUp, Activity, Mail, Lock, Eye, EyeOff, Pencil, Image,
  FileText, Archive, ArchiveRestore, Inbox, Calendar, Clock
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { toast } from '../components/Toast';

const ALL_ROLES = [
  { key: 'demandeur', label: 'Demandeur', color: 'bg-green-100 text-green-600' },
  { key: 'archiviste', label: 'Archiviste', color: 'bg-blue-100 text-blue-600' },
  { key: 'admin', label: 'Admin', color: 'bg-purple-100 text-purple-600' },
  { key: 'superadmin', label: 'Super Admin', color: 'bg-red-100 text-red-600' },
];
const roleColor = (role) => ALL_ROLES.find((r) => r.key === role)?.color || 'bg-slate-100 text-slate-600';

const SuperAdminPage = () => {
  const navigate = useNavigate();
  const settings = useSettings();

  // State
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('all');

  // Users
  const [allUsers, setAllUsers] = useState([]);
  const [superAdmins, setSuperAdmins] = useState([]);

  // Tenants
  const [tenants, setTenants] = useState([]);

  // Sections
  const [sections, setSections] = useState([]);

  // Stats
  const [stats, setStats] = useState({ totalUsers: 0, totalTenants: 0, totalRequests: 0, totalSuperAdmins: 0, activeRequests: 0, requestsByTenant: [] });

  // Demandes (tous tenants)
  const [requests, setRequests] = useState([]);
  const [requestFilter, setRequestFilter] = useState('active'); // 'active' | 'archived' | 'all'
  const [requestSearch, setRequestSearch] = useState('');

  // Modals
  const [editUser, setEditUser] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isResetPwdOpen, setIsResetPwdOpen] = useState(null);
  const [isSectionFormOpen, setIsSectionFormOpen] = useState(false);
  const [isTenantFormOpen, setIsTenantFormOpen] = useState(false);

  // Forms
  const [userForm, setUserForm] = useState({ username: '', password: '', full_name: '', email: '', section: '', role: 'demandeur', tenant_id: '' });
  const [newSection, setNewSection] = useState('');
  const [tenantForm, setTenantForm] = useState({ name: '', slug: '', email_domain: '', contact_email: '' });
  const [resetPwd, setResetPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  // Branding
  const [branding, setBranding] = useState({ site_name: '', site_description: '' });
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [brandSaving, setBrandSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Confirm
  const [confirm, setConfirm] = useState({ open: false, title: '', message: '', type: 'danger', onConfirm: null });
  const [confirmLoading, setConfirmLoading] = useState(false);

  // --- FETCH ---
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [users, supers, tenantsData, sectionsData, statsData, requestsData] = await Promise.allSettled([
        superadminService.getAllUsers(),
        superadminService.getSuperAdmins(),
        tenantService.getAllTenants(),
        sectionService.getSections(),
        superadminService.getStats(),
        superadminService.getAllRequests(),
      ]);
      if (users.status === 'fulfilled') setAllUsers(users.value);
      if (supers.status === 'fulfilled') setSuperAdmins(supers.value);
      if (tenantsData.status === 'fulfilled') setTenants(tenantsData.value);
      if (sectionsData.status === 'fulfilled') setSections(sectionsData.value);
      if (statsData.status === 'fulfilled') setStats(statsData.value);
      if (requestsData.status === 'fulfilled') setRequests(requestsData.value);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    setBranding({ site_name: settings.site_name || '', site_description: settings.site_description || '' });
    setLogoPreview(settings.site_logo_url);
  }, [settings.site_name, settings.site_description, settings.site_logo_url]);

  // --- USERS ---
  const filteredUsers = allUsers.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (tenantFilter !== 'all' && String(u.tenant_id) !== tenantFilter) return false;
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (u.full_name || '').toLowerCase().includes(s) || (u.username || '').toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s) || (u.tenant_name || '').toLowerCase().includes(s);
  });

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await superadminService.createUser(userForm);
      toast.success('Utilisateur créé avec succès');
      setIsCreateOpen(false);
      setUserForm({ username: '', password: '', full_name: '', email: '', section: '', role: 'demandeur', tenant_id: '' });
      fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la création');
    }
  };

  const handleEditUser = (u) => {
    setEditUser({ ...u, password: '' });
  };

  const handleSaveEdit = async () => {
    try {
      await superadminService.updateUser(editUser.id, {
        full_name: editUser.full_name,
        email: editUser.email,
        section: editUser.section,
        role: editUser.role,
        tenant_id: editUser.tenant_id,
        username: editUser.username,
      });
      toast.success('Utilisateur mis à jour');
      setEditUser(null);
      fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la mise à jour');
    }
  };

  const handleDeleteUser = (u) => {
    setConfirm({
      open: true,
      title: `Supprimer ${u.full_name} ?`,
      message: `Cette action supprimera définitivement le compte de ${u.full_name} (${u.role}). Cette opération est irréversible.`,
      type: 'danger',
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await superadminService.deleteUser(u.id);
          toast.success('Utilisateur supprimé');
          fetchAll();
        } catch (err) {
          toast.error(err.response?.data?.message || 'Erreur');
        } finally {
          setConfirmLoading(false);
          setConfirm({ ...confirm, open: false });
        }
      },
    });
  };

  const openResetPwd = (u) => {
    setIsResetPwdOpen(u);
    setResetPwd('');
    setShowPwd(false);
  };

  const handleResetPwd = async () => {
    if (!resetPwd || resetPwd.length < 6) return;
    try {
      await superadminService.resetPassword(isResetPwdOpen.id, resetPwd);
      toast.success('Mot de passe réinitialisé');
      setIsResetPwdOpen(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur');
    }
  };

  // --- SECTIONS ---
  const handleCreateSection = async (e) => {
    e.preventDefault();
    try {
      await sectionService.createSection(newSection);
      toast.success('Section créée');
      setNewSection('');
      setIsSectionFormOpen(false);
      const s = await sectionService.getSections();
      setSections(s);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur');
    }
  };

  const handleDeleteSection = (id) => {
    setConfirm({
      open: true,
      title: 'Supprimer cette section ?',
      message: 'Les utilisateurs associés ne seront pas supprimés mais perdront cette section.',
      type: 'danger',
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await sectionService.deleteSection(id);
          toast.success('Section supprimée');
          const s = await sectionService.getSections();
          setSections(s);
        } catch (err) {
          toast.error('Erreur');
        } finally {
          setConfirmLoading(false);
          setConfirm({ ...confirm, open: false });
        }
      },
    });
  };

  // --- TENANTS ---
  const handleCreateTenant = async (e) => {
    e.preventDefault();
    try {
      await tenantService.createTenant(tenantForm);
      toast.success('Entreprise créée');
      setTenantForm({ name: '', slug: '', email_domain: '', contact_email: '' });
      setIsTenantFormOpen(false);
      fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur');
    }
  };

  const handleToggleTenant = (t) => {
    const newStatus = t.status === 'active' ? 'suspended' : 'active';
    setConfirm({
      open: true,
      title: `${newStatus === 'active' ? 'Réactiver' : 'Suspendre'} "${t.name}" ?`,
      message: newStatus === 'suspended' ? 'Les utilisateurs ne pourront plus se connecter.' : 'Les utilisateurs pourront de nouveau se connecter.',
      type: newStatus === 'suspended' ? 'warning' : 'info',
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await tenantService.updateTenantStatus(t.id, newStatus);
          toast.success(`Entreprise ${newStatus === 'active' ? 'réactivée' : 'suspendue'}`);
          fetchAll();
        } catch (err) {
          toast.error('Erreur');
        } finally {
          setConfirmLoading(false);
          setConfirm({ ...confirm, open: false });
        }
      },
    });
  };

  // --- BRANDING ---
  const handleSaveBranding = async () => {
    setBrandSaving(true);
    try {
      await settingsService.updateSettings({ site_name: branding.site_name, site_description: branding.site_description });
      await settings.refresh();
      toast.success('Paramètres enregistrés');
    } catch (err) {
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setBrandSaving(false);
    }
  };

  const handleUploadLogo = async () => {
    if (!logoFile) return;
    setLogoUploading(true);
    try {
      await settings.uploadLogo(logoFile);
      setLogoFile(null);
      toast.success('Logo mis à jour');
    } catch (err) {
      toast.error("Erreur lors de l'upload du logo");
    } finally {
      setLogoUploading(false);
    }
  };

  // --- DEMANDES ---
  const filteredRequests = requests.filter((r) => {
    if (requestFilter === 'active' && r.archived) return false;
    if (requestFilter === 'archived' && !r.archived) return false;
    if (!requestSearch) return true;
    const s = requestSearch.toLowerCase();
    return (
      (r.nom_entreprise || '').toLowerCase().includes(s) ||
      (r.tenant_name || '').toLowerCase().includes(s) ||
      (r.num_dossier || '').toLowerCase().includes(s) ||
      (r.num_acte || '').toLowerCase().includes(s) ||
      (r.type_document || '').toLowerCase().includes(s) ||
      (r.motif || '').toLowerCase().includes(s)
    );
  });

  const handleArchiveRequest = (r) => {
    setConfirm({
      open: true, type: 'info', title: `Archiver la demande ${r.num_dossier} ?`,
      message: `La demande « ${r.type_document || r.motif || '—'} » de ${r.nom_entreprise} sera masquée du tableau de bord et des statistiques visibles.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await superadminService.archiveRequest(r.id);
          toast.success('Demande archivée');
          fetchAll();
        } catch (err) {
          toast.error("Erreur lors de l'archivage");
        } finally {
          setConfirmLoading(false);
          setConfirm({ ...confirm, open: false });
        }
      },
    });
  };

  const handleUnarchiveRequest = (r) => {
    setConfirm({
      open: true, type: 'info', title: `Désarchiver la demande ${r.num_dossier} ?`,
      message: `La demande « ${r.type_document || r.motif || '—'} » de ${r.nom_entreprise} réapparaîtra dans le tableau de bord et les statistiques.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await superadminService.unarchiveRequest(r.id);
          toast.success('Demande désarchivée');
          fetchAll();
        } catch (err) {
          toast.error('Erreur lors du désarchivage');
        } finally {
          setConfirmLoading(false);
          setConfirm({ ...confirm, open: false });
        }
      },
    });
  };

  const handleDeleteRequest = (r) => {
    setConfirm({
      open: true, type: 'danger', title: 'Supprimer définitivement ?',
      message: `La demande ${r.num_dossier} de ${r.nom_entreprise} sera supprimée définitivement, avec son historique et ses fichiers. Cette action est irréversible.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await superadminService.deleteRequest(r.id);
          toast.success('Demande supprimée');
          fetchAll();
        } catch (err) {
          toast.error('Erreur lors de la suppression');
        } finally {
          setConfirmLoading(false);
          setConfirm({ ...confirm, open: false });
        }
      },
    });
  };

  // --- TABS ---
  const tabs = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'requests', label: 'Demandes', icon: FileText, badge: stats.totalRequests },
    { id: 'users', label: 'Utilisateurs', icon: Users, badge: stats.totalUsers },
    { id: 'superadmins', label: 'Super Admins', icon: Crown, badge: stats.totalSuperAdmins },
    { id: 'sections', label: 'Sections', icon: Layers },
    { id: 'tenants', label: 'Entreprises', icon: Building2, badge: stats.totalTenants },
    { id: 'branding', label: 'Branding', icon: Palette },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in-down">
          <div className="flex items-center gap-3 md:gap-5">
            <button onClick={() => navigate('/dashboard')} className="p-3 bg-white text-slate-700 rounded-2xl shadow-sm border border-slate-200 hover:bg-slate-50 transition-all hover:shadow-md">
              <LayoutDashboard size={22} />
            </button>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 md:p-2.5 bg-gradient-to-br from-red-500 to-red-700 text-white rounded-2xl shadow-lg">
                <Crown size={22} />
              </div>
              <div>
                <h1 className="text-xl md:text-3xl font-black text-slate-900 tracking-tight">Ultra Admin</h1>
                <p className="text-xs md:text-sm text-slate-500 font-medium md:ml-1">Contrôle total de la plateforme</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 bg-white rounded-2xl p-1.5 shadow-sm border border-slate-100 overflow-x-auto scrollbar-none">
          {tabs.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => setActivePanel(id)}
              className={`px-4 md:px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all flex items-center gap-2 whitespace-nowrap ${
                activePanel === id ? 'bg-afgc-primary text-white shadow-md' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon size={15} />
              {label}
              {badge > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activePanel === id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ============ DASHBOARD ============ */}
        {activePanel === 'dashboard' && (
          <div className="animate-fade-in-up">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
              {[
                { label: 'Utilisateurs', value: stats.totalUsers, icon: Users, color: 'blue' },
                { label: 'Super Admins', value: stats.totalSuperAdmins, icon: Crown, color: 'red' },
                { label: 'Entreprises', value: stats.totalTenants, icon: Building2, color: 'emerald' },
                { label: 'Demandes totales', value: stats.totalRequests, icon: TrendingUp, color: 'amber' },
                { label: 'En cours', value: stats.activeRequests, icon: Activity, color: 'purple' },
              ].map((s, i) => (
                <div key={s.label} className="bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-lg transition-all duration-300 animate-fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">{s.label}</p>
                      <h3 className="text-2xl md:text-3xl font-black text-slate-900">{s.value}</h3>
                    </div>
                    <div className={`p-2 rounded-xl bg-${s.color}-50 text-${s.color}-600`}>
                      <s.icon size={20} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Demandes par entreprise */}
            <div className="mt-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl">
                  <Building2 size={18} />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900">Demandes par entreprise</h2>
                  <p className="text-xs text-slate-400 font-medium">Vue synthétique — aucune demande en détail ici</p>
                </div>
              </div>

              {(stats.requestsByTenant || []).length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
                  <Inbox size={32} className="mx-auto mb-2 opacity-40" />
                  Aucune entreprise pour le moment
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {(stats.requestsByTenant || []).map((t, i) => (
                    <div key={t.tenant_id} className="bg-white rounded-2xl border border-slate-100 p-5 hover:shadow-lg transition-all duration-300 animate-fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="p-2 rounded-xl bg-gradient-to-br from-afgc-primary to-slate-800 text-white flex-shrink-0">
                            <Building2 size={16} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-sm text-slate-800 truncate">{t.tenant_name}</h3>
                            <p className="text-[10px] text-slate-400 font-medium">{t.total_requests} demande(s) au total</p>
                          </div>
                        </div>
                        {t.tenant_status === 'suspended' && (
                          <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-500 text-[9px] font-bold flex-shrink-0">Suspendu</span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2.5 rounded-xl bg-amber-50 text-center">
                          <p className="text-lg font-black text-amber-600">{t.active_requests}</p>
                          <p className="text-[9px] font-bold text-amber-500 uppercase tracking-wide">En cours</p>
                        </div>
                        <div className="p-2.5 rounded-xl bg-emerald-50 text-center">
                          <p className="text-lg font-black text-emerald-600">{t.closed_requests}</p>
                          <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-wide">Clôturées</p>
                        </div>
                        <div className="p-2.5 rounded-xl bg-slate-100 text-center">
                          <p className="text-lg font-black text-slate-500">{t.archived_requests}</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Archivées</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============ DEMANDES ============ */}
        {activePanel === 'requests' && (
          <div className="space-y-4 animate-fade-in-up">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex gap-1.5 bg-white rounded-2xl p-1.5 shadow-sm border border-slate-100">
                {[
                  { key: 'active', label: 'Actives', icon: FileText },
                  { key: 'archived', label: 'Archivées', icon: Archive },
                  { key: 'all', label: 'Toutes', icon: Inbox },
                ].map((f) => (
                  <button key={f.key} onClick={() => setRequestFilter(f.key)} className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${requestFilter === f.key ? 'bg-afgc-primary text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                    <f.icon size={13} /> {f.label}
                  </button>
                ))}
              </div>
              <div className="relative flex-1 sm:max-w-xs">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={requestSearch} onChange={(e) => setRequestSearch(e.target.value)} className="input-premium pl-10" placeholder="Rechercher (entreprise, dossier, motif…)" />
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-400">
                      <th className="px-4 py-3 font-bold">Entreprise</th>
                      <th className="px-4 py-3 font-bold">Dossier</th>
                      <th className="px-4 py-3 font-bold">Document</th>
                      <th className="px-4 py-3 font-bold">Statut</th>
                      <th className="px-4 py-3 font-bold">Priorité</th>
                      <th className="px-4 py-3 font-bold">Date</th>
                      <th className="px-4 py-3 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                        <Inbox size={32} className="mx-auto mb-2 opacity-40" />
                        {requestFilter === 'archived' ? 'Aucune demande archivée' : 'Aucune demande trouvée'}
                      </td></tr>
                    )}
                    {filteredRequests.map((r) => (
                      <tr key={r.id} className={`border-t border-slate-50 hover:bg-blue-50/30 transition-colors ${r.archived ? 'opacity-60 bg-slate-50/50' : ''}`}>
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-800 text-xs">{r.tenant_name || '—'}</p>
                          <p className="text-[10px] text-slate-400">{r.nom_entreprise}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs font-bold text-slate-700">{r.num_dossier}</p>
                          <p className="text-[10px] text-slate-400">{r.num_acte} · {r.annee}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-semibold text-slate-700">{r.type_document || '—'}</p>
                          <p className="text-[10px] text-slate-400 truncate max-w-[140px]">{r.motif}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`status-badge status-badge-${(r.statut || '').replace(/\s+/g, '').toLowerCase()}`}>{r.statut}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            r.priorite === 'haute' ? 'bg-red-100 text-red-600' : r.priorite === 'urgente' ? 'bg-red-100 text-red-600' : r.priorite === 'basse' ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600'
                          }`}>{r.priorite || 'normale'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs text-slate-600 flex items-center gap-1"><Calendar size={11} className="text-slate-300" /> {new Date(r.created_at).toLocaleDateString('fr-FR')}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {r.archived ? (
                              <button onClick={() => handleUnarchiveRequest(r)} className="p-2 rounded-lg text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors" title="Désarchiver">
                                <ArchiveRestore size={15} />
                              </button>
                            ) : (
                              <button onClick={() => handleArchiveRequest(r)} className="p-2 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-colors" title="Archiver">
                                <Archive size={15} />
                              </button>
                            )}
                            <button onClick={() => handleDeleteRequest(r)} className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="Supprimer définitivement">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-400 flex items-center justify-between">
                <span><strong className="text-slate-600">{filteredRequests.length}</strong> demande(s) affichée(s)</span>
                <span className="flex items-center gap-1"><Archive size={12} /> L'archivage retire la demande du tableau de bord sans la supprimer</span>
              </div>
            </div>
          </div>
        )}

        {/* ============ USERS ============ */}
        {(activePanel === 'users' || activePanel === 'superadmins') && (
          <div className="space-y-4 animate-fade-in-up">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1 max-w-full md:max-w-sm">
                <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input-premium pl-12" placeholder="Rechercher un utilisateur..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
              {activePanel === 'users' && (
                <>
                  <select className="input-premium w-auto" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                    <option value="all">Tous les rôles</option>
                    {ALL_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                  <select className="input-premium w-auto" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
                    <option value="all">Toutes les entreprises</option>
                    {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </>
              )}
              <button onClick={() => { setUserForm({ username: '', password: '', full_name: '', email: '', section: '', role: activePanel === 'superadmins' ? 'superadmin' : 'demandeur', tenant_id: tenants[0]?.id || '' }); setIsCreateOpen(true); }} className="btn-primary flex items-center justify-center gap-2">
                <Plus size={18} /> Nouvel utilisateur
              </button>
            </div>

            {/* User cards */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1,2,3,4,5,6].map(i => <div key={i} className="bg-white rounded-2xl p-5 border border-slate-100 space-y-3"><div className="skeleton h-12 w-12 rounded-full"></div><div className="skeleton h-4 w-3/4 rounded"></div><div className="skeleton h-3 w-1/2 rounded"></div></div>)}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredUsers.map((u, idx) => (
                  <div key={u.id} className="bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-lg hover:border-blue-200/50 transition-all duration-300 group animate-fade-in-up" style={{ animationDelay: `${idx * 30}ms` }}>
                    <div className="flex items-start gap-4 mb-3">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-sm flex-shrink-0 ${u.role === 'superadmin' ? 'bg-gradient-to-br from-red-500 to-red-700' : 'bg-gradient-to-br from-afgc-secondary to-blue-600'}`}>
                        {u.role === 'superadmin' ? <Crown size={20} /> : (u.full_name?.charAt(0)?.toUpperCase() || '?')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 truncate">{u.full_name || 'N/A'}</p>
                        <p className="text-xs text-slate-400">@{u.username}</p>
                        {u.tenant_name && <p className="text-[10px] text-slate-300 flex items-center gap-1 mt-0.5"><Building2 size={9} /> {u.tenant_name}</p>}
                      </div>
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider whitespace-nowrap ${roleColor(u.role)}`}>
                        {u.role}
                      </span>
                    </div>
                    <div className="space-y-1 text-xs text-slate-500 mb-3">
                      <p className="flex items-center gap-1.5 truncate"><Mail size={11} className="text-slate-400 flex-shrink-0" /> {u.email || 'N/A'}</p>
                      {u.section && <p className="flex items-center gap-1.5"><Layers size={11} className="text-slate-400 flex-shrink-0" /> {u.section}</p>}
                      {u.open_requests > 0 && <p className="flex items-center gap-1.5 text-amber-600 font-bold"><Activity size={11} /> {u.open_requests} demande(s) en cours</p>}
                    </div>
                    <div className="flex gap-1.5 pt-3 border-t border-slate-100">
                      <button onClick={() => handleEditUser(u)} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl text-slate-500 hover:bg-slate-50 transition-colors text-xs font-semibold">
                        <Pencil size={12} /> Modifier
                      </button>
                      <button onClick={() => openResetPwd(u)} className="flex items-center justify-center gap-1 py-2 px-3 rounded-xl text-amber-500 hover:bg-amber-50 transition-colors text-xs font-semibold">
                        <KeyRound size={12} />
                      </button>
                      <button onClick={() => handleDeleteUser(u)} className="flex items-center justify-center gap-1 py-2 px-3 rounded-xl text-red-400 hover:bg-red-50 transition-colors text-xs font-semibold">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                {filteredUsers.length === 0 && (
                  <div className="col-span-full text-center py-16 text-slate-400">
                    <Users size={48} className="mx-auto mb-4 text-slate-200" />
                    <p className="font-bold text-lg">Aucun utilisateur trouvé</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============ SECTIONS ============ */}
        {activePanel === 'sections' && (
          <div className="space-y-4 animate-fade-in-up">
            <div className="flex justify-end">
              <button onClick={() => setIsSectionFormOpen(true)} className="btn-primary flex items-center gap-2">
                <Plus size={18} /> Nouvelle section
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sections.map((s, idx) => (
                <div key={s.id} className="bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-lg transition-all duration-300 group animate-fade-in-up" style={{ animationDelay: `${idx * 60}ms` }}>
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-slate-800">{s.name}</h3>
                      <p className="text-xs text-slate-400 mt-1">{new Date(s.created_at).toLocaleDateString('fr-FR')}</p>
                    </div>
                    <button onClick={() => handleDeleteSection(s.id)} className="p-2 rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors" title="Supprimer">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============ TENANTS ============ */}
        {activePanel === 'tenants' && (
          <div className="space-y-4 animate-fade-in-up">
            <div className="flex justify-end">
              <button onClick={() => setIsTenantFormOpen(true)} className="btn-primary flex items-center gap-2">
                <Building2 size={18} /> Nouvelle entreprise
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tenants.map((t) => {
                const suspended = t.status === 'suspended';
                return (
                  <div key={t.id} className={`glass-card-premium p-5 border transition-all ${suspended ? 'opacity-60 border-red-200' : 'border-transparent'}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${suspended ? 'bg-red-100 text-red-500' : 'bg-emerald-100 text-emerald-600'}`}>
                          <Building2 size={20} />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-800 text-sm">{t.name}</h3>
                          <p className="text-xs text-slate-400 font-mono">{t.slug}</p>
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded-lg text-xs font-bold ${suspended ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                        {suspended ? 'Suspendue' : 'Active'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mb-3">{new Date(t.created_at).toLocaleDateString('fr-FR')}</p>
                    <div className="flex gap-2 pt-3 border-t border-slate-100">
                      <button onClick={() => handleToggleTenant(t)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${suspended ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200' : 'bg-amber-100 text-amber-600 hover:bg-amber-200'}`}>
                        {suspended ? <><ToggleRight size={14} /> Réactiver</> : <><ToggleLeft size={14} /> Suspendre</>}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ============ BRANDING ============ */}
        {activePanel === 'branding' && (
          <div className="space-y-6 animate-fade-in-up">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="glass-card-premium p-6">
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Palette size={18} /> Identité du site</h3>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Nom du site</label>
                    <input className="input-premium" value={branding.site_name} onChange={(e) => setBranding({...branding, site_name: e.target.value})} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Description</label>
                    <input className="input-premium" value={branding.site_description} onChange={(e) => setBranding({...branding, site_description: e.target.value})} />
                  </div>
                  <button onClick={handleSaveBranding} disabled={brandSaving} className="btn-primary w-full flex items-center justify-center gap-2">
                    {brandSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
                    {brandSaving ? '...' : 'Enregistrer'}
                  </button>
                </div>
              </div>
              <div className="glass-card-premium p-6">
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Image size={18} /> Logo</h3>
                <div className="flex flex-col items-center gap-4">
                  <div className="w-32 h-32 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                    {logoPreview ? <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-2" /> : <Image size={40} className="text-slate-300" />}
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); } }} className="hidden" />
                  <div className="flex gap-3">
                    <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex items-center gap-2"><Upload size={16} /> Choisir</button>
                    {logoFile && <button onClick={handleUploadLogo} disabled={logoUploading} className="btn-primary flex items-center gap-2">{logoUploading ? '...' : 'Enregistrer'}</button>}
                  </div>
                </div>
              </div>
            </div>
            <div className="glass-card-premium p-6">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Aperçu</h3>
              <div className="flex items-center gap-4 p-4 bg-gradient-to-br from-afgc-primary to-slate-900 rounded-2xl">
                <div className="w-12 h-12 rounded-full bg-white/10 overflow-hidden flex-shrink-0 border-2 border-white/20">
                  {logoPreview ? <img src={logoPreview} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-white/50 font-bold">?</div>}
                </div>
                <div>
                  <p className="text-white font-bold">{branding.site_name || 'DocuFlow'}</p>
                  <p className="text-white/50 text-xs">{branding.site_description || 'Plateforme'}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============ MODALS ============ */}

      {/* Create / Edit User */}
      {(isCreateOpen || editUser) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => { setIsCreateOpen(false); setEditUser(null); }}>
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl animate-scale-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-3">
                {editUser ? <Pencil size={22} className="text-blue-500" /> : <Plus size={22} className="text-blue-500" />}
                {editUser ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
              </h2>
              <button onClick={() => { setIsCreateOpen(false); setEditUser(null); }} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-400" /></button>
            </div>
            <div className="p-8 space-y-4 max-h-[70vh] overflow-y-auto">
              {[
                { key: 'full_name', label: 'Nom complet', type: 'text' },
                { key: 'username', label: 'Identifiant', type: 'text' },
                { key: 'email', label: 'Email', type: 'email' },
                ...(isCreateOpen ? [{ key: 'password', label: 'Mot de passe', type: showPwd ? 'text' : 'password' }] : []),
              ].map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{f.label}</label>
                  <div className="relative">
                    <input
                      type={f.type}
                      className="input-premium pr-10"
                      value={editUser ? (editUser[f.key] || '') : (userForm[f.key] || '')}
                      onChange={(e) => editUser ? setEditUser({ ...editUser, [f.key]: e.target.value }) : setUserForm({ ...userForm, [f.key]: e.target.value })}
                      required={f.key !== 'section'}
                      minLength={f.key === 'password' ? 6 : undefined}
                    />
                    {f.key === 'password' && (
                      <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {/* Role */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Rôle</label>
                <div className="flex gap-2">
                  {ALL_ROLES.map((r) => (
                    <button key={r.key} type="button"
                      onClick={() => editUser ? setEditUser({ ...editUser, role: r.key }) : setUserForm({ ...userForm, role: r.key })}
                      className={`flex-1 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${
                        (editUser ? editUser.role : userForm.role) === r.key ? 'bg-afgc-primary text-white shadow-md' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Section */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Section</label>
                <select className="input-premium"
                  value={editUser ? (editUser.section || '') : (userForm.section || '')}
                  onChange={(e) => editUser ? setEditUser({ ...editUser, section: e.target.value }) : setUserForm({ ...userForm, section: e.target.value })}>
                  <option value="">— Aucune —</option>
                  {sections.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              {/* Tenant */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Entreprise</label>
                <select className="input-premium"
                  value={editUser ? (editUser.tenant_id || '') : (userForm.tenant_id || '')}
                  onChange={(e) => editUser ? setEditUser({ ...editUser, tenant_id: e.target.value }) : setUserForm({ ...userForm, tenant_id: e.target.value })}>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button onClick={() => { setIsCreateOpen(false); setEditUser(null); }} className="btn-secondary flex-1">Annuler</button>
                <button onClick={editUser ? handleSaveEdit : handleCreateUser} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  <Save size={18} /> {editUser ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password */}
      {isResetPwdOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setIsResetPwdOpen(null)}>
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-scale-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><KeyRound size={18} className="text-amber-500" /> Nouveau mot de passe</h2>
              <button onClick={() => setIsResetPwdOpen(null)} className="p-2 hover:bg-slate-100 rounded-full"><X size={18} className="text-slate-400" /></button>
            </div>
            <div className="p-8 space-y-4">
              <p className="text-sm text-slate-500">Pour <strong>{isResetPwdOpen.full_name}</strong> (@{isResetPwdOpen.username})</p>
              <div className="relative">
                <input type={showPwd ? 'text' : 'password'} className="input-premium pr-10" placeholder="Nouveau mot de passe (6+ caractères)" value={resetPwd} onChange={(e) => setResetPwd(e.target.value)} />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setIsResetPwdOpen(null)} className="btn-secondary flex-1">Annuler</button>
                <button onClick={handleResetPwd} disabled={!resetPwd || resetPwd.length < 6} className="btn-primary flex-1 flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50">
                  <KeyRound size={16} /> Réinitialiser
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Section */}
      {isSectionFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setIsSectionFormOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl animate-scale-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">Nouvelle section</h2>
              <button onClick={() => setIsSectionFormOpen(false)} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-400" /></button>
            </div>
            <form onSubmit={handleCreateSection} className="p-8 space-y-4">
              <input className="input-premium" value={newSection} onChange={(e) => setNewSection(e.target.value)} required placeholder="Nom de la section" />
              <div className="flex gap-3">
                <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2"><Plus size={18} /> Ajouter</button>
                <button type="button" onClick={() => setIsSectionFormOpen(false)} className="btn-secondary flex-1">Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Tenant */}
      {isTenantFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setIsTenantFormOpen(false)}>
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl animate-scale-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Building2 size={20} className="text-emerald-500" /> Nouvelle entreprise</h2>
              <button onClick={() => setIsTenantFormOpen(false)} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-400" /></button>
            </div>
            <form onSubmit={handleCreateTenant} className="p-8 space-y-4">
              <input className="input-premium" value={tenantForm.name} onChange={(e) => setTenantForm({...tenantForm, name: e.target.value})} required placeholder="Nom de l'entreprise" />
              <input className="input-premium" value={tenantForm.slug} onChange={(e) => setTenantForm({...tenantForm, slug: e.target.value.toLowerCase().replace(/\s+/g, '-')})} required placeholder="Slug (ex: afgc)" />
              <input className="input-premium" value={tenantForm.email_domain} onChange={(e) => setTenantForm({...tenantForm, email_domain: e.target.value})} placeholder="Domaine email (optionnel)" />
              <input className="input-premium" type="email" value={tenantForm.contact_email} onChange={(e) => setTenantForm({...tenantForm, contact_email: e.target.value})} placeholder="Email de contact (optionnel)" />
              <div className="flex gap-3">
                <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2"><Building2 size={18} /> Créer</button>
                <button type="button" onClick={() => setIsTenantFormOpen(false)} className="btn-secondary flex-1">Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog isOpen={confirm.open} title={confirm.title} message={confirm.message} type={confirm.type} loading={confirmLoading} onConfirm={confirm.onConfirm} onClose={() => setConfirm({ ...confirm, open: false })} />
    </div>
  );
};

export default SuperAdminPage;
