import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Plus, Pencil, Trash2, X, Save, Users, Info, AlertTriangle, Power, Check, Search,
} from 'lucide-react';
import { roleService } from '../../services/roleService';
import { toast } from '../Toast';
import ConfirmDialog from '../ConfirmDialog';

// ============================================================================
// RolesPanel — matrice « rôles × permissions » de l'organisation.
//
// L'administrateur voit immédiatement la chaîne : rôle → permissions →
// effectif. La matrice se construit sur le catalogue SERVEUR (modules,
// libellés) : une permission ajoutée au backend apparaît ici au prochain
// chargement, sans copie locale à maintenir.
//
// Les rôles système sont modifiables dans leurs permissions (c'est le levier
// d'administration : accorder la GED au rôle demandeur) mais ni supprimables
// ni renommables dans leur clé — les utilisateurs la portent.
// ============================================================================

const EMBLEMES = {
  superadmin: '👑', admin: '⚙️', responsable: '🧑‍💼', archiviste: '📚',
  agent: '📝', demandeur: '👤', lecteur: '👁️',
};

const emblemeDe = (key) => EMBLEMES[key] || '🔹';

/** Une modification de rôle est-elle en cours ? (prévention de perte) */
const modifiable = (role) => role.key !== 'superadmin';

const RoleFormModal = ({ role, catalogue, onClose, onSaved }) => {
  const creation = !role;
  const [key, setKey] = useState(role?.key || '');
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [permissions, setPermissions] = useState(role?.permissions || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Le joker '*' (super administrateur) n'est pas éditable ni sélectionnable :
  // un rôle personnalisé ne peut pas tout pouvoir.
  const possede = (p) => permissions.includes(p);

  const basculer = (p) => {
    setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const toutLeModule = (module_) => {
    const cles = module_.permissions.map((p) => p.key);
    const toutes = cles.every((c) => possede(c));
    setPermissions((prev) => (toutes
      ? prev.filter((x) => !cles.includes(x))
      : [...new Set([...prev, ...cles])]));
  };

  const enregistrer = async () => {
    setError('');
    if (creation && !/^[a-z][a-z0-9-]{2,49}$/.test(key)) {
      setError('La clé : 3 à 50 caractères (lettres minuscules, chiffres, tirets), commençant par une lettre.');
      return;
    }
    if (!name.trim()) {
      setError('Le nom du rôle est requis.');
      return;
    }
    if (permissions.length === 0) {
      setError('Cochez au moins une permission — un rôle sans permission ne peut rien faire.');
      return;
    }
    setSaving(true);
    try {
      if (creation) {
        await roleService.createRole({ key, name: name.trim(), description: description.trim() || null, permissions });
        toast.success(`Rôle « ${name.trim()} » créé.`);
      } else {
        await roleService.updateRole(role.key, { name: name.trim(), description: description.trim() || null, permissions });
        toast.success(`Rôle « ${name.trim()} » mis à jour.`);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors de l\'enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {creation ? 'Nouveau rôle' : `Modifier « ${role.name} »`}
            </h2>
            <p className="text-xs text-slate-500">
              {creation
                ? 'Nommez le rôle, puis cochez ses permissions module par module.'
                : `Clé « ${role.key} »${role.is_system ? ' — rôle système (clé immuable)' : ''} · ${role.users_count ?? '?'} compte(s)`}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-200 text-sm font-bold flex items-center gap-3">
              <AlertTriangle size={18} /> {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {creation && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Clé (identifiant)</label>
                <input type="text" className="input-premium" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} placeholder="ex. responsable-documentaire" />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Nom affiché</label>
              <input type="text" className="input-premium" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Responsable documentaire" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Description</label>
              <input type="text" className="input-premium" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="À quoi sert ce rôle ?" />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Shield size={16} className="text-docuflow-secondary" />
              <span className="text-sm font-bold text-slate-700">Permissions accordées</span>
              <span className="text-xs text-slate-400">{permissions.length} sélectionnée(s)</span>
            </div>
            <div className="space-y-4">
              {catalogue?.catalogue?.map((module_) => {
                const cles = module_.permissions.map((p) => p.key);
                const toutes = cles.every((c) => possede(c));
                const quelques = cles.some((c) => possede(c)) && !toutes;
                return (
                  <div key={module_.module} className="border border-slate-200 rounded-2xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toutLeModule(module_)}
                      className={`w-full flex items-center justify-between px-4 py-3 text-left ${toutes ? 'bg-blue-50' : 'bg-slate-50 hover:bg-slate-100'} transition-colors`}
                    >
                      <span className="font-bold text-slate-700 text-sm">{module_.titre}</span>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${toutes ? 'bg-docuflow-secondary text-white' : quelques ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500'}`}>
                        {toutes ? 'Tout accordé' : quelques ? 'Partiel' : 'Rien'}
                      </span>
                    </button>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 p-4">
                      {module_.permissions.map((p) => (
                        <label
                          key={p.key}
                          className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                          title={p.description}
                        >
                          <input
                            type="checkbox"
                            checked={possede(p.key)}
                            onChange={() => basculer(p.key)}
                            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-docuflow-secondary focus:ring-docuflow-secondary"
                          />
                          <span className="text-sm text-slate-700 leading-tight">
                            {p.label}
                            <span className="block text-[10px] text-slate-400 font-mono">{p.key}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button onClick={enregistrer} disabled={saving} className="btn-primary flex items-center gap-2">
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
            {creation ? 'Créer le rôle' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
};

const RolesPanel = () => {
  const [roles, setRoles] = useState([]);
  const [catalogue, setCatalogue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editRole, setEditRole] = useState(null); // null | role | 'nouveau'
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [recherche, setRecherche] = useState('');

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([roleService.getRoles(), roleService.getCatalogue()]);
      setRoles(Array.isArray(r) ? r : []);
      setCatalogue(c);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Impossible de charger les rôles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const ouvrirCreation = () => setEditRole('nouveau');
  const ouvrirEdition = (role) => setEditRole(role);

  const basculerActivation = async (role) => {
    try {
      await roleService.updateRole(role.key, { is_active: !role.is_active });
      toast.success(role.is_active
        ? `Rôle « ${role.name} » désactivé — ses porteurs perdent ses permissions.`
        : `Rôle « ${role.name} » réactivé.`);
      charger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur.');
    }
  };

  const confirmerSuppression = async () => {
    if (!deleteTarget) return;
    try {
      await roleService.deleteRole(deleteTarget.key);
      toast.success(`Rôle « ${deleteTarget.name} » supprimé.`);
      setDeleteTarget(null);
      charger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur.');
      setDeleteTarget(null);
    }
  };

  const rolesFiltres = roles.filter((r) => !recherche.trim()
    || r.name.toLowerCase().includes(recherche.toLowerCase())
    || r.key.toLowerCase().includes(recherche.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Shield size={20} className="text-docuflow-secondary" /> Rôles & permissions
          </h2>
          <p className="text-sm text-slate-500">
            Qui peut faire quoi dans votre organisation. Une modification s'applique aux sessions ouvertes en moins d'une minute.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher un rôle…"
              className="input-premium pl-9 w-48"
            />
          </div>
          <button onClick={ouvrirCreation} className="btn-primary flex items-center gap-2 whitespace-nowrap">
            <Plus size={16} /> Nouveau rôle
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-docuflow-secondary rounded-full animate-spin mx-auto mb-3" />
          Chargement des rôles…
        </div>
      ) : (
        <div className="space-y-3">
          {rolesFiltres.map((role) => (
            <div
              key={role.key}
              className={`glass-card-premium p-5 ${!role.is_active ? 'opacity-60' : ''}`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center text-xl flex-shrink-0">
                    {emblemeDe(role.key)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900">{role.name}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{role.key}</span>
                      {role.is_system && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">système</span>
                      )}
                      {!role.is_active && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">désactivé</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{role.description || '—'}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1"><Users size={12} /> {role.users_count ?? 0} compte(s)</span>
                      <span className="flex items-center gap-1"><Check size={12} /> {role.permissions.includes('*') ? 'toutes permissions' : `${role.permissions.length} permission(s)`}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {modifiable(role) && (
                    <>
                      <button
                        onClick={() => basculerActivation(role)}
                        className="w-9 h-9 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-500 flex items-center justify-center"
                        title={role.is_active ? 'Désactiver le rôle' : 'Réactiver le rôle'}
                      >
                        <Power size={15} />
                      </button>
                      <button onClick={() => ouvrirEdition(role)} className="btn-secondary flex items-center gap-1.5 !py-2">
                        <Pencil size={14} /> Permissions
                      </button>
                      {!role.is_system && role.users_count === 0 && (
                        <button
                          onClick={() => setDeleteTarget(role)}
                          className="w-9 h-9 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center"
                          title="Supprimer ce rôle"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </>
                  )}
                  {role.key === 'superadmin' && (
                    <span className="text-[11px] text-slate-400 flex items-center gap-1.5 px-2">
                      <Info size={13} /> Géré par le propriétaire de la plateforme
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!rolesFiltres.length && (
            <div className="py-12 text-center text-slate-400">
              <Shield size={28} className="mx-auto mb-2 opacity-40" />
              Aucun rôle ne correspond à la recherche.
            </div>
          )}
        </div>
      )}

      {editRole && (
        <RoleFormModal
          role={editRole === 'nouveau' ? null : editRole}
          catalogue={catalogue}
          onClose={() => setEditRole(null)}
          onSaved={charger}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title={`Supprimer le rôle « ${deleteTarget?.name} » ?`}
        message="Cette action est définitive. Le rôle n'est porté par aucun compte."
        confirmLabel="Supprimer"
        type="danger"
        onConfirm={confirmerSuppression}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default RolesPanel;
