import React, { useState, useEffect } from 'react';
import { X, FileCode, CheckCircle, AlertCircle, Wand2 } from 'lucide-react';
import { documentService } from '../services/documentService';
import { toast } from './Toast';

const DocumentAssemblyModal = ({ onClose, onSuccess }) => {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [formData, setFormData] = useState({
    nom_entreprise: '',
    num_dossier: '',
    num_acte: '',
    annee: new Date().getFullYear(),
    description: '',
    lieu: 'Cotonou'
  });

  useEffect(() => {
    documentService.getAssemblyTemplates()
      .then(res => {
        setTemplates(res);
        if (res.length > 0) setSelectedTemplate(res[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGenerating(true);
    try {
      const res = await documentService.generateAssembledDocument({
        template_id: selectedTemplate,
        ...formData
      });
      toast.success('Document assemblé et créé avec succès !');
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'assemblage');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-elevated w-full max-w-xl overflow-hidden flex flex-col animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="text-docuflow-secondary" size={20} />
            <h2 className="text-lg font-black text-slate-900">Assemblage Automatique M-Files</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Modèle de document</label>
            <select
              className="input-premium w-full"
              value={selectedTemplate}
              onChange={e => setSelectedTemplate(e.target.value)}
            >
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.category})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Entreprise</label>
              <input
                required
                className="input-premium w-full"
                placeholder="Ex. AFGC SARL"
                value={formData.nom_entreprise}
                onChange={e => setFormData({ ...formData, nom_entreprise: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Lieu</label>
              <input
                className="input-premium w-full"
                placeholder="Ex. Cotonou"
                value={formData.lieu}
                onChange={e => setFormData({ ...formData, lieu: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">N° Dossier</label>
              <input
                required
                className="input-premium w-full"
                placeholder="DOS-2026-001"
                value={formData.num_dossier}
                onChange={e => setFormData({ ...formData, num_dossier: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">N° Acte</label>
              <input
                required
                className="input-premium w-full"
                placeholder="ACT-100"
                value={formData.num_acte}
                onChange={e => setFormData({ ...formData, num_acte: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Année</label>
              <input
                type="number"
                className="input-premium w-full"
                value={formData.annee}
                onChange={e => setFormData({ ...formData, annee: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Description / Clauses particulières</label>
            <textarea
              className="input-premium w-full h-20"
              placeholder="Précisez la description ou les conditions..."
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={generating} className="btn-primary flex items-center gap-2">
              <Wand2 size={16} /> {generating ? 'Assemblage…' : 'Générer le Document'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DocumentAssemblyModal;
