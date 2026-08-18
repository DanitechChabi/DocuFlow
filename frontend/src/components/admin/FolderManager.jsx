import React, { useState, useEffect, useCallback } from 'react';
import { FolderTree, Plus, Trash2, Pencil, Check, X, Loader2, FileText, Search } from 'lucide-react';
import { documentService } from '../../services/documentService';
import { toast } from '../Toast';
import ConfirmDialog from '../ConfirmDialog';

/**
 * FolderManager — administration des dossiers documentaires d'une organisation.
 *
 * Complète la console de configuration : jusqu'ici les dossiers n'étaient
 * créables que depuis la page Documents, donc invisibles pour qui configure
 * l'organisation sans parcourir la GED.
 *
 * `documents.dossier_id` est en ON DELETE SET NULL : supprimer un dossier ne
 * supprime aucun document, il les déclasse. La confirmation l'annonce avec le
 * nombre exact de documents concernés — sans cela l'administrateur croit
 * détruire des documents, ou au contraire ignore qu'il en déclasse.
 */
const FolderManager = () => {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  // Dossier en cours de renommage : { id, name }
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState({ open: false, title: '', message: '', onConfirm: null });

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await documentService.getFolders();
      setFolders(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du chargement des dossiers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    // Doublon : la table n'a pas de contrainte UNIQUE(tenant_id, name), le
    // backend accepterait donc deux dossiers homonymes — indiscernables ensuite.
    if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      toast.error('Un dossier porte déjà ce nom');
      return;
    }
    setCreating(true);
    try {
      await documentService.createFolder(name, null);
      toast.success('Dossier créé');
      setNewName('');
      fetchFolders();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la création du dossier');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      toast.error('Le nom ne peut pas être vide');
      return;
    }
    const original = folders.find((f) => f.id === editing.id);
    if (original && original.name === name) {
      setEditing(null);
      return;
    }
    if (folders.some((f) => f.id !== editing.id && f.name.toLowerCase() === name.toLowerCase())) {
      toast.error('Un dossier porte déjà ce nom');
      return;
    }
    try {
      await documentService.renameFolder(editing.id, name);
      toast.success('Dossier renommé');
      setEditing(null);
      fetchFolders();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du renommage');
    }
  };

  const handleDelete = (folder) => {
    const count = Number(folder.doc_count) || 0;
    setConfirm({
      open: true,
      title: `Supprimer le dossier « ${folder.name} » ?`,
      message: count
        ? `${count} document${count > 1 ? 's' : ''} ${count > 1 ? 'sont' : 'est'} classé${count > 1 ? 's' : ''} ici. ` +
          `Aucun document ne sera supprimé : ${count > 1 ? 'ils seront' : 'il sera'} simplement déclassé${count > 1 ? 's' : ''} et restera${count > 1 ? 'ont' : ''} accessible${count > 1 ? 's' : ''} dans la bibliothèque.`
        : 'Ce dossier est vide.',
      onConfirm: async () => {
        try {
          const res = await documentService.deleteFolder(folder.id);
          const declasses = Number(res?.documents_declasses) || 0;
          toast.success(
            declasses
              ? `Dossier supprimé — ${declasses} document${declasses > 1 ? 's' : ''} déclassé${declasses > 1 ? 's' : ''}`
              : 'Dossier supprimé'
          );
          fetchFolders();
        } catch (err) {
          toast.error(err.response?.data?.message || 'Erreur lors de la suppression');
        } finally {
          setConfirm((c) => ({ ...c, open: false }));
        }
      },
    });
  };

  const filtered = folders.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()));
  const totalDocs = folders.reduce((sum, f) => sum + (Number(f.doc_count) || 0), 0);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <Loader2 className="animate-spin text-docuflow-primary" size={32} />
        <p className="text-slate-500 font-medium">Chargement des dossiers…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="glass-card-premium p-6 border border-slate-100 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <FolderTree size={20} className="text-docuflow-secondary" />
              Dossiers documentaires
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              Structure de classement de l'organisation — {folders.length} dossier
              {folders.length > 1 ? 's' : ''}, {totalDocs} document{totalDocs > 1 ? 's' : ''} classé
              {totalDocs > 1 ? 's' : ''}.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="input-premium flex-1"
            placeholder="Nouveau dossier…"
          />
          <button type="submit" disabled={creating} className="btn-primary flex items-center gap-2">
            {creating ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            Créer
          </button>
        </form>

        {folders.length > 6 && (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-premium pl-9 text-xs"
              placeholder="Filtrer les dossiers…"
            />
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="text-center py-10 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
            <FolderTree size={24} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-400">
              {folders.length === 0
                ? "Aucun dossier. Créez-en un ci-dessus, ou utilisez « Provisionner » dans l'onglet Configuration."
                : 'Aucun dossier ne correspond à ce filtre.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            {filtered.map((folder) => {
              const isEditing = editing?.id === folder.id;
              const count = Number(folder.doc_count) || 0;
              return (
                <div
                  key={folder.id}
                  className="flex items-center justify-between gap-3 p-3 bg-white rounded-xl border border-slate-100 hover:border-blue-200 transition-colors"
                >
                  {isEditing ? (
                    <>
                      <input
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename();
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        className="input-premium flex-1 py-1.5 text-sm"
                        autoFocus
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={handleRename}
                          className="p-2 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Valider"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Annuler"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 text-docuflow-secondary flex items-center justify-center shrink-0">
                          <FolderTree size={16} />
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-bold text-slate-800 truncate">{folder.name}</p>
                          <p className="text-[10px] text-slate-400 flex items-center gap-1">
                            <FileText size={10} />
                            {count} document{count > 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setEditing({ id: folder.id, name: folder.name })}
                          className="p-2 text-slate-300 hover:text-docuflow-secondary hover:bg-blue-50 rounded-lg transition-all"
                          title="Renommer"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(folder)}
                          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          title="Supprimer"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirm.open}
        title={confirm.title}
        message={confirm.message}
        type="danger"
        onConfirm={confirm.onConfirm}
        onClose={() => setConfirm((c) => ({ ...c, open: false }))}
      />
    </div>
  );
};

export default FolderManager;
