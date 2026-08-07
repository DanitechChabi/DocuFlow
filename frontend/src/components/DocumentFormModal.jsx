import React, { useState, useRef, useEffect } from 'react';
import { X, Save, FileText, Calendar, Hash, Building2, AlertCircle, Upload, File, FolderOpen, User, Tag } from 'lucide-react';
import { documentService } from '../services/documentService';

const emptyForm = () => ({
  nom_entreprise: '',
  num_dossier: '',
  num_acte: '',
  annee: new Date().getFullYear(),
  type_document: '',
  categorie: '',
  description: '',
  auteur: '',
  date_document: '',
  duree_conservation: '',
  tags: '',
  dossier_id: '',
});

const DocumentFormModal = ({ editing, folders, onClose, onSuccess }) => {
  const [formData, setFormData] = useState(emptyForm());
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  // Mode édition : préremplir
  useEffect(() => {
    if (editing) {
      setFormData({
        nom_entreprise: editing.nom_entreprise || '',
        num_dossier: editing.num_dossier || '',
        num_acte: editing.num_acte || '',
        annee: editing.annee || new Date().getFullYear(),
        type_document: editing.type_document || '',
        description: editing.description || '',
        auteur: editing.auteur || '',
        date_document: editing.date_document ? editing.date_document.slice(0, 10) : '',
        tags: Array.isArray(editing.tags) ? editing.tags.join(', ') : (editing.tags || ''),
        dossier_id: editing.dossier_id || '',
      });
    }
  }, [editing]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...selected].slice(0, 5));
  };

  const removeFile = (i) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const tags = formData.tags.split(',').map((t) => t.trim()).filter(Boolean);
      const meta = {
        nom_entreprise: formData.nom_entreprise,
        num_dossier: formData.num_dossier,
        num_acte: formData.num_acte,
        annee: Number(formData.annee) || new Date().getFullYear(),
        type_document: formData.type_document || null,
        description: formData.description || null,
        auteur: formData.auteur || null,
        date_document: formData.date_document || null,
        tags,
        dossier_id: formData.dossier_id || null,
      };

      if (editing) {
        await documentService.updateDocument(editing.id, meta);
        if (files.length > 0) {
          await documentService.addFiles(editing.id, files);
        }
      } else {
        const fd = new FormData();
        Object.entries(meta).forEach(([k, v]) => {
          if (v !== null && v !== undefined) fd.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
        });
        files.forEach((f) => fd.append('files', f));
        await documentService.createDocument(fd);
      }
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Erreur lors de l'enregistrement du document");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-elevated w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/90 backdrop-blur-sm px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">{editing ? 'Modifier le document' : 'Nouveau document'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 grid grid-cols-2 gap-x-6 gap-y-4">
          {error && (
            <div className="col-span-2 p-4 bg-red-50/80 text-red-600 rounded-xl border border-red-200 text-sm font-bold flex items-center gap-3">
              <AlertCircle size={18} /> {error}
            </div>
          )}

          <div className="col-span-2 space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Entreprise</label>
            <div className="relative group">
              <Building2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
              <input type="text" name="nom_entreprise" className="input-premium pl-12" value={formData.nom_entreprise} onChange={handleChange} required placeholder="Nom de l'entreprise" />
            </div>
          </div>

          <div className="col-span-1 space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">N° dossier</label>
            <div className="relative group">
              <Hash size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
              <input type="text" name="num_dossier" className="input-premium pl-12" value={formData.num_dossier} onChange={handleChange} required placeholder="D-2026-001" />
            </div>
          </div>
          <div className="col-span-1 space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">N° acte</label>
            <div className="relative group">
              <Hash size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
              <input type="text" name="num_acte" className="input-premium pl-12" value={formData.num_acte} onChange={handleChange} required placeholder="A-001" />
            </div>
          </div>

          <div className="col-span-1 space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Année</label>
            <div className="relative group">
              <Calendar size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
              <input type="number" name="annee" className="input-premium pl-12" value={formData.annee} onChange={handleChange} required />
            </div>
          </div>
          <div className="col-span-1 space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Type de document</label>
            <select name="type_document" className="input-premium" value={formData.type_document} onChange={handleChange}>
              <option value="">—</option>
              {['Acte', 'Contrat', 'Rapport', 'PV', 'Lettre', 'Dossier', 'Autre'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="col-span-1 space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Auteur</label>
            <div className="relative group">
              <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
              <input type="text" name="auteur" className="input-premium pl-12" value={formData.auteur} onChange={handleChange} placeholder="Rédacteur / service" />
            </div>
          </div>
          <div className="col-span-1 space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Date du document</label>
            <input type="date" name="date_document" className="input-premium" value={formData.date_document} onChange={handleChange} />
          </div>

          <div className="col-span-1 space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Dossier de classement</label>
            <div className="relative group">
              <FolderOpen size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
              <select name="dossier_id" className="input-premium pl-12" value={formData.dossier_id} onChange={handleChange}>
                <option value="">Aucun dossier</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </div>
          <div className="col-span-1 space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Tags</label>
            <div className="relative group">
              <Tag size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
              <input type="text" name="tags" className="input-premium pl-12" value={formData.tags} onChange={handleChange} placeholder="séparés par des virgules" />
            </div>
          </div>

          <div className="col-span-2 space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Description</label>
            <textarea name="description" rows="2" className="input-premium resize-none" value={formData.description} onChange={handleChange} placeholder="Description du document…" />
          </div>

          {/* Fichiers */}
          <div className="col-span-2">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1 mb-2">
              {editing ? 'Ajouter une version (fichiers)' : 'Fichiers'}
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = Array.from(e.dataTransfer.files || []);
                setFiles((prev) => [...prev, ...dropped].slice(0, 5));
              }}
              className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center cursor-pointer hover:border-docuflow-secondary/50 hover:bg-blue-50/30 transition-colors"
            >
              <Upload size={24} className="mx-auto mb-2 text-slate-400" />
              <p className="text-sm text-slate-500 font-medium">Glissez vos fichiers ici ou <span className="text-docuflow-secondary font-bold">cliquez</span></p>
              <p className="text-[11px] text-slate-400 mt-1">PDF, images, Word, Excel… (5 max)</p>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
            </div>
            {files.length > 0 && (
              <div className="mt-3 space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
                    <span className="flex items-center gap-2 text-sm text-slate-600 font-medium"><File size={14} className="text-docuflow-secondary" /> {f.name}</span>
                    <button type="button" onClick={() => removeFile(i)} className="text-red-400 hover:text-red-600 text-xs font-bold">Retirer</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="col-span-2 flex justify-end gap-3 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              <Save size={18} /> {loading ? 'Enregistrement…' : (editing ? 'Enregistrer' : 'Créer le document')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DocumentFormModal;
