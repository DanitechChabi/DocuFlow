import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { X, Save, FileText, AlertCircle, Upload, File, Loader2 } from 'lucide-react';
import { requestService } from '../services/requestService';
import { uploadService } from '../services/uploadService';
import { useSettings } from '../contexts/SettingsContext';
import { requestFormOptions } from '../utils/requestOptions';
import DynamicRequestField from './DynamicRequestField';

/**
 * RequestForm — formulaire de demande, construit depuis les champs définis par
 * l'organisation.
 *
 * CE QUI A CHANGÉ ET POURQUOI
 *
 * Les sept champs étaient décrits ici en JSX, un bloc chacun. Ajouter « Numéro de
 * TVA » ou « Personne à contacter » supposait donc de modifier ce fichier et de
 * redéployer — pour du vocabulaire propre au métier de chaque organisation. Les
 * définitions viennent maintenant de `GET /requests/fields/form`
 * (`request_field_definitions`, migration 016) et le rendu de chaque champ est
 * délégué à DynamicRequestField.
 *
 * LE REPLI SUR LES CHAMPS D'ORIGINE N'EST PAS DÉCORATIF
 *
 * Si la migration 016 n'est pas passée sur la base — déploiement du code avant
 * sa migration, base restaurée d'une sauvegarde antérieure —, la route répond
 * `available: false`. Sans le jeu de champs de repli ci-dessous, le formulaire
 * s'afficherait alors VIDE : plus aucune demande ne pourrait être créée, et
 * l'écran ne dirait pas pourquoi. Ces définitions de repli décrivent exactement
 * les sept champs historiques.
 */

// Champs d'origine, sous la forme que renvoie le backend. Les listes de choix
// sont laissées à null : elles sont injectées depuis les réglages plus bas, comme
// le backend le fait avec `options_setting`.
const CHAMPS_DE_REPLI = [
  { id: -1, name: 'nom_entreprise', label: "Nom de l'entreprise", field_type: 'text', required: true, is_system: true, is_visible: true, placeholder: 'Entrez la raison sociale', description: null },
  { id: -2, name: 'num_dossier', label: 'Numéro de dossier', field_type: 'text', required: true, is_system: true, is_visible: true, placeholder: 'Entrez le n° de dossier (ex: DOS-2024-001)', description: null },
  { id: -3, name: 'num_acte', label: "Numéro d'acte", field_type: 'text', required: true, is_system: true, is_visible: true, placeholder: "Entrez le n° d'acte (ex: ACT-2024-045)", description: null },
  { id: -4, name: 'annee', label: 'Année', field_type: 'number', required: true, is_system: true, is_visible: true, min_length: 1900, max_length: 2100, description: null },
  { id: -5, name: 'type_document', label: 'Type de document', field_type: 'select', required: false, is_system: true, is_visible: true, options_setting: 'request_document_types', description: null },
  { id: -6, name: 'motif', label: 'Motif', field_type: 'select', required: true, is_system: true, is_visible: true, options_setting: 'request_motifs', description: null },
  { id: -7, name: 'priorite', label: 'Priorité', field_type: 'select', required: true, is_system: true, is_visible: true, options_setting: 'request_priorities', description: null },
];

const RequestForm = ({ isOpen, onClose, onSuccess }) => {
  const settings = useSettings();

  // Listes de choix issues des réglages. Elles servent à deux titres : à garnir
  // les champs de repli, et à combler un champ dont le backend n'aurait pas
  // résolu `options_setting` (base non migrée servant des définitions partielles).
  const { documentTypes, motifs, priorities, defaultPriority, maxFiles } = useMemo(
    () => requestFormOptions(settings),
    [
      settings.request_document_types,
      settings.request_motifs,
      settings.request_priorities,
      settings.request_default_priority,
      settings.request_max_files,
    ]
  );

  const [definitions, setDefinitions] = useState(null);
  const [chargementChamps, setChargementChamps] = useState(true);

  // Extensions et taille limite affichées à l'utilisateur : ce sont les réglages
  // que uploadPolicyMiddleware applique réellement côté serveur. Le formulaire
  // annonçait « 10 Mo max », une valeur qui ne correspondait plus à rien depuis
  // que la limite est devenue configurable — l'utilisateur pouvait croire son
  // fichier trop lourd, ou se voir refuser un fichier annoncé comme acceptable.
  const acceptedExtensions = String(settings.allowed_file_types || 'pdf,doc,docx,xls,xlsx,png,jpg,jpeg,txt')
    .split(',')
    .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);
  const maxUploadMb = Number(settings.max_upload_size_mb) || 50;

  const [formData, setFormData] = useState({});
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  // Chargement à l'OUVERTURE et non au montage : le composant est monté en
  // permanence par ses pages parentes (il ne rend rien tant que `isOpen` est
  // faux), et un chargement au montage manquerait tout champ ajouté par
  // l'administrateur depuis l'ouverture de la session.
  useEffect(() => {
    if (!isOpen) return;
    let annule = false;
    setChargementChamps(true);
    requestService.getFormFields()
      .then((data) => {
        if (annule) return;
        const recus = data?.available && Array.isArray(data.fields) && data.fields.length
          ? data.fields
          : CHAMPS_DE_REPLI;
        setDefinitions(recus);
      })
      .catch(() => {
        // Un échec réseau ne doit pas laisser un formulaire vide : on retombe sur
        // les champs d'origine, qui restent valides côté serveur.
        if (!annule) setDefinitions(CHAMPS_DE_REPLI);
      })
      .finally(() => {
        if (!annule) setChargementChamps(false);
      });
    return () => { annule = true; };
  }, [isOpen]);

  /**
   * Complète une définition dont les choix manquent, depuis les réglages.
   *
   * Le backend résout déjà `options_setting`, mais les champs de repli ne
   * passent pas par lui : sans cette résolution côté client, leurs menus
   * déroulants seraient vides et le formulaire de secours inutilisable.
   */
  const resoudreOptions = useCallback((field) => {
    if (Array.isArray(field.options) && field.options.length) return field;
    const parReglage = {
      request_document_types: documentTypes,
      request_motifs: motifs,
      request_priorities: priorities,
    }[field.options_setting];
    return parReglage ? { ...field, options: parReglage } : field;
  }, [documentTypes, motifs, priorities]);

  const champs = useMemo(
    () => (definitions || []).filter((f) => f.is_visible !== false).map(resoudreOptions),
    [definitions, resoudreOptions]
  );

  /**
   * Valeurs initiales, dérivées des définitions.
   *
   * `emptyForm` était un littéral de sept clés ; il ne peut plus l'être, puisque
   * les champs sont inconnus avant leur chargement. Chaque champ reçoit sa valeur
   * par défaut selon son type — un booléen part à `false` et non à la chaîne
   * vide, sans quoi une case à cocher serait rendue comme non contrôlée.
   */
  const valeursInitiales = useCallback((liste) => {
    const initial = {};
    for (const field of liste) {
      if (field.field_type === 'boolean') {
        initial[field.name] = field.default_value === 'true';
      } else if (field.field_type === 'multiselect') {
        initial[field.name] = [];
      } else if (field.default_value) {
        initial[field.name] = field.default_value;
      } else if (field.name === 'annee') {
        // Seule valeur calculée conservée : l'année en cours est juste dans la
        // quasi-totalité des cas, et la ressaisir à chaque demande était la
        // frappe la plus inutile du formulaire.
        initial[field.name] = new Date().getFullYear();
      } else if (field.field_type === 'select') {
        const options = field.options || [];
        // Un champ obligatoire s'ouvre sur son premier choix — il n'offre pas
        // d'entrée vide. Un champ facultatif s'ouvre sur « Sélectionner… ».
        initial[field.name] = field.name === 'priorite'
          ? (options.some((o) => o.value === defaultPriority) ? defaultPriority : options[0]?.value || '')
          : (field.required ? (options[0]?.value || '') : '');
      } else {
        initial[field.name] = '';
      }
    }
    return initial;
  }, [defaultPriority]);

  // Les définitions et les réglages arrivent après le premier rendu. Cette
  // synchronisation garnit les champs à choix sans jamais écraser ce que
  // l'utilisateur a déjà saisi : elle ne remplace une valeur que si celle-ci ne
  // figure plus parmi les choix proposés.
  useEffect(() => {
    if (!champs.length) return;
    setFormData((prev) => {
      const defauts = valeursInitiales(champs);
      const suivant = { ...defauts };
      for (const field of champs) {
        const actuel = prev[field.name];
        if (actuel === undefined || actuel === '' || actuel === null) continue;
        if (field.field_type === 'select') {
          const admises = (field.options || []).map((o) => o.value);
          suivant[field.name] = admises.includes(actuel) ? actuel : defauts[field.name];
        } else {
          suivant[field.name] = actuel;
        }
      }
      return suivant;
    });
  }, [champs, valeursInitiales]);

  if (!isOpen) return null;

  const handleFieldChange = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    // L'erreur portait sur les valeurs précédentes : la laisser affichée pendant
    // une correction fait douter de la correction elle-même.
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // 1. Créer la demande. Le corps porte les champs système sous leur nom de
      //    colonne et les champs ajoutés sous leur clé technique : le backend les
      //    répartit d'après les définitions (requestFieldService.collectValues),
      //    seul endroit où le caractère système d'un champ est connu.
      const response = await requestService.createRequest(formData);
      const requestId = response.request?.id;

      // 2. Uploader les fichiers si la demande a été créée
      if (requestId && files.length > 0) {
        await uploadService.uploadRequestFiles(requestId, files);
      }

      if (onSuccess) onSuccess();
      onClose();
      setFormData(valeursInitiales(champs));
      setFiles([]);
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors de la création de la demande');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...selected].slice(0, maxFiles));
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
            <div className="p-2 sm:p-2.5 bg-docuflow-primary text-docuflow-secondary rounded-xl">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-800">Nouvelle demande</h2>
              <p className="text-[10px] sm:text-xs text-slate-400">Remplissez les informations du document</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors" aria-label="Fermer">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-8 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          {error && (
            <div className="sm:col-span-2 p-4 bg-red-50 text-red-600 rounded-xl border border-red-100 text-sm font-bold flex items-center gap-3">
              <AlertCircle size={18} /> {error}
            </div>
          )}

          {/* Squelettes pendant le chargement des définitions : afficher un
              formulaire vide puis le voir se remplir donne l'impression d'un
              écran cassé, et l'utilisateur commence à saisir dans des champs qui
              vont être réinitialisés. */}
          {chargementChamps && !champs.length ? (
            <div className="sm:col-span-2 space-y-4">
              {[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-xl skeleton" />)}
            </div>
          ) : (
            champs.map((field) => (
              <DynamicRequestField
                key={field.name}
                field={field}
                value={formData[field.name]}
                onChange={handleFieldChange}
              />
            ))
          )}

          {/* Pièces jointes */}
          <div className="sm:col-span-2 space-y-2">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">
              Pièces jointes <span className="text-slate-300 normal-case">(optionnel, max {maxFiles} fichier{maxFiles > 1 ? 's' : ''})</span>
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center cursor-pointer hover:border-docuflow-secondary/50 hover:bg-docuflow-secondary/5 transition-all"
            >
              <Upload size={28} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-medium text-slate-500">Cliquez pour ajouter des fichiers</p>
              <p className="text-xs text-slate-400 mt-1">
                {acceptedExtensions.join(', ')} — {maxUploadMb} Mo max par fichier
              </p>
              <input ref={fileInputRef} type="file" multiple onChange={handleFileChange}
                className="hidden" accept={acceptedExtensions.map((e) => `.${e}`).join(',')} />
            </div>

            {files.length > 0 && (
              <div className="space-y-2 mt-2">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                    <File size={16} className="text-docuflow-secondary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                      <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
                    </div>
                    <button type="button" onClick={() => removeFile(i)}
                      className="p-1 hover:bg-red-100 rounded-lg text-slate-400 hover:text-red-500 transition-colors"
                      aria-label={`Retirer ${file.name}`}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Boutons */}
          <div className="sm:col-span-2 flex gap-3 pt-2">
            <button type="submit" disabled={loading || chargementChamps}
              className="btn-primary flex-1 flex items-center justify-center gap-2 py-3">
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> Envoi en cours…</>
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
