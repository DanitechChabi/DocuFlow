import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Download, FileText, File, Building2, Calendar, User, Tag, FolderOpen,
  Upload, Trash2, Clock, CheckCircle, AlertCircle, Pencil, Eye,
} from 'lucide-react';
import { documentService } from '../services/documentService';
import DocumentFormModal from './DocumentFormModal';

const STATUS_LABELS = { 'disponible': 'Disponible', 'prêt': 'Prêt', 'archivé': 'Archivé' };
const STATUS_CLASSES = { 'disponible': 'status-badge-delivered', 'prêt': 'status-badge-progress', 'archivé': 'status-badge-annulled' };

const formatSize = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};

const DocumentDetailsModal = ({ documentId, isAdmin, folders = [], onClose, onChanged }) => {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [newFiles, setNewFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [statusComment, setStatusComment] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await documentService.getDocument(documentId);
      setDoc(data);
      setSelectedFile(data.files?.[0] || null);
      setNewStatus(data.statut || '');
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors du chargement du document');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => { load(); }, [load]);

  const handleAddVersion = async () => {
    if (!newFiles.length) return;
    setUploading(true);
    try {
      await documentService.addFiles(documentId, newFiles);
      setNewFiles([]);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.response?.data?.message || "Erreur lors de l'ajout des fichiers");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (fileId) => {
    if (!window.confirm('Supprimer cette version du document ?')) return;
    try {
      await documentService.deleteFile(documentId, fileId);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors de la suppression');
    }
  };

  const handleSetStatus = async () => {
    if (!newStatus || newStatus === doc.statut) return;
    setStatusBusy(true);
    try {
      await documentService.setStatus(documentId, newStatus, statusComment || undefined);
      setStatusComment('');
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors du changement de statut');
    } finally {
      setStatusBusy(false);
    }
  };

  const isPdf = selectedFile?.mime_type === 'application/pdf';
  const isImage = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(selectedFile?.mime_type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-elevated w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col animate-scale-in" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">{doc?.reference_mfile || 'Document'}</h2>
            <p className="text-sm text-slate-400 font-medium">{doc?.nom_entreprise || 'Chargement…'}</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && <button onClick={() => setShowEdit(true)} className="btn-secondary flex items-center gap-1.5"><Pencil size={15} /> Modifier</button>}
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50/80 text-red-600 rounded-xl border border-red-200 text-sm font-bold flex items-center gap-3">
              <AlertCircle size={18} /> {error}
            </div>
          )}

          {loading && <div className="py-20 text-center text-slate-400"><div className="w-8 h-8 border-2 border-slate-300 border-t-afgc-secondary rounded-full animate-spin mx-auto mb-3"></div>Chargement du document…</div>}
          {!loading && doc && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Colonne gauche : métadonnées */}
              <div className="lg:col-span-2 space-y-5">
                <div className="glass-card-premium p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`status-badge ${STATUS_CLASSES[doc.statut] || ''}`}>{STATUS_LABELS[doc.statut] || doc.statut}</span>
                    <span className="text-xs text-slate-400 font-medium">v{doc.version}</span>
                  </div>
                  <Meta icon={Building2} label="Entreprise" value={doc.nom_entreprise} />
                  <Meta icon={FileText} label="N° dossier / acte" value={`${doc.num_dossier} / ${doc.num_acte}`} />
                  <Meta icon={Calendar} label="Année" value={doc.annee} />
                  {doc.type_document && <Meta icon={File} label="Type" value={doc.type_document} />}
                  {doc.auteur && <Meta icon={User} label="Auteur" value={doc.auteur} />}
                  {doc.date_document && <Meta icon={Calendar} label="Date du document" value={new Date(doc.date_document).toLocaleDateString('fr-FR')} />}
                  {doc.dossier_name && <Meta icon={FolderOpen} label="Dossier" value={doc.dossier_name} />}
                  {doc.created_by_name && <Meta icon={User} label="Créé par" value={doc.created_by_name} />}
                  {Array.isArray(doc.tags) && doc.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {doc.tags.map((t, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full bg-blue-50 text-afgc-secondary text-[11px] font-bold"><Tag size={10} className="inline mr-1" />{t}</span>
                      ))}
                    </div>
                  )}
                  {doc.description && <p className="text-sm text-slate-600 leading-relaxed">{doc.description}</p>}
                </div>

                {isAdmin && (
                  <div className="glass-card-premium p-5 space-y-3">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Cycle de vie</h3>
                    <div className="flex items-center gap-2">
                      <select className="input-premium flex-1" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                        {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <button
                        onClick={handleSetStatus}
                        disabled={statusBusy || newStatus === doc.statut}
                        className="btn-primary disabled:opacity-40"
                      >
                        {statusBusy ? '…' : 'Appliquer'}
                      </button>
                    </div>
                    <input
                      className="input-premium"
                      placeholder="Commentaire (optionnel)"
                      value={statusComment}
                      onChange={(e) => setStatusComment(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Colonne droite : fichiers + aperçu */}
              <div className="lg:col-span-3 space-y-5">
                {/* Aperçu */}
                {selectedFile && (
                  <div className="glass-card-premium p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5"><Eye size={14} /> Aperçu — v{selectedFile.version}</h3>
                      <a href={selectedFile.url} target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-1.5"><Download size={14} /> Télécharger</a>
                    </div>
                    <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 h-72">
                      {isPdf ? (
                        <iframe src={selectedFile.url} title="Aperçu PDF" className="w-full h-full" />
                      ) : isImage ? (
                        <img src={selectedFile.url} alt="Aperçu" className="w-full h-full object-contain" />
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                          <FileText size={40} className="mb-2 opacity-40" />
                          <p className="text-sm font-medium">Aperçu non disponible pour ce format</p>
                          <p className="text-xs">{selectedFile.original_name}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Liste des fichiers / versions */}
                <div className="glass-card-premium p-4">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Versions & fichiers ({doc.files?.length || 0})</h3>
                  <div className="space-y-2">
                    {doc.files?.map((f) => (
                      <div
                        key={f.id}
                        onClick={() => setSelectedFile(f)}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl border cursor-pointer transition-colors ${
                          selectedFile?.id === f.id ? 'border-afgc-secondary bg-blue-50/50' : 'border-slate-100 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-afgc-secondary to-blue-600 flex items-center justify-center text-white flex-shrink-0">
                            <File size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-700 truncate">{f.original_name}</p>
                            <p className="text-[11px] text-slate-400">v{f.version} · {formatSize(f.file_size)} · {f.uploaded_by_name || ''}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <a href={f.url} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500" title="Télécharger"><Download size={15} /></a>
                          {isAdmin && (
                            <button onClick={() => handleDeleteFile(f.id)} className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-red-400 hover:text-red-600" title="Supprimer"><Trash2 size={15} /></button>
                          )}
                        </div>
                      </div>
                    ))}
                    {!doc.files?.length && <p className="text-sm text-slate-400 text-center py-6">Aucun fichier — document non numérisé.</p>}
                  </div>

                  {isAdmin && (
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => setNewFiles(Array.from(e.target.files || []))} />
                      <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex items-center gap-2 flex-1 justify-center"><Upload size={16} /> Ajouter une version</button>
                      {newFiles.length > 0 && (
                        <button onClick={handleAddVersion} disabled={uploading} className="btn-primary">
                          {uploading ? '…' : `Envoyer (${newFiles.length})`}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Historique */}
                <div className="glass-card-premium p-4">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Clock size={14} /> Historique</h3>
                  <div className="space-y-3">
                    {doc.history?.map((h) => (
                      <div key={h.id} className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-afgc-secondary flex-shrink-0">
                          <CheckCircle size={15} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-700">{h.action}</p>
                          <p className="text-[11px] text-slate-400">
                            {h.user_name || '—'} · {new Date(h.created_at).toLocaleString('fr-FR')}
                            {h.previous_status && h.new_status && ` · ${h.previous_status} → ${h.new_status}`}
                          </p>
                          {h.comment && <p className="text-xs text-slate-500 mt-0.5">{h.comment}</p>}
                        </div>
                      </div>
                    ))}
                    {!doc.history?.length && <p className="text-sm text-slate-400 text-center py-4">Aucun historique.</p>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showEdit && doc && (
        <DocumentFormModal
          editing={doc}
          folders={folders}
          onClose={() => setShowEdit(false)}
          onSuccess={() => { setShowEdit(false); load(); if (onChanged) onChanged(); }}
        />
      )}
    </div>
  );
};

const Meta = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-3">
    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0"><Icon size={15} /></div>
    <div className="min-w-0">
      <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-slate-700 break-words">{value || '—'}</p>
    </div>
  </div>
);

export default DocumentDetailsModal;
