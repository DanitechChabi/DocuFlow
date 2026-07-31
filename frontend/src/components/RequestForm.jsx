import React, { useState, useRef } from 'react';
import { X, Save, FileText, Calendar, Hash, Building2, AlertCircle, Upload, File } from 'lucide-react';
import { requestService } from '../services/requestService';
import { uploadService } from '../services/uploadService';

const RequestForm = ({ isOpen, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    nom_entreprise: '',
    num_dossier: '',
    num_acte: '',
    annee: new Date().getFullYear(),
    type_document: '',
    motif: 'Actualisation',
    priorite: 'normale',
  });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // 1. Créer la demande
      const response = await requestService.createRequest(formData);
      const requestId = response.request?.id;

      // 2. Uploader les fichiers si la demande a été créée
      if (requestId && files.length > 0) {
        await uploadService.uploadRequestFiles(requestId, files);
      }

      if (onSuccess) onSuccess();
      onClose();
      setFormData({
        nom_entreprise: '',
        num_dossier: '',
        num_acte: '',
        annee: new Date().getFullYear(),
        type_document: '',
        motif: 'Actualisation',
        priorite: 'normale',
      });
      setFiles([]);
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors de la création de la demande');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...selected].slice(0, 5)); // max 5 fichiers
    e.target.value = '';
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
    return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-2 sm:p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl max-h-screen overflow-y-auto rounded-2xl sm:rounded-3xl shadow-2xl animate-scale-in m-0 sm:m-4" onClick={e => e.stopPropagation()}>
        <div className="px-5 sm:px-8 py-5 sm:py-6 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 sm:p-2.5 bg-afgc-primary text-afgc-secondary rounded-xl">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-800">Nouvelle demande</h2>
              <p className="text-[10px] sm:text-xs text-slate-400">Remplissez les informations du document</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-8 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          {error && (
            <div className="sm:col-span-2 p-4 bg-red-50 text-red-600 rounded-xl border border-red-100 text-sm font-bold flex items-center gap-3">
              <AlertCircle size={18} /> {error}
            </div>
          )}

          <div className="sm:col-span-2 space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Nom de l'entreprise</label>
            <div className="relative">
              <Building2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input-premium pl-12" value={formData.nom_entreprise}
                onChange={(e) => setFormData({...formData, nom_entreprise: e.target.value})} required
                placeholder="Entrez la raison sociale" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Numéro de dossier</label>
            <div className="relative">
              <Hash size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input-premium pl-12" value={formData.num_dossier}
                onChange={(e) => setFormData({...formData, num_dossier: e.target.value})} required
                placeholder="Entrez le n° de dossier (ex: DOS-2024-001)" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Numéro d'acte</label>
            <div className="relative">
              <Hash size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input-premium pl-12" value={formData.num_acte}
                onChange={(e) => setFormData({...formData, num_acte: e.target.value})} required
                placeholder="Entrez le n° d'acte (ex: ACT-2024-045)" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Année</label>
            <div className="relative">
              <Calendar size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input type="number" className="input-premium pl-12" value={formData.annee}
                onChange={(e) => setFormData({...formData, annee: parseInt(e.target.value)})}
                required min={1900} max={2100} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Type de document</label>
            <select className="input-premium" value={formData.type_document}
              onChange={(e) => setFormData({...formData, type_document: e.target.value})}>
              <option value="">Sélectionner...</option>
              <option value="Statuts">Statuts</option>
              <option value="PV d'Assemblée">PV d'Assemblée</option>
              <option value="Bilan Financier">Bilan Financier</option>
              <option value="Registre de Commerce">Registre de Commerce</option>
              <option value="Contrat">Contrat</option>
              <option value="Autre">Autre</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Motif</label>
            <select className="input-premium" value={formData.motif}
              onChange={(e) => setFormData({...formData, motif: e.target.value})}>
              <option value="Actualisation">Actualisation</option>
              <option value="Création">Création d'entreprise</option>
              <option value="Modification">Modification</option>
              <option value="Radiation">Radiation</option>
              <option value="Consultation">Consultation</option>
              <option value="Contentieux">Contentieux</option>
            </select>
          </div>

          {/* Priorité */}
          <div className="sm:col-span-2 space-y-2">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Priorité</label>
            <div className="flex gap-2">
              {[
                { value: 'basse', label: 'Basse', color: 'bg-slate-200 text-slate-600' },
                { value: 'normale', label: 'Normale', color: 'bg-blue-100 text-blue-600' },
                { value: 'haute', label: 'Haute', color: 'bg-orange-100 text-orange-600' },
                { value: 'urgente', label: 'Urgente', color: 'bg-red-100 text-red-600' },
              ].map((p) => (
                <button key={p.value} type="button" onClick={() => setFormData({...formData, priorite: p.value})}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    formData.priorite === p.value
                      ? `${p.color} ring-2 ring-offset-1`
                      : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pièces jointes */}
          <div className="sm:col-span-2 space-y-2">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">
              Pièces jointes <span className="text-slate-300 normal-case">(optionnel, max 5 fichiers)</span>
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center cursor-pointer hover:border-afgc-secondary/50 hover:bg-afgc-secondary/5 transition-all"
            >
              <Upload size={28} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-medium text-slate-500">Cliquez pour ajouter des fichiers</p>
              <p className="text-xs text-slate-400 mt-1">PDF, DOC, XLS, images — 10 Mo max</p>
              <input ref={fileInputRef} type="file" multiple onChange={handleFileChange}
                className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.txt,.zip" />
            </div>

            {files.length > 0 && (
              <div className="space-y-2 mt-2">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                    <File size={16} className="text-afgc-secondary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                      <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
                    </div>
                    <button type="button" onClick={() => removeFile(i)}
                      className="p-1 hover:bg-red-100 rounded-lg text-slate-400 hover:text-red-500 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Boutons */}
          <div className="sm:col-span-2 flex gap-3 pt-2">
            <button type="submit" disabled={loading}
              className="btn-primary flex-1 flex items-center justify-center gap-2 py-3">
              {loading ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Envoi en cours…</>
              ) : (
                <><Save size={20} /> Enregistrer la demande</>
              )}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1 flex items-center justify-center gap-2 py-3">
              <X size={20} /> Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RequestForm;
