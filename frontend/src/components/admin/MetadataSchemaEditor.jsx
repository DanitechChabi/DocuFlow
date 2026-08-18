import React, { useState, useEffect } from 'react';
import {
  Plus, Trash2, Save, X,
  Type, Calendar, Hash, List,
  CheckCircle2, Circle, Pencil, GripVertical
} from 'lucide-react';
import { toast } from '../Toast';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * SortableFieldRow — A wrapper component for the metadata field table row to enable drag-and-drop.
 */
const SortableFieldRow = ({ field, typeInfo, handleEditFieldClick, handleDeleteField }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    position: 'relative',
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-t border-slate-50 transition-colors ${isDragging ? 'bg-blue-100 shadow-xl scale-[1.02] z-50' : 'hover:bg-blue-50/30'}`}
    >
      <td className="px-5 py-4">
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500 transition-colors">
          <GripVertical size={16} />
        </div>
      </td>
      <td className="px-5 py-4 font-bold text-slate-800">{field.label}</td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-2 text-slate-500">
          {typeInfo && <typeInfo.icon size={14} />}
          <span className="capitalize">{typeInfo?.label || field.type}</span>
        </div>
      </td>
      <td className="px-5 py-4">
        {field.required ? (
          <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-600">Oui</span>
        ) : (
          <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400">Non</span>
        )}
      </td>
      <td className="px-5 py-4">
        {field.type === 'select' && field.options?.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {field.options.map((opt, i) => (
              <span key={i} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium">
                {opt}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-slate-400 text-xs">—</span>
        )}
      </td>
      <td className="px-5 py-4">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => handleEditFieldClick(field)}
            className="p-2 rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            title="Modifier"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => handleDeleteField(field.id)}
            className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
            title="Supprimer"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
};

const MetadataSchemaEditor = ({ initialSchema = [], onSave }) => {
  const [schema, setSchema] = useState(initialSchema);
  const [isAdding, setIsAdding] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [saving, setSaving] = useState(false);

  const [currentField, setCurrentField] = useState({
    label: '',
    type: 'text',
    required: false,
    options: ''
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    setSchema(initialSchema);
  }, [initialSchema]);

  const fieldTypes = [
    { id: 'text', label: 'Texte', icon: Type },
    { id: 'number', label: 'Nombre', icon: Hash },
    { id: 'date', label: 'Date', icon: Calendar },
    { id: 'select', label: 'Liste', icon: List },
  ];

  const handleAddFieldClick = () => {
    setCurrentField({ label: '', type: 'text', required: false, options: '' });
    setIsAdding(true);
    setEditingField(null);
  };

  const handleEditFieldClick = (field) => {
    setCurrentField({
      label: field.label,
      type: field.type,
      required: field.required,
      options: Array.isArray(field.options) ? field.options.join(', ') : (field.options || '')
    });
    setEditingField(field.id);
    setIsAdding(false);
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingField(null);
    setCurrentField({ label: '', type: 'text', required: false, options: '' });
  };

  const handleSaveField = () => {
    if (!currentField.label.trim()) {
      toast.error('Le libellé du champ est requis');
      return;
    }

    const fieldData = {
      ...currentField,
      label: currentField.label.trim(),
      options: currentField.type === 'select'
        ? currentField.options.split(',').map(o => o.trim()).filter(o => o !== '')
        : []
    };

    if (editingField) {
      setSchema(prev => prev.map(f => f.id === editingField ? { ...fieldData, id: editingField } : f));
    } else {
      setSchema(prev => [...prev, { ...fieldData, id: Date.now().toString() }]);
    }

    setIsAdding(false);
    setEditingField(null);
    setCurrentField({ label: '', type: 'text', required: false, options: '' });
  };

  const handleDeleteField = (id) => {
    setSchema(prev => prev.filter(f => f.id !== id));
  };

  const handleSaveSchema = async () => {
    setSaving(true);
    try {
      if (onSave) await onSave(schema);
      toast.success('Schéma des métadonnées enregistré avec succès');
    } catch (err) {
      // `metadataController.syncSchema` répond `{ error }` là où le reste de
      // l'API répond `{ message }` : on lit les deux, sinon l'admin ne voyait
      // qu'un message générique à la place de la cause réelle du refus.
      const data = err.response?.data;
      toast.error(data?.error || data?.message || 'Erreur lors de la sauvegarde du schéma');
    } finally {
      setSaving(false);
    }
  };

  // `over` est null quand l'utilisateur relâche en dehors de toute ligne — cas
  // très courant (relâcher à côté du tableau). Sans ce garde, le `over.id`
  // ci-dessous levait un TypeError qui démontait tout l'arbre React : l'écran
  // d'administration devenait blanc et le schéma en cours d'édition était perdu.
  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSchema((items) => {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-black text-slate-900">Configuration des Métadonnées</h3>
          <p className="text-sm text-slate-500">Définissez les champs obligatoires et optionnels pour vos documents.</p>
        </div>
        {!isAdding && !editingField && (
          <button
            onClick={handleAddFieldClick}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} /> Ajouter un champ
          </button>
        )}
      </div>

      {(isAdding || editingField) && (
        <div className="glass-card-premium p-6 border-2 border-docuflow-primary/20 animate-scale-in space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-bold text-slate-800 flex items-center gap-2">
              {editingField ? <Pencil size={18} /> : <Plus size={18} />}
              {editingField ? 'Modifier le champ' : 'Nouveau champ de métadonnées'}
            </h4>
            <button onClick={handleCancel} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Libellé du champ</label>
              <input
                className="input-premium"
                value={currentField.label}
                onChange={(e) => setCurrentField({ ...currentField, label: e.target.value })}
                placeholder="ex: Date d'expiration, Type de contrat..."
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Type de donnée</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {fieldTypes.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setCurrentField({ ...currentField, type: type.id })}
                    className={`flex items-center justify-center gap-2 p-2 rounded-xl border transition-all text-xs font-bold ${
                      currentField.type === type.id
                        ? 'bg-docuflow-primary border-docuflow-primary text-white shadow-sm'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-docuflow-primary/50'
                    }`}
                  >
                    <type.icon size={14} />
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {currentField.type === 'select' && (
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Options (séparées par des virgules)</label>
                <input
                  className="input-premium"
                  value={currentField.options}
                  onChange={(e) => setCurrentField({ ...currentField, options: e.target.value })}
                  placeholder="Option 1, Option 2, Option 3..."
                />
              </div>
            )}

            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
              <button
                onClick={() => setCurrentField({ ...currentField, required: !currentField.required })}
                className="transition-colors"
              >
                {currentField.required ? (
                  <CheckCircle2 size={24} className="text-docuflow-primary" />
                ) : (
                  <Circle size={24} className="text-slate-300" />
                )}
              </button>
              <div className="text-sm">
                <p className="font-bold text-slate-800">Champ obligatoire</p>
                <p className="text-xs text-slate-500">L'utilisateur devra obligatoirement remplir ce champ.</p>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button onClick={handleSaveField} className="btn-primary flex-1 flex items-center justify-center gap-2">
                <Save size={18} /> Confirmer le champ
              </button>
              <button onClick={handleCancel} className="btn-secondary flex-1">Annuler</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-400">
            <tr>
              <th className="px-5 py-3 font-bold w-10"></th>
              <th className="px-5 py-3 font-bold">Libellé</th>
              <th className="px-5 py-3 font-bold">Type</th>
              <th className="px-5 py-3 font-bold">Obligatoire</th>
              <th className="px-5 py-3 font-bold">Valeurs / Options</th>
              <th className="px-5 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {schema.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-5 py-12 text-center text-slate-400 italic">
                  Aucun champ de métadonnées défini. Cliquez sur "Ajouter un champ" pour commencer.
                </td>
              </tr>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={schema.map(f => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {schema.map((field) => {
                    const typeInfo = fieldTypes.find(t => t.id === field.type);
                    return (
                      <SortableFieldRow
                        key={field.id}
                        field={field}
                        typeInfo={typeInfo}
                        handleEditFieldClick={handleEditFieldClick}
                        handleDeleteField={handleDeleteField}
                      />
                    );
                  })}
                </SortableContext>
              </DndContext>
            )}
          </tbody>
        </table>
      </div>

      {schema.length > 0 && !isAdding && !editingField && (
        <div className="flex justify-end pt-4">
          <button
            onClick={handleSaveSchema}
            disabled={saving}
            className="btn-primary flex items-center gap-2 px-8"
          >
            {saving ? 'Enregistrement…' : <><Save size={18} /> Enregistrer le schéma</>}
          </button>
        </div>
      )}
    </div>
  );
};

export default MetadataSchemaEditor;
