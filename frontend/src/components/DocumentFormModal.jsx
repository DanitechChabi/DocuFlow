import React, { useState, useRef, useEffect } from 'react';
import { X, Save, FileText, Calendar, Hash, Building2, AlertCircle, Upload, File, FolderOpen, User, Tag } from 'lucide-react';
import { documentService } from '../services/documentService';
import { toast } from './Toast';

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
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Échap ferme la fenêtre, comme l'aperçu de document le fait déjà. Sans cela
  // les seules sorties sont la croix, « Annuler » et le clic sur le fond — et un
  // clic sur le fond est vite lâché à côté d'un formulaire à demi rempli.
  useEffect(() => {
    const surTouche = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onClose]);

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

  // Le plafond suit le mode : 100 fichiers en masse, 5 pour un document unique
  // (au-delà, multer rejette côté serveur). La limite est ANNONCÉE : une
  // troncature silencieuse (l'ancien `.slice(0, limit)`) laissait l'utilisateur
  // croire que ses 120 fichiers étaient versés alors que 20 disparaissaient —
  // précisément le genre d'écart invisible que le statut « à indexer » devait
  // permettre de repérer.
  const ajouterFichiers = (selected) => {
    if (selected.length === 0) return;
    const limit = bulkMode ? 100 : 5;
    const total = files.length + selected.length;
    if (total > limit) {
      setError(
        `${total} fichiers sélectionnés pour une limite de ${limit} par versement${bulkMode ? ' en masse' : ''}. `
        + `Seuls les ${limit} premiers seront retenus — versez le reste dans un second lot.`
      );
    }
    setFiles((prev) => [...prev, ...selected].slice(0, limit));
  };

  const handleFileChange = (e) => {
    ajouterFichiers(Array.from(e.target.files || []));
    // Réinitialiser permet de resélectionner le MÊME fichier après un retrait :
    // sans cela le champ garde sa valeur et n'émet plus d'événement change.
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    ajouterFichiers(Array.from(e.dataTransfer?.files || []));
  };

  const removeFile = (i) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBulkResults(null);

    // En masse, un document est créé PAR fichier : sans fichier il n'y a rien à
    // créer. Le backend renverrait un 201 avec zéro création — soit un succès
    // affiché pour un travail qui n'a pas eu lieu.
    if (bulkMode && files.length === 0) {
      setError('Ajoutez au moins un fichier : en téléversement en masse, un document est créé par fichier.');
      return;
    }

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
        bulkUpload: bulkMode,
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
        const res = await documentService.createDocument(fd);
        if (bulkMode) {
          setBulkResults(res);
          // Toast + onSuccess : la liste de documents doit se recharger dès le
          // versement réussi. L'ancien `return` silencieux laissait la fenêtre
          // de résultats s'afficher sur une liste figée : à la fermeture, les
          // nouvelles fiches « à indexer » n'apparaissaient qu'après F5.
          if (res.created?.length > 0) {
            toast.success(`${res.created.length} document(s) créé(s), ${res.failed?.length || 0} échec(s).`);
            if (onSuccess) onSuccess();
          } else if (res.failed?.length > 0) {
            toast.error(`Aucun document créé (${res.failed.length} échec(s)) — détail ci-dessous.`);
          }
          setLoading(false);
          return;
        }
      }
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      // Un lot entièrement en échec arrive ici (le backend rend 500 et non 201 :
      // un 201 « 0 créés » se lisait comme un succès et fermait la fenêtre sur un
      // message vert). Le corps porte quand même le détail par fichier — on
      // l'affiche, sinon l'utilisateur reçoit « Erreur lors de l'enregistrement »
      // sans savoir lequel de ses vingt fichiers a échoué, ni pourquoi.
      const corps = err.response?.data;
      if (corps && (corps.failed?.length || corps.created?.length)) {
        setBulkResults(corps);
      }
      setError(corps?.message || "Erreur lors de l'enregistrement du document");
    } finally {
      // Toujours relâcher : en masse, l'ancienne garde `if (!bulkMode)` laissait
      // le bouton figé sur « Enregistrement… » après une erreur réseau.
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

          {/* Bulk Mode Toggle */}
          {!editing && (
            <div className="col-span-2 flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white rounded-lg shadow-sm text-docuflow-secondary">
                  <Upload size={18} />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Téléversement en masse</p>
                  <p className="text-[11px] text-slate-500">Ignorer l'indexation immédiate et créer un document par fichier</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={bulkMode} onChange={(e) => { setBulkMode(e.target.checked); setBulkResults(null); }} />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-docuflow-secondary"></div>
              </label>
            </div>
          )}

          {!bulkMode && (
            <div className="col-span-2 space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Entreprise</label>
              <div className="relative group">
                <Building2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-docuflow-secondary transition-colors pointer-events-none" />
                <input type="text" name="nom_entreprise" className="input-premium pl-12" value={formData.nom_entreprise} onChange={handleChange} required placeholder="Nom de l'entreprise" />
              </div>
            </div>
          )}

          {!bulkMode && (
            <>
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
            </>
          )}

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
                {/* Le chemin complet, pas le seul nom : deux sous-dossiers
                    « 2025 » rangés sous deux parents distincts seraient
                    autrement impossibles à distinguer au moment du classement. */}
                {folders.map((f) => <option key={f.id} value={f.id}>{f.path || f.name}</option>)}
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

            {/* Zone cliquable ET déposable. Le champ `file` réel est masqué (les
                navigateurs ne permettent pas de le styliser) : c'est ce bloc qui
                le déclenche. Sans ce onClick, aucun fichier ne peut être choisi —
                le téléversement en masse devient inatteignable depuis l'écran. */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-docuflow-secondary bg-blue-50/50'
                  : 'border-slate-200 hover:border-docuflow-secondary hover:bg-slate-50/50'
              }`}
            >
              <Upload size={24} className="mx-auto mb-2 text-docuflow-secondary" />
              <p className="text-sm text-slate-500 font-medium">Glissez vos fichiers ici ou <span className="text-docuflow-secondary font-bold">cliquez</span></p>
              <p className="text-[11px] text-slate-400 mt-1">PDF, images, Word, Excel… ({bulkMode ? '100' : '5'} max)</p>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
            </div>

            {files.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                  {files.length} fichier{files.length > 1 ? 's' : ''} sélectionné{files.length > 1 ? 's' : ''}
                </p>
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2">
                    <span className="flex items-center gap-2 text-sm text-slate-600 font-medium truncate"><File size={14} className="text-docuflow-secondary flex-shrink-0" /> <span className="truncate">{f.name}</span></span>
                    <button type="button" onClick={() => removeFile(i)} className="text-red-400 hover:text-red-600 text-xs font-bold flex-shrink-0 ml-2">Retirer</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {bulkResults && (
            <div className="col-span-2 p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 animate-scale-in">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-slate-900">Résultats du téléversement</p>
                <button type="button" onClick={() => setBulkResults(null)} className="text-xs text-slate-400 hover:text-slate-600">Effacer</button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-2 pr-2">
                {(bulkResults.created || []).map((doc, i) => (
                  <div key={i} className="flex items-center justify-between text-[12px] p-2 bg-white rounded-lg border border-slate-100">
                    <span className="text-slate-600 font-medium truncate max-w-[200px]">{doc.fileName}</span>
                    <span className="text-docuflow-secondary font-bold whitespace-nowrap">{doc.reference}</span>
                  </div>
                ))}
                {(bulkResults.failed || []).map((fail, i) => (
                  <div key={i} className="flex items-center justify-between text-[12px] p-2 bg-red-50 rounded-lg border border-red-100">
                    <span className="text-red-600 font-medium truncate max-w-[200px]">{fail.fileName}</span>
                    <span className="text-red-400 text-right ml-2">{fail.error}</span>
                  </div>
                ))}
              </div>
              {bulkResults.rejected && bulkResults.rejected.length > 0 && (
                <div className="p-2 bg-amber-50 rounded-lg border border-amber-100 text-[11px] text-amber-700">
                  <strong>Fichiers rejetés :</strong> {bulkResults.rejected.map(r => r.originalname).join(', ')}
                </div>
              )}
            </div>
          )}

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
