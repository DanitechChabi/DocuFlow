import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { userService } from '../services/userService';
import { sectionService } from '../services/sectionService';
import { settingsService } from '../services/settingsService';

import { authService } from '../services/authService';
import { useSettings } from '../contexts/SettingsContext';
import {
  Users, Layers, Palette, Building2,
  X, Plus, Trash2, Search, UserCog, Upload, Pencil,
  Users2, Database, SlidersHorizontal, FolderTree, ListChecks
} from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import ThemeManager from '../components/ThemeManager';
import GroupManager from '../components/admin/GroupManager';
import MetadataSchemaPanel from '../components/admin/MetadataSchemaPanel';
import RequestFieldsPanel from '../components/admin/RequestFieldsPanel';
import ConfigurationConsole from '../components/admin/ConfigurationConsole';
import FolderManager from '../components/admin/FolderManager';
import PageHeader from '../components/PageHeader';
import { useOngletUrl } from '../hooks/useOngletUrl';
import { toast } from '../components/Toast';

const roleColor = (role) => ({
  demandeur: 'bg-green-100 text-green-600',
  archiviste: 'bg-blue-100 text-blue-600',
  admin: 'bg-purple-100 text-purple-600',
  superadmin: 'bg-red-100 text-red-600',
}[role] || 'bg-slate-100 text-slate-600');

const ROLE_OPTIONS = [
  { key: 'demandeur', label: 'Demandeur' },
  { key: 'archiviste', label: 'Archiviste' },
  { key: 'admin', label: 'Admin' },
];

// Déclaré hors du composant : `useOngletUrl` mémorise sur ce tableau, et un
// littéral reconstruit à chaque rendu invaliderait le calcul en permanence.
// L'ordre fixe le premier élément comme onglet par défaut.
const PANNEAUX = ['users', 'sections', 'groups', 'metadata', 'request-fields', 'folders', 'branding', 'configuration'];

// Libellé lisible de chaque panneau, pour le fil d'Ariane et le titre d'onglet du
// navigateur. Sans lui, dix onglets « Administration » resteraient indiscernables
// et le fil s'arrêterait au niveau de la page, sans dire où l'on est dedans.
const NOMS_PANNEAUX = {
  users: 'Utilisateurs',
  sections: 'Sections',
  groups: 'Groupes',
  metadata: 'Métadonnées',
  'request-fields': 'Champs de demande',
  folders: 'Dossiers',
  branding: 'Branding',
  configuration: 'Configuration',
};

/**
 * CompanyAdminPage — Espace d'administration SCOPÉ à l'entreprise connectée.
 * Le superadmin d'entreprise gère UNIQUEMENT les utilisateurs, sections et
 * branding de SON tenant. Aucune donnée d'une autre entreprise n'est visible.
 */
const CompanyAdminPage = () => {
  const navigate = useNavigate();
  const user = authService.getCurrentUser();
  const settings = useSettings();

  // L'onglet vit dans l'URL : il survit à F5, se partage par lien et se traverse
  // au bouton Retour. Voir useOngletUrl pour le détail de ce que l'état local
  // faisait perdre.
  const [activePanel, setActivePanel] = useOngletUrl(PANNEAUX);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Utilisateurs de SON entreprise
  const [users, setUsers] = useState([]);
  // Sections de SON entreprise
  const [sections, setSections] = useState([]);

  // Modals / formulaires
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [userForm, setUserForm] = useState({ username: '', password: '', full_name: '', email: '', section: '', role: 'demandeur' });
  const [newSection, setNewSection] = useState('');

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

  const isOwner = user?.tenant_id === 1;

  // Le schéma de métadonnées est chargé et enregistré par MetadataSchemaPanel,
  // qui sert aussi la console superadministrateur : un seul endroit à corriger.

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, sectionsRes] = await Promise.allSettled([
        userService.getAllUsers(),
        sectionService.getSections(),
      ]);
      if (usersRes.status === 'fulfilled') setUsers(usersRes.value);
      if (sectionsRes.status === 'fulfilled') setSections(sectionsRes.value);
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

  // --- UTILISATEURS ---
  const filteredUsers = users.filter((u) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (u.full_name || '').toLowerCase().includes(s) || (u.username || '').toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s);
  });

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await userService.createUser(userForm);
      toast.success('Utilisateur créé avec succès');
      setIsCreateOpen(false);
      setUserForm({ username: '', password: '', full_name: '', email: '', section: '', role: 'demandeur' });
      fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la création');
    }
  };

  const handleEditUser = (u) => setEditUser({ ...u, password: '' });

  const handleSaveEdit = async () => {
    try {
      await userService.updateUserRole(editUser.id, editUser.role);
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
      message: `Cette action supprimera définitivement le compte de ${u.full_name} (${u.role}) de votre entreprise.`,
      type: 'danger',
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await userService.deleteUser(u.id);
          toast.success('Utilisateur supprimé');
          fetchAll();
        } catch (err) {
          toast.error(err.response?.data?.message || 'Erreur lors de la suppression');
        } finally {
          setConfirmLoading(false);
          setConfirm({ ...confirm, open: false });
        }
      },
    });
  };

  // --- SECTIONS ---
  const handleCreateSection = async (e) => {
    e.preventDefault();
    if (!newSection.trim()) return;
    try {
      await sectionService.createSection(newSection.trim());
      toast.success('Section créée');
      setNewSection('');
      fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.message || "Erreur lors de la création de la section");
    }
  };

  const handleDeleteSection = (s) => {
    setConfirm({
      open: true,
      title: `Supprimer la section "${s.name}" ?`,
      message: 'Cette section sera supprimée de votre entreprise.',
      type: 'danger',
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await sectionService.deleteSection(s.id);
          toast.success('Section supprimée');
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
      await settingsService.uploadLogo(logoFile);
      setLogoFile(null);
      toast.success('Logo mis à jour');
    } catch (err) {
      toast.error("Erreur lors de l'upload du logo");
    } finally {
      setLogoUploading(false);
    }
  };

  const tabs = [
    { id: 'users', label: 'Utilisateurs', icon: Users, badge: users.length },
    { id: 'sections', label: 'Sections', icon: Layers, badge: sections.length },
    { id: 'groups', label: 'Groupes', icon: Users2 },
    { id: 'metadata', label: 'Métadonnées', icon: Database },
    { id: 'request-fields', label: 'Champs de demande', icon: ListChecks },
    { id: 'folders', label: 'Dossiers', icon: FolderTree },
    { id: 'branding', label: 'Branding', icon: Palette },
    { id: 'configuration', label: 'Configuration', icon: SlidersHorizontal },
  ];

  // Sécurité : un superadmin d'une autre entreprise ne doit JAMAIS voir le portail global.
  // Cette page est scoped ; si jamais un propriétaire arrive ici, on redirige vers le portail global.
  useEffect(() => {
    if (isOwner) navigate('/super-admin-portal');
  }, [isOwner, navigate]);

  if (isOwner) return null;

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Le fil d'Ariane descend jusqu'au panneau : sans son dernier segment, un
            administrateur à trois niveaux de profondeur ne lisait nulle part dans
            quelle rubrique il se trouvait — seul le bouton d'onglet le disait, et
            il faut le chercher. Le titre d'onglet du navigateur porte lui aussi le
            panneau, pour distinguer plusieurs fenêtres d'administration. */}
        <PageHeader
          title="Administration"
          subtitle={`Espace de votre entreprise — ${settings.site_name || 'DocuFlow'}`}
          icon={Building2}
          documentTitle={`${NOMS_PANNEAUX[activePanel]} — Administration`}
          breadcrumb={[
            { label: 'Tableau de bord', to: '/dashboard' },
            { label: 'Administration' },
            { label: NOMS_PANNEAUX[activePanel] },
          ]}
        />

        {/* Onglets. `role="tablist"` et `aria-selected` remplacent la mise en
            forme seule : un lecteur d'écran annonçait auparavant sept boutons
            identiques, sans dire lequel était actif ni combien il y en avait. */}
        <div
          role="tablist"
          aria-label="Rubriques d'administration"
          className="flex gap-1.5 bg-white rounded-2xl p-1.5 shadow-sm border border-slate-100 overflow-x-auto scrollbar-none"
        >
          {tabs.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activePanel === id}
              onClick={() => setActivePanel(id)}
              className={`px-4 md:px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all flex items-center gap-2 whitespace-nowrap ${
                activePanel === id ? 'bg-docuflow-primary text-white shadow-md' : 'text-slate-500 hover:text-slate-800'
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

        {/* ============ UTILISATEURS ============ */}
        {activePanel === 'users' && (
          <div className="space-y-4 animate-fade-in-up">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1 sm:max-w-xs">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="input-premium pl-10" placeholder="Rechercher un utilisateur…" />
              </div>
              <button onClick={() => setIsCreateOpen(true)} className="btn-primary flex items-center gap-2">
                <Plus size={18} /> Nouvel utilisateur
              </button>
            </div>

            {/* Liste */}
            {loading ? (
              <div className="grid gap-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-2xl skeleton" />)}</div>
            ) : filteredUsers.length === 0 ? (
              <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-blue-50 flex items-center justify-center">
                  <Users size={26} className="text-blue-400" />
                </div>
                <h3 className="text-base font-black text-slate-800 mb-1">Aucun utilisateur</h3>
                <p className="text-sm text-slate-400 max-w-sm mx-auto mb-5">
                  Votre entreprise n'a pas encore de collaborateur. Créez vos premiers utilisateurs (demandeurs, archivistes, admins).
                </p>
                <button onClick={() => setIsCreateOpen(true)} className="btn-primary flex items-center gap-2 mx-auto">
                  <Plus size={18} /> Créer un utilisateur
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-400">
                        <th className="px-5 py-3 font-bold">Utilisateur</th>
                        <th className="px-5 py-3 font-bold">Rôle</th>
                        <th className="px-5 py-3 font-bold">Section</th>
                        <th className="px-5 py-3 font-bold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr key={u.id} className="border-t border-slate-50 hover:bg-blue-50/30 transition-colors">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-docuflow-primary to-docuflow-secondary text-white flex items-center justify-center text-xs font-black flex-shrink-0">
                                {(u.full_name || '?').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-bold text-slate-800 text-sm">{u.full_name || u.username}</p>
                                <p className="text-xs text-slate-400">@{u.username} · {u.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${roleColor(u.role)}`}>{u.role}</span>
                          </td>
                          <td className="px-5 py-3 text-slate-500 text-xs">{u.section || '—'}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => handleEditUser(u)} className="p-2 rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="Modifier le rôle">
                                <Pencil size={15} />
                              </button>
                              {u.id !== user?.id && (
                                <button onClick={() => handleDeleteUser(u)} className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="Supprimer">
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============ GROUPES ============ */}
        {activePanel === 'groups' && (
          <div className="animate-fade-in-up">
            <GroupManager />
          </div>
        )}

        {/* ============ MÉTADONNÉES ============ */}
        {activePanel === 'metadata' && (
          <div className="animate-fade-in-up">
            <MetadataSchemaPanel />
          </div>
        )}

        {/* ============ CHAMPS DE DEMANDE ============ */}
        {activePanel === 'request-fields' && (
          <div className="animate-fade-in-up">
            <RequestFieldsPanel />
          </div>
        )}

        {/* ============ DOSSIERS ============ */}
        {activePanel === 'folders' && (
          <div className="animate-fade-in-up">
            <FolderManager />
          </div>
        )}

        {/* ============ CONFIGURATION ============ */}
        {/* Console générée depuis le catalogue backend : tout paramètre ajouté à
            config/settingsCatalog.js y apparaît sans modifier cette page. */}
        {activePanel === 'configuration' && (
          <div className="animate-fade-in-up">
            <ConfigurationConsole />
          </div>
        )}

        {/* ============ SECTIONS ============ */}
        {activePanel === 'sections' && (
          <div className="space-y-4 animate-fade-in-up">
            <form onSubmit={handleCreateSection} className="flex gap-3 bg-white rounded-2xl border border-slate-100 p-3">
              <input
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                className="input-premium flex-1"
                placeholder="Nouvelle section (ex : Ressources Humaines)"
                required
              />
              <button type="submit" className="btn-primary flex items-center gap-2 flex-shrink-0">
                <Plus size={18} /> Ajouter
              </button>
            </form>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sections.map((s) => (
                <div key={s.id} className="glass-card-premium p-4 flex items-center justify-between border border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-blue-50 text-docuflow-secondary">
                      <Layers size={18} />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-sm">{s.name}</h3>
                      <p className="text-xs text-slate-400 mt-1">Section de votre entreprise</p>
                    </div>
                  </div>
                  <button onClick={() => handleDeleteSection(s)} className="p-2 rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors" title="Supprimer">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {sections.length === 0 && (
                <div className="col-span-full bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center text-slate-400">
                  <Layers size={28} className="mx-auto mb-2 opacity-40" />
                  Aucune section pour le moment. Ajoutez vos services.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============ BRANDING ============ */}
        {activePanel === 'branding' && (
          <>
          <div className="grid lg:grid-cols-2 gap-5 animate-fade-in-up">
            <div className="glass-card-premium p-6 space-y-5">
              <div className="flex items-center gap-2 mb-2">
                <Palette size={18} className="text-docuflow-secondary" />
                <h3 className="font-black text-slate-800">Identité de votre entreprise</h3>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Nom de l'entreprise</label>
                <input className="input-premium" value={branding.site_name} onChange={(e) => setBranding({ ...branding, site_name: e.target.value })} placeholder="Nom de votre entreprise" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Description</label>
                <textarea className="input-premium min-h-[90px] resize-none" value={branding.site_description} onChange={(e) => setBranding({ ...branding, site_description: e.target.value })} placeholder="Décrivez votre plateforme" />
              </div>
              <button onClick={handleSaveBranding} disabled={brandSaving} className="btn-primary flex items-center gap-2">
                <UserCog size={16} /> {brandSaving ? 'Enregistrement…' : 'Enregistrer'}
              </button>

              <div className="pt-4 border-t border-slate-100">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Logo</label>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => { const f = e.target.files[0]; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); } }} className="hidden" />
                <div className="flex gap-3">
                  <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex items-center gap-2"><Upload size={16} /> Choisir</button>
                  {logoFile && <button onClick={handleUploadLogo} disabled={logoUploading} className="btn-primary flex items-center gap-2">{logoUploading ? '...' : 'Enregistrer'}</button>}
                </div>
              </div>
            </div>

            <div className="glass-card-premium p-6">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Aperçu</h3>
              <div className="flex items-center gap-4 p-4 bg-gradient-to-br from-docuflow-primary to-slate-900 rounded-2xl">
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

          {/* Thème & Couleurs */}
          <div className="glass-card-premium p-6 mt-5">
            <ThemeManager />
          </div>
          </>
        )}

        {/* ============ MODALS ============ */}

        {/* Créer un utilisateur */}
        {isCreateOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setIsCreateOpen(false)}>
            <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl animate-scale-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 pb-3">
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2"><Users size={20} className="text-docuflow-secondary" /> Nouvel utilisateur</h3>
                <button onClick={() => setIsCreateOpen(false)} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-400" /></button>
              </div>
              <form onSubmit={handleCreateUser} className="p-6 pt-3 space-y-3">
                <input className="input-premium" value={userForm.full_name} onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })} required placeholder="Nom complet" />
                <input className="input-premium" value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} required placeholder="Nom d'utilisateur" />
                <input className="input-premium" type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required placeholder="Email" />
                <input className="input-premium" type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} required minLength={6} placeholder="Mot de passe (min 6 caractères)" />
                <div className="grid grid-cols-2 gap-3">
                  <select className="input-premium" value={userForm.section} onChange={(e) => setUserForm({ ...userForm, section: e.target.value })}>
                    <option value="">Section…</option>
                    {sections.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                  <select className="input-premium" value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                    {ROLE_OPTIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2"><Users size={18} /> Créer</button>
                  <button type="button" onClick={() => setIsCreateOpen(false)} className="btn-secondary flex-1">Annuler</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modifier le rôle */}
        {editUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setEditUser(null)}>
            <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-scale-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 pb-3">
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2"><UserCog size={20} className="text-docuflow-secondary" /> Modifier {editUser.full_name}</h3>
                <button onClick={() => setEditUser(null)} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-400" /></button>
              </div>
              <div className="p-6 pt-3 space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Rôle</label>
                  <select className="input-premium" value={editUser.role} onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}>
                    {ROLE_OPTIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
                <div className="flex gap-3">
                  <button onClick={handleSaveEdit} className="btn-primary flex-1 flex items-center justify-center gap-2"><UserCog size={16} /> Enregistrer</button>
                  <button onClick={() => setEditUser(null)} className="btn-secondary flex-1">Annuler</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog isOpen={confirm.open} title={confirm.title} message={confirm.message} type={confirm.type} loading={confirmLoading} onConfirm={confirm.onConfirm} onClose={() => setConfirm({ ...confirm, open: false })} />
    </div>
  );
};

export default CompanyAdminPage;
