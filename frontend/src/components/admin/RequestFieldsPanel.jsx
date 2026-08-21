import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Trash2, Save, X, Pencil, GripVertical, Eye, EyeOff,
  Lock, Loader2, PackagePlus, ListChecks, AlertTriangle,
} from 'lucide-react';
import { requestService } from '../../services/requestService';
import { toast } from '../Toast';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * RequestFieldsPanel — configuration des champs du formulaire de demande.
 *
 * POURQUOI UN ÉDITEUR DISTINCT DE CELUI DES MÉTADONNÉES
 *
 * MetadataSchemaEditor aurait pu servir : même forme de définitions, même
 * glisser-déposer. Il ignore pourtant la distinction qui structure ces champs.
 * Quatre d'entre eux correspondent à des colonnes de `requests` que du code lit
 * nommément — `num_dossier` et `num_acte` forment la clé de rapprochement
 * documentaire, `nom_entreprise` alimente les e-mails, `type_document` est lu à
 * l'indexation. La base refuse leur suppression par trigger (migration 016).
 *
 * Un éditeur qui les présente comme supprimables offrirait donc un bouton dont la
 * seule issue est un message d'erreur. Ici, un champ système porte un cadenas : il
 * se renomme et se masque, il ne se supprime pas. La contrainte est visible avant
 * la tentative, pas après.
 *
 * MASQUER N'EST PAS SUPPRIMER
 *
 * Retirer un champ système du formulaire le masque (`is_visible = FALSE`) au lieu
 * de l'effacer. Le retour est réversible d'un clic — un champ supprimé, lui,
 * emporte les valeurs saisies sur toutes les demandes existantes.
 */

const TYPES = [
  { id: 'text', label: 'Texte' },
  { id: 'textarea', label: 'Texte long' },
  { id: 'number', label: 'Nombre' },
  { id: 'date', label: 'Date' },
  { id: 'boolean', label: 'Oui / Non' },
  { id: 'select', label: 'Liste' },
  { id: 'multiselect', label: 'Choix multiples' },
];

const LIBELLES_REGLAGES = {
  request_document_types: 'Types de document',
  request_motifs: 'Motifs de demande',
  request_priorities: 'Niveaux de priorité',
};

const champVierge = () => ({
  label: '',
  field_type: 'text',
  required: false,
  description: '',
  placeholder: '',
  options: '',
  options_setting: '',
});

// Les choix arrivent du serveur sous la forme `{ value, label }` et repartent
// d'ici sous forme de libellés nus — voir le commentaire de `validerBrouillon`.
// Le tableau doit donc lire les deux.
const libelleOption = (o) => (typeof o === 'string' ? o : o?.label ?? '');

/** Ligne réordonnable du tableau des champs. */
const LigneChamp = ({ field, onEdit, onRemove, onToggleVisibility }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(field.id) });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    position: 'relative',
  };

  const typeLabel = TYPES.find((t) => t.id === field.field_type)?.label || field.field_type;
  const masque = field.is_visible === false;
  // Champ dont la colonne est NOT NULL sans repli serveur : le masquer ou le
  // rendre facultatif ferait échouer toute création de demande. Le drapeau vient
  // du serveur (`is_required_by_schema`), seul endroit où la contrainte est connue.
  const indispensable = field.is_required_by_schema === true;

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-t border-slate-50 transition-colors ${
        isDragging ? 'bg-blue-100 shadow-xl z-50' : 'hover:bg-blue-50/30'
      } ${masque ? 'opacity-50' : ''}`}
    >
      <td className="px-4 py-3">
        <div {...attributes} {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500 transition-colors">
          <GripVertical size={16} />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {field.is_system && (
            <Lock size={13} className="text-slate-400 flex-shrink-0"
              title={indispensable
                ? 'Champ indispensable : renommable, ni masquable ni supprimable'
                : 'Champ système : renommable et masquable, non supprimable'} />
          )}
          <div className="min-w-0">
            <p className="font-bold text-slate-800 truncate">{field.label}</p>
            {/* La clé technique est ce qui part dans les exports : l'afficher
                évite d'avoir à deviner à quoi correspond une colonne exportée. */}
            <p className="text-[11px] text-slate-400 font-mono truncate">{field.name}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-slate-500">{typeLabel}</td>
      <td className="px-4 py-3">
        {field.required ? (
          <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-600">Oui</span>
        ) : (
          <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400">Non</span>
        )}
      </td>
      <td className="px-4 py-3">
        {field.options_setting ? (
          // Les choix viennent d'un réglage : le dire explicitement évite qu'un
          // administrateur cherche à les modifier ici sans les trouver.
          <span className="text-[11px] text-slate-500">
            Réglage «&nbsp;{LIBELLES_REGLAGES[field.options_setting] || field.options_setting}&nbsp;»
          </span>
        ) : field.options?.length ? (
          <div className="flex flex-wrap gap-1">
            {field.options.slice(0, 3).map((o, i) => (
              <span key={i} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium">
                {libelleOption(o)}
              </span>
            ))}
            {field.options.length > 3 && (
              <span className="text-[10px] text-slate-400">+{field.options.length - 3}</span>
            )}
          </div>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {/* Ni masquage ni suppression sur un champ indispensable : sa colonne
              est NOT NULL et sans repli, l'enregistrement échouerait. Un bouton
              dont la seule issue est un refus n'est pas une option — d'où son
              absence plutôt qu'un état désactivé. */}
          {!indispensable && (
            <button onClick={() => onToggleVisibility(field)}
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
              title={masque ? 'Réafficher dans le formulaire' : 'Masquer du formulaire'}>
              {masque ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
          <button onClick={() => onEdit(field)}
            className="p-2 rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            title="Modifier">
            <Pencil size={15} />
          </button>
          {/* Pas de bouton de suppression sur un champ système : la base le
              refuserait. Un bouton qui ne peut qu'échouer n'est pas une option. */}
          {!field.is_system && (
            <button onClick={() => onRemove(field)}
              className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
              title="Supprimer">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

const RequestFieldsPanel = () => {
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [modifie, setModifie] = useState(false);
  const [edition, setEdition] = useState(null);   // id en cours d'édition, ou 'nouveau'
  const [brouillon, setBrouillon] = useState(champVierge());

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const data = await requestService.getFieldDefinitions();
      setFields(data?.fields || []);
      setModifie(false);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du chargement des champs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const masques = useMemo(() => fields.filter((f) => f.is_visible === false).length, [fields]);

  const ouvrirEdition = (field) => {
    setEdition(field.id);
    setBrouillon({
      label: field.label || '',
      field_type: field.field_type || 'text',
      required: field.required === true,
      description: field.description || '',
      placeholder: field.placeholder || '',
      // L'éditeur ne manipule que des libellés ; les `value` sont préservées côté
      // serveur par correspondance de libellé (optionsToCanonical). Les exposer
      // ici inviterait à les modifier, ce qui orphelinerait les valeurs saisies.
      options: (field.options || []).map(libelleOption).join(', '),
      options_setting: field.options_setting || '',
      is_system: field.is_system === true,
      is_required_by_schema: field.is_required_by_schema === true,
      name: field.name,
    });
  };

  const ouvrirCreation = () => {
    setEdition('nouveau');
    setBrouillon(champVierge());
  };

  const annulerEdition = () => {
    setEdition(null);
    setBrouillon(champVierge());
  };

  const validerBrouillon = () => {
    const label = brouillon.label.trim();
    if (!label) {
      toast.error('Le libellé du champ est requis');
      return;
    }
    const aChoix = brouillon.field_type === 'select' || brouillon.field_type === 'multiselect';
    // Un champ à choix sans aucun choix produirait un menu déroulant vide :
    // obligatoire, il rendrait le formulaire impossible à soumettre.
    if (aChoix && !brouillon.options_setting && !brouillon.options.trim()) {
      toast.error('Un champ de type liste doit proposer des choix, ou tirer d\'un réglage');
      return;
    }

    const options = aChoix && !brouillon.options_setting
      ? brouillon.options.split(',').map((o) => o.trim()).filter(Boolean)
      : [];

    const commun = {
      label,
      field_type: brouillon.field_type,
      // La case est verrouillée sur un champ indispensable, mais c'est l'état qui
      // part au serveur, pas la case : sans ce forçage, un champ dont `required`
      // était déjà faux en base repartirait faux et se ferait refuser.
      required: brouillon.required || brouillon.is_required_by_schema === true,
      description: brouillon.description.trim() || null,
      placeholder: brouillon.placeholder.trim() || null,
      options_setting: aChoix ? (brouillon.options_setting || null) : null,
    };

    if (edition === 'nouveau') {
      // Id temporaire, préfixé pour être reconnaissable : le serveur ne retient
      // un id que s'il correspond à une ligne réelle, mais un id lisible aide au
      // diagnostic si l'un d'eux franchissait la frontière.
      setFields((prev) => [...prev, {
        ...commun,
        id: `nouveau-${Date.now()}`,
        name: '(sera généré)',
        is_system: false,
        is_visible: true,
        options,
      }]);
    } else {
      setFields((prev) => prev.map((f) => (f.id === edition
        ? { ...f, ...commun, options }
        : f)));
    }
    setModifie(true);
    annulerEdition();
  };

  const retirer = (field) => {
    setFields((prev) => prev.filter((f) => f.id !== field.id));
    setModifie(true);
  };

  /**
   * Bascule la visibilité.
   *
   * Enregistrée IMMÉDIATEMENT et non intégrée au brouillon : c'est la seule issue
   * pour réafficher un champ masqué, et la lier au bouton « Enregistrer » ferait
   * perdre la bascule si l'administrateur quitte l'écran sans enregistrer.
   */
  const basculerVisibilite = async (field) => {
    const cible = field.is_visible === false;
    // Champ pas encore enregistré : on bascule localement, il partira au
    // prochain enregistrement.
    if (String(field.id).startsWith('nouveau-')) {
      setFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, is_visible: cible } : f)));
      setModifie(true);
      return;
    }
    try {
      const res = await requestService.setFieldVisibility(field.id, cible);
      setFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, ...res.field } : f)));
      toast.success(res.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du changement de visibilité');
    }
  };

  const enregistrer = async () => {
    setSaving(true);
    try {
      const res = await requestService.syncFieldDefinitions(fields);
      // On repart des champs renvoyés par le serveur : un champ créé ici porte un
      // id temporaire et un nom technique fictif. Les conserver rendrait un second
      // enregistrement destructeur — le serveur ne reconnaîtrait pas ces champs
      // comme existants, les supprimerait puis les recréerait, et le ON DELETE
      // CASCADE de request_field_values effacerait les valeurs déjà saisies.
      setFields(res.fields || []);
      setModifie(false);
      toast.success('Champs du formulaire enregistrés');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  const provisionner = async () => {
    setProvisioning(true);
    try {
      const res = await requestService.provisionFields();
      setFields(res.fields || []);
      toast.success('Champs par défaut installés');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du provisionnement');
    } finally {
      setProvisioning(false);
    }
  };

  // `over` est null quand on relâche hors de toute ligne — cas très courant.
  // Sans ce garde, `over.id` levait un TypeError qui démontait l'arbre React :
  // l'écran devenait blanc et la configuration en cours était perdue.
  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setFields((items) => {
      const from = items.findIndex((i) => String(i.id) === active.id);
      const to = items.findIndex((i) => String(i.id) === over.id);
      if (from === -1 || to === -1) return items;
      return arrayMove(items, from, to);
    });
    setModifie(true);
  };

  if (loading) {
    return (
      <div className="grid gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-2xl skeleton" />)}
      </div>
    );
  }

  if (!fields.length) {
    return (
      <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center">
        <ListChecks size={28} className="mx-auto mb-3 text-slate-300" />
        <h3 className="text-lg font-black text-slate-800 mb-1">Aucun champ de demande</h3>
        <p className="text-sm text-slate-400 max-w-md mx-auto mb-5">
          Cette organisation n'a pas encore de champs de formulaire définis. Le provisionnement
          installe les champs standard — nom de l'entreprise, numéros de dossier et d'acte, année,
          type de document, motif et priorité — sans toucher aux demandes existantes.
        </p>
        <button onClick={provisionner} disabled={provisioning}
          className="btn-primary inline-flex items-center gap-2">
          {provisioning ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />}
          {provisioning ? 'Installation…' : 'Installer les champs par défaut'}
        </button>
      </div>
    );
  }

  const aChoix = brouillon.field_type === 'select' || brouillon.field_type === 'multiselect';

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900">Champs du formulaire de demande</h3>
          <p className="text-sm text-slate-500">
            Ajoutez vos propres champs, réordonnez-les par glisser-déposer, masquez ceux dont vous
            n'avez pas l'usage.
          </p>
        </div>
        {!edition && (
          <button onClick={ouvrirCreation} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> Ajouter un champ
          </button>
        )}
      </div>

      {/* Les champs système ne se suppriment pas : le dire une fois en tête
          d'écran évite de le redécouvrir par l'absence d'un bouton. */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 text-[13px] text-slate-500">
        <Lock size={15} className="mt-0.5 flex-shrink-0 text-slate-400" />
        <p>
          Les champs marqués d'un cadenas alimentent des colonnes utilisées par le rapprochement
          documentaire, les notifications et l'indexation : ils se renomment, mais ne se suppriment
          pas. Quatre d'entre eux — entreprise, dossier, acte, année — ne peuvent pas non plus être
          masqués ni rendus facultatifs : une demande ne s'enregistre pas sans leur valeur.
          {masques > 0 && (
            <> {masques} champ{masques > 1 ? 's' : ''} actuellement masqué{masques > 1 ? 's' : ''} du formulaire.</>
          )}
        </p>
      </div>

      {edition && (
        <div className="glass-card-premium p-6 border-2 border-docuflow-primary/20 animate-scale-in space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-800 flex items-center gap-2">
              {edition === 'nouveau' ? <Plus size={18} /> : <Pencil size={18} />}
              {edition === 'nouveau' ? 'Nouveau champ' : `Modifier « ${brouillon.label} »`}
            </h4>
            <button onClick={annulerEdition}
              className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
              <X size={20} />
            </button>
          </div>

          {brouillon.is_system && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100 text-[13px] text-amber-700">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              <p>
                Champ système (<code className="font-mono">{brouillon.name}</code>). Son libellé et sa
                description sont modifiables ; son nom technique et son type restent figés — du code
                les lit sous cette forme.
              </p>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Libellé</label>
              <input className="input-premium" value={brouillon.label} autoFocus
                onChange={(e) => setBrouillon({ ...brouillon, label: e.target.value })}
                placeholder="ex. Numéro de TVA, Personne à contacter" />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Type</label>
              <select className="input-premium" value={brouillon.field_type}
                // Le type d'un champ système est figé : le changer ferait écrire
                // dans sa colonne une valeur d'une autre nature.
                disabled={brouillon.is_system}
                onChange={(e) => setBrouillon({ ...brouillon, field_type: e.target.value })}>
                {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Description <span className="text-slate-300 normal-case font-medium">(affichée sous le champ)</span>
              </label>
              <input className="input-premium" value={brouillon.description}
                onChange={(e) => setBrouillon({ ...brouillon, description: e.target.value })}
                placeholder="Précision qui aide le demandeur à remplir correctement" />
            </div>

            {!aChoix && brouillon.field_type !== 'boolean' && (
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Exemple de saisie
                </label>
                <input className="input-premium" value={brouillon.placeholder}
                  onChange={(e) => setBrouillon({ ...brouillon, placeholder: e.target.value })}
                  placeholder="ex. BJ-2024-00123" />
              </div>
            )}

            {aChoix && (
              <>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Source des choix
                  </label>
                  <select className="input-premium" value={brouillon.options_setting}
                    onChange={(e) => setBrouillon({ ...brouillon, options_setting: e.target.value })}>
                    <option value="">Choix propres à ce champ</option>
                    {Object.entries(LIBELLES_REGLAGES).map(([cle, libelle]) => (
                      <option key={cle} value={cle}>Réglage « {libelle} »</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-400 ml-1">
                    Tirer d'un réglage garde une seule liste à jour : la modifier dans la
                    configuration met à jour ce champ, sans repasser ici.
                  </p>
                </div>

                {!brouillon.options_setting && (
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Choix (séparés par des virgules)
                    </label>
                    <input className="input-premium" value={brouillon.options}
                      onChange={(e) => setBrouillon({ ...brouillon, options: e.target.value })}
                      placeholder="Oui, Non, Sans objet" />
                  </div>
                )}
              </>
            )}

            <label className={`flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 md:col-span-2 ${
              brouillon.is_required_by_schema ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
            }`}>
              <input type="checkbox" className="w-4 h-4 accent-docuflow-secondary"
                checked={brouillon.required || brouillon.is_required_by_schema}
                // Verrouillée sur un champ indispensable : le serveur refuse le
                // passage en facultatif, sa colonne étant NOT NULL sans repli.
                disabled={brouillon.is_required_by_schema}
                onChange={(e) => setBrouillon({ ...brouillon, required: e.target.checked })} />
              <span className="text-sm">
                <span className="font-bold text-slate-800 block">Champ obligatoire</span>
                <span className="text-xs text-slate-500">
                  {brouillon.is_required_by_schema
                    ? 'Ce champ doit rester obligatoire : une demande ne peut pas être enregistrée sans sa valeur.'
                    : 'La demande sera refusée si ce champ est laissé vide.'}
                </span>
              </span>
            </label>
          </div>

          <div className="flex gap-3">
            <button onClick={validerBrouillon} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <Save size={18} /> Confirmer le champ
            </button>
            <button onClick={annulerEdition} className="btn-secondary flex-1">Annuler</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[40rem]">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-400">
            <tr>
              <th className="px-4 py-3 font-bold w-10"></th>
              <th className="px-4 py-3 font-bold">Champ</th>
              <th className="px-4 py-3 font-bold">Type</th>
              <th className="px-4 py-3 font-bold">Obligatoire</th>
              <th className="px-4 py-3 font-bold">Choix</th>
              <th className="px-4 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={fields.map((f) => String(f.id))} strategy={verticalListSortingStrategy}>
                {fields.map((field) => (
                  <LigneChamp
                    key={field.id}
                    field={field}
                    onEdit={ouvrirEdition}
                    onRemove={retirer}
                    onToggleVisibility={basculerVisibilite}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </tbody>
        </table>
      </div>

      {/* Le bouton n'apparaît que s'il y a quelque chose à enregistrer : un bouton
          toujours actif ne dit pas si les modifications sont déjà en base. */}
      {modifie && !edition && (
        <div className="flex items-center justify-end gap-3 pt-2">
          <p className="text-[13px] text-slate-400">Modifications non enregistrées</p>
          <button onClick={charger} className="btn-secondary">Annuler</button>
          <button onClick={enregistrer} disabled={saving} className="btn-primary flex items-center gap-2 px-8">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={18} />}
            {saving ? 'Enregistrement…' : 'Enregistrer les champs'}
          </button>
        </div>
      )}
    </div>
  );
};

export default RequestFieldsPanel;
