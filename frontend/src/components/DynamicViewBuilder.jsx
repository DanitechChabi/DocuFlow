import React, { useState } from 'react';
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Layers, Filter, Save, X, RotateCcw } from 'lucide-react';
import { documentService } from '../services/documentService';
import { toast } from './Toast';

/**
 * DynamicViewBuilder — composition d'une vue dynamique par glisser-déposer
 * (paradigme M-Files) : on fait glisser un champ vers l'emplacement
 * « regrouper par », d'autres vers les emplacements de filtrage, on nomme la vue
 * et on l'enregistre.
 *
 * Les champs proposés ne sont pas libres : le regroupement est limité à la liste
 * blanche de documentController.getDynamicViewData (toute autre valeur serait
 * silencieusement ramenée à `type_document`), et le filtrage à celle des filtres
 * reconnus par la même fonction — un filtre hors liste serait enregistré puis
 * ignoré au calcul, donnant une vue qui mentirait sur son propre contenu.
 */

// Champs autorisés comme critère de REGROUPEMENT (liste blanche backend).
const GROUP_FIELDS = [
  { key: 'type_document', label: 'Type de document' },
  { key: 'statut', label: 'Statut' },
  { key: 'annee', label: 'Année' },
  { key: 'nom_entreprise', label: 'Entreprise' },
  { key: 'auteur', label: 'Auteur' },
];

// Champs autorisés comme critère de FILTRAGE, avec le mode de saisie.
const FILTER_FIELDS = [
  { key: 'statut', label: 'Statut', input: 'select', options: ['disponible', 'prêt', 'archivé'] },
  { key: 'type_document', label: 'Type de document', input: 'text' },
  { key: 'annee', label: 'Année', input: 'number' },
  { key: 'nom_entreprise', label: 'Entreprise', input: 'text' },
  { key: 'auteur', label: 'Auteur', input: 'text' },
];

const DraggableField = ({ id, label, sublabel }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border bg-white cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? 'border-docuflow-secondary shadow-lg' : 'border-slate-200 hover:border-docuflow-secondary/50'
      }`}
    >
      <GripVertical size={14} className="text-slate-300 shrink-0" />
      <span className="text-xs font-bold text-slate-700">{label}</span>
      {sublabel && <span className="text-[10px] text-slate-400">{sublabel}</span>}
    </div>
  );
};

const DropSlot = ({ id, icon: Icon, title, hint, filled, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`p-4 rounded-2xl border-2 border-dashed transition-all ${
        isOver
          ? 'border-docuflow-secondary bg-blue-50/60'
          : filled
            ? 'border-slate-200 bg-white'
            : 'border-slate-200 bg-slate-50/50'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-docuflow-secondary" />
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</span>
      </div>
      {filled ? children : <p className="text-xs text-slate-400 italic">{hint}</p>}
    </div>
  );
};

const DynamicViewBuilder = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [groupBy, setGroupBy] = useState(null);
  // { [champ]: valeur } — seuls les champs de FILTER_FIELDS y entrent.
  const [filters, setFilters] = useState({});
  const [saving, setSaving] = useState(false);

  // Le glissement d'un champ se déclenche après 6 px : sans cette contrainte, un
  // simple clic sur un champ était déjà interprété comme un déplacement.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = ({ active, over }) => {
    // Relâcher en dehors d'un emplacement ne doit rien changer, et surtout pas
    // lever une exception : `over` est null dans ce cas très courant.
    if (!over) return;
    const activeId = String(active.id);

    if (over.id === 'slot-group' && activeId.startsWith('group:')) {
      setGroupBy(activeId.slice('group:'.length));
      return;
    }
    if (over.id === 'slot-filters' && activeId.startsWith('filter:')) {
      const key = activeId.slice('filter:'.length);
      // On n'écrase pas un filtre déjà posé : ce serait perdre la valeur saisie.
      setFilters((prev) => (key in prev ? prev : { ...prev, [key]: '' }));
    }
  };

  const removeFilter = (key) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Donnez un nom à la vue');
      return;
    }
    if (!groupBy) {
      toast.error('Faites glisser un champ vers « Regrouper par »');
      return;
    }
    // Les filtres laissés vides sont retirés : enregistrés tels quels, ils
    // seraient ignorés au calcul et la vue afficherait plus de documents que ce
    // que son résumé annonce.
    const cleanFilters = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => String(v).trim() !== '')
    );
    setSaving(true);
    try {
      const view = await documentService.createDynamicView({
        name: name.trim(),
        description: description.trim() || null,
        group_by_field: groupBy,
        filter_json: cleanFilters,
      });
      toast.success('Vue dynamique enregistrée');
      onCreated?.(view);
      onClose?.();
    } catch (err) {
      const data = err.response?.data;
      toast.error(data?.message || data?.error || "Erreur lors de l'enregistrement de la vue");
    } finally {
      setSaving(false);
    }
  };

  const groupLabel = GROUP_FIELDS.find((f) => f.key === groupBy)?.label;
  const filterKeys = Object.keys(filters);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="glass-card-premium w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6 space-y-5 animate-fade-in-up">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <Layers size={20} className="text-docuflow-secondary" />
              Composer une vue dynamique
            </h2>
            <p className="text-sm text-slate-400 font-medium">
              Faites glisser les champs pour définir le regroupement et les filtres.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nom de la vue</label>
            <input
              className="input-premium"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex. Contrats actifs 2026"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Description (facultative)</label>
            <input
              className="input-premium"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="À quoi sert cette vue ?"
            />
          </div>
        </div>

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="grid md:grid-cols-2 gap-5">
            {/* Palette des champs disponibles */}
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Champs de regroupement
                </p>
                <div className="space-y-2">
                  {GROUP_FIELDS.map((f) => (
                    <DraggableField key={f.key} id={`group:${f.key}`} label={f.label} />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Champs de filtrage
                </p>
                <div className="space-y-2">
                  {FILTER_FIELDS.map((f) => (
                    <DraggableField key={f.key} id={`filter:${f.key}`} label={f.label} />
                  ))}
                </div>
              </div>
            </div>

            {/* Emplacements de dépôt */}
            <div className="space-y-4">
              <DropSlot
                id="slot-group"
                icon={Layers}
                title="Regrouper par"
                hint="Déposez ici le champ qui formera les groupes."
                filled={!!groupBy}
              >
                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-docuflow-secondary/10 border border-docuflow-secondary/30">
                  <span className="text-xs font-bold text-docuflow-secondary">{groupLabel}</span>
                  <button
                    onClick={() => setGroupBy(null)}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                    title="Retirer"
                  >
                    <X size={14} />
                  </button>
                </div>
              </DropSlot>

              <DropSlot
                id="slot-filters"
                icon={Filter}
                title="Filtres"
                hint="Déposez des champs pour restreindre les documents (facultatif)."
                filled={filterKeys.length > 0}
              >
                <div className="space-y-2">
                  {filterKeys.map((key) => {
                    const def = FILTER_FIELDS.find((f) => f.key === key);
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-600 w-28 shrink-0">{def?.label || key}</span>
                        {def?.input === 'select' ? (
                          <select
                            className="input-premium flex-1 py-1.5 text-xs"
                            value={filters[key]}
                            onChange={(e) => setFilters((p) => ({ ...p, [key]: e.target.value }))}
                          >
                            <option value="">— choisir —</option>
                            {def.options.map((o) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="input-premium flex-1 py-1.5 text-xs"
                            type={def?.input === 'number' ? 'number' : 'text'}
                            value={filters[key]}
                            onChange={(e) => setFilters((p) => ({ ...p, [key]: e.target.value }))}
                            placeholder="Valeur…"
                          />
                        )}
                        <button
                          onClick={() => removeFilter(key)}
                          className="text-slate-400 hover:text-red-500 transition-colors shrink-0"
                          title="Retirer ce filtre"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </DropSlot>
            </div>
          </div>
        </DndContext>

        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <button
            onClick={() => { setGroupBy(null); setFilters({}); }}
            className="btn-secondary flex items-center gap-2 text-xs"
          >
            <RotateCcw size={14} /> Réinitialiser
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary">Annuler</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
              <Save size={16} /> {saving ? 'Enregistrement…' : 'Enregistrer la vue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DynamicViewBuilder;
