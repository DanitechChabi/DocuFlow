import React, { useState, useEffect } from 'react';
import { X, Save, AlertCircle, Info } from 'lucide-react';
import { metadataApi } from '../services/metadataApi';
import { toast } from './Toast';

const DocumentMetadataEditor = ({ documentId, onClose, onSuccess }) => {
  const [schemas, setSchemas] = useState([]);
  const [metadata, setMetadata] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const [allSchemas, currentMeta] = await Promise.all([
          metadataApi.getSchemas(),
          metadataApi.getDocumentMetadata(documentId),
        ]);

        // Find the default schema
        const defaultSchema = allSchemas.find(s => s.is_default) || allSchemas[0];
        setSchemas(allSchemas);

        if (defaultSchema) {
          const fieldValues = {};
          currentMeta.forEach(m => {
            fieldValues[m.field_id] = m.value;
          });
          setValues(fieldValues);
        }
      } catch (err) {
        setError(err.response?.data?.error || 'Erreur lors du chargement des métadonnées');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [documentId]);

  const handleValueChange = (fieldId, value) => {
    setValues(prev => ({ ...prev, [fieldId]: value }));
  };

  // Champs numériques (number, user, document) : une saisie vidée doit rester
  // VIDE (null), pas devenir 0 — Number('') vaut 0 et l'ancien code enregistrait
  // donc « 0 » sur un champ que l'utilisateur venait d'effacer, ou NaN sur une
  // frappe intermédiaire invalide. La validation finale reste au backend.
  const handleNumericValueChange = (fieldId, raw) => {
    const texte = String(raw).trim();
    handleValueChange(fieldId, texte === '' ? null : Number(texte));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const metadataToSave = [];
      // We only save values that have been changed or already exist
      // To be thorough, we map over the default schema's fields
      const defaultSchema = schemas.find(s => s.is_default) || schemas[0];
      if (!defaultSchema) throw new Error('Aucun schéma disponible');

      defaultSchema.fields.forEach(field => {
        const val = values[field.id];
        if (val !== undefined) {
          metadataToSave.push({ fieldId: field.id, value: val });
        }
      });

      await metadataApi.setDocumentMetadata(documentId, { values: metadataToSave });
      toast.success('Métadonnées mises à jour');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null; // Handled by parent loading state usually

  const defaultSchema = schemas.find(s => s.is_default) || schemas[0];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Indexation du document</h2>
            <p className="text-xs text-slate-500">Remplissez les champs requis pour classer le document</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-200 text-sm font-bold flex items-center gap-3">
              <AlertCircle size={18} /> {error}
            </div>
          )}

          {!defaultSchema ? (
            <div className="py-12 text-center text-slate-400">
              <Info size={32} className="mx-auto mb-2 opacity-40" />
              <p>Aucun schéma d'indexation configuré pour votre organisation.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {defaultSchema.fields.map(field => (
                <div key={field.id} className={`space-y-1.5 ${field.required ? 'border-l-2 border-docuflow-secondary pl-3' : ''}`}>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>

                  {field.type === 'text' && (
                    <input
                      type="text"
                      className="input-premium"
                      value={values[field.id] || ''}
                      onChange={e => handleValueChange(field.id, e.target.value)}
                    />
                  )}

                  {field.type === 'number' && (
                    <input
                      type="number"
                      className="input-premium"
                      value={values[field.id] ?? ''}
                      onChange={e => handleNumericValueChange(field.id, e.target.value)}
                    />
                  )}

                  {field.type === 'date' && (
                    <input
                      type="date"
                      className="input-premium"
                      value={values[field.id] || ''}
                      onChange={e => handleValueChange(field.id, e.target.value)}
                    />
                  )}

                  {field.type === 'boolean' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`field-${field.id}`}
                        className="w-4 h-4 rounded border-slate-300 text-docuflow-secondary focus:ring-docuflow-secondary"
                        checked={!!values[field.id]}
                        onChange={e => handleValueChange(field.id, e.target.checked)}
                      />
                      <label htmlFor={`field-${field.id}`} className="text-sm text-slate-600">Oui / Non</label>
                    </div>
                  )}

                  {field.type === 'select' && (
                    <select
                      className="input-premium"
                      value={values[field.id] || ''}
                      onChange={e => handleValueChange(field.id, e.target.value)}
                    >
                      <option value="">—</option>
                      {field.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  )}

                  {field.type === 'multiselect' && (
                    <div className="flex flex-wrap gap-1">
                      {field.options?.map(opt => {
                        const isSelected = Array.isArray(values[field.id]) && values[field.id].includes(opt.value);
                        return (
                          <button
                            key={opt.value}
                            onClick={() => {
                              const current = Array.isArray(values[field.id]) ? values[field.id] : [];
                              const next = isSelected
                                ? current.filter(v => v !== opt.value)
                                : [...current, opt.value];
                              handleValueChange(field.id, next);
                            }}
                            className={`px-2 py-1 rounded-full text-[11px] font-bold transition-all ${
                              isSelected ? 'bg-docuflow-secondary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {field.type === 'user' && (
                    <input
                      type="text"
                      className="input-premium"
                      placeholder="ID utilisateur"
                      value={values[field.id] ?? ''}
                      onChange={e => handleNumericValueChange(field.id, e.target.value)}
                    />
                  )}

                  {field.type === 'document' && (
                    <input
                      type="text"
                      className="input-premium"
                      placeholder="ID document"
                      value={values[field.id] ?? ''}
                      onChange={e => handleNumericValueChange(field.id, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
            Enregistrer l'indexation
          </button>
        </div>
      </div>
    </div>
  );
};

export default DocumentMetadataEditor;
