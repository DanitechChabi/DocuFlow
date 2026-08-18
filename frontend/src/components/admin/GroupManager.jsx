import React, { useState, useEffect, useCallback } from 'react';
import { groupService } from '../../services/groupService';
import { userService } from '../../services/userService';
import { toast } from '../Toast';
import ConfirmDialog from '../ConfirmDialog';
import {
  Users, UserPlus, UserMinus, Trash2, Plus, Search,
  ChevronRight, Loader2, Users2
} from 'lucide-react';

/**
 * GroupManager — Component for managing user groups and their memberships.
 * Intended to be used within CompanyAdminPage or SuperAdminPage.
 */
const GroupManager = () => {
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [creatingLoading, setCreatingLoading] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [userToAdd, setUserToAdd] = useState('');
  const [availableUsers, setAvailableUsers] = useState([]);

  const [confirm, setConfirm] = useState({
    open: false,
    title: '',
    message: '',
    type: 'danger',
    onConfirm: null
  });

  // --- FETCH ---
  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await groupService.getGroups();
      setGroups(data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du chargement des groupes');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAvailableUsers = useCallback(async () => {
    try {
      const data = await userService.getAllUsers();
      setAvailableUsers(data);
    } catch (err) {
      toast.error('Erreur lors du chargement des utilisateurs');
    }
  }, []);

  useEffect(() => {
    fetchGroups();
    fetchAvailableUsers();
  }, [fetchGroups, fetchAvailableUsers]);

  const fetchMembers = async (group) => {
    setSelectedGroup(group);
    setMembersLoading(true);
    try {
      const data = await groupService.getUsersInGroup(group.id);
      setMembers(data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du chargement des membres');
    } finally {
      setMembersLoading(false);
    }
  };

  // --- ACTIONS ---
  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setCreatingLoading(true);
    try {
      await groupService.createGroup({ name: newGroupName.trim() });
      toast.success('Groupe créé avec succès');
      setNewGroupName('');
      fetchGroups();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la création du groupe');
    } finally {
      setCreatingLoading(false);
    }
  };

  const handleDeleteGroup = (group) => {
    setConfirm({
      open: true,
      title: `Supprimer le groupe "${group.name}" ?`,
      message: `Cette action supprimera le groupe et toutes ses associations de membres.`,
      type: 'danger',
      onConfirm: async () => {
        try {
          await groupService.deleteGroup(group.id);
          toast.success('Groupe supprimé');
          if (selectedGroup?.id === group.id) {
            setSelectedGroup(null);
            setMembers([]);
          }
          fetchGroups();
        } catch (err) {
          toast.error(err.response?.data?.message || 'Erreur lors de la suppression');
        } finally {
          setConfirm({ ...confirm, open: false });
        }
      },
    });
  };

  const handleAddUserToGroup = async (e) => {
    e.preventDefault();
    if (!userToAdd || !selectedGroup) return;

    const user = availableUsers.find(u => u.id === parseInt(userToAdd));
    if (!user) return;

    try {
      await groupService.addUserToGroup(selectedGroup.id, user.id);
      toast.success(`${user.full_name} ajouté au groupe`);
      setUserToAdd('');
      fetchMembers(selectedGroup);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'ajout du membre');
    }
  };

  const handleRemoveUserFromGroup = async (userId) => {
    if (!selectedGroup) return;
    try {
      await groupService.removeUserFromGroup(selectedGroup.id, userId);
      toast.success('Membre retiré du groupe');
      fetchMembers(selectedGroup);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du retrait du membre');
    }
  };

  const filteredGroups = groups.filter(g =>
    g.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <Loader2 className="animate-spin text-docuflow-primary" size={32} />
        <p className="text-slate-500 font-medium">Chargement des groupes...</p>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-12 gap-6 animate-fade-in-up">
      {/* Left Column: Group List */}
      <div className="lg:col-span-4 space-y-4">
        <div className="glass-card-premium p-5 border border-slate-100 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-black text-slate-800 flex items-center gap-2">
              <Users2 size={20} className="text-docuflow-secondary" />
              Groupes
            </h3>
          </div>

          {/* Create Group Form */}
          <form onSubmit={handleCreateGroup} className="flex gap-2">
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="input-premium flex-1"
              placeholder="Nouveau groupe..."
              required
            />
            <button
              type="submit"
              disabled={creatingLoading}
              className="btn-primary p-2"
            >
              {creatingLoading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            </button>
          </form>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-premium pl-9 text-xs"
              placeholder="Filtrer les groupes..."
            />
          </div>

          {/* List */}
          <div className="space-y-1 max-h-[500px] overflow-y-auto pr-2 scrollbar-none">
            {filteredGroups.length === 0 ? (
              <p className="text-center text-xs text-slate-400 py-4">Aucun groupe trouvé</p>
            ) : (
              filteredGroups.map(group => (
                <div
                  key={group.id}
                  onClick={() => fetchMembers(group)}
                  className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                    selectedGroup?.id === group.id
                      ? 'bg-docuflow-primary text-white shadow-md'
                      : 'hover:bg-blue-50 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <Users size={16} className={selectedGroup?.id === group.id ? 'text-white/80' : 'text-slate-400'} />
                    <span className="text-sm font-bold truncate">{group.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group); }}
                      className={`p-1.5 rounded-lg transition-colors ${
                        selectedGroup?.id === group.id
                          ? 'hover:bg-white/20 text-white/70 hover:text-white'
                          : 'hover:bg-red-50 text-slate-300 hover:text-red-500'
                      }`}
                    >
                      <Trash2 size={14} />
                    </button>
                    <ChevronRight size={16} className={selectedGroup?.id === group.id ? 'text-white/80' : 'text-slate-300'} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right Column: Group Members */}
      <div className="lg:col-span-8">
        {!selectedGroup ? (
          <div className="glass-card-premium p-12 text-center border border-slate-100">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-50 flex items-center justify-center text-blue-400">
              <Users2 size={32} />
            </div>
            <h3 className="text-lg font-black text-slate-800 mb-2">Aucun groupe sélectionné</h3>
            <p className="text-sm text-slate-400 max-w-xs mx-auto">
              Sélectionnez un groupe dans la liste de gauche pour gérer ses membres et les permissions.
            </p>
          </div>
        ) : (
          <div className="space-y-6 animate-fade-in-up">
            <div className="glass-card-premium p-6 border border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
                    {selectedGroup.name}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">Gestion des membres du groupe</p>
                </div>
                <div className="bg-blue-50 px-3 py-1 rounded-full text-blue-600 text-xs font-bold">
                  {members.length} membre{members.length > 1 ? 's' : ''}
                </div>
              </div>

              {/* Add Member Form */}
              <form onSubmit={handleAddUserToGroup} className="flex gap-2 mb-8">
                <div className="relative flex-1">
                  <UserPlus size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <select
                    value={userToAdd}
                    onChange={(e) => setUserToAdd(e.target.value)}
                    className="input-premium pl-10 w-full"
                    required
                  >
                    <option value="">Ajouter un utilisateur...</option>
                    {availableUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name} (@{u.username})</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn-primary flex items-center gap-2">
                  <Plus size={18} /> Ajouter
                </button>
              </form>

              {/* Members List */}
              {membersLoading ? (
                <div className="grid gap-3">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-2xl skeleton" />)}
                </div>
              ) : members.length === 0 ? (
                <div className="text-center py-10 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                  <Users size={24} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-sm text-slate-400">Ce groupe n'a pas encore de membres.</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {members.map(member => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100 hover:border-blue-200 transition-colors"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {(member.full_name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-bold text-slate-800 truncate">{member.full_name}</p>
                          <p className="text-[10px] text-slate-400 truncate">@{member.username} · {member.email}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveUserFromGroup(member.id)}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        title="Retirer du groupe"
                      >
                        <UserMinus size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirm.open}
        title={confirm.title}
        message={confirm.message}
        type={confirm.type}
        onConfirm={confirm.onConfirm}
        onClose={() => setConfirm({ ...confirm, open: false })}
      />
    </div>
  );
};

export default GroupManager;
