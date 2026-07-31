import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Clock, FileText, Search, CheckCircle,
  AlertCircle, Save, Shield, Paperclip, Download, Upload, File, UserCircle2
} from 'lucide-react';
import { requestService } from '../services/requestService';
import { uploadService } from '../services/uploadService';

// Machine à états côté client (miroir du backend requestStateMachine)
const TRANSITIONS = {
  'en attente': ['a traiter', 'rejete', 'annulé'],
  'a traiter': ['transmis', 'rejete', 'annulé'],
  'transmis': ['livré', 'rejete', 'annulé'],
  'livré': [],
  'rejete': [],
  'annulé': [],
};
const STATUS_LABELS = {
  'en attente': 'En attente',
  'a traiter': 'À traiter',
  'transmis': 'Transmis',
  'livré': 'Livré',
  'rejete': 'Rejeté',
  'annulé': 'Annulé',
};
const TERMINAL_STATUSES = new Set(['livré', 'rejete', 'annulé']);

const RequestDetailsModal = ({ request, history, stateHistory = [], role, onClose }) => {
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [mfileData, setMfileData] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [archivists, setArchivists] = useState([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const fileInputRef = useRef(null);

  const isAdmin = role === 'archiviste' || role === 'admin' || role === 'superadmin';

  const loadFiles = useCallback(async () => {
    if (!request?.id) return;
    setFilesLoading(true);
    try {
      const data = await uploadService.getRequestFiles(request.id);
      setFiles(data);
    } catch (err) {
      // Silencieux — peut être que la table n'existe pas encore
    } finally {
      setFilesLoading(false);
    }
  }, [request?.id]);

  useEffect(() => {
    if (request) {
      setStatus(request.statut || '');
      setNotes(request.notes_internes || '');
      setAssigneeId(request.assignee_id ? String(request.assignee_id) : '');
      loadFiles();
      if (isAdmin) {
        requestService.getArchivists()
          .then(setArchivists)
          .catch(() => {});
      }
    }
  }, [request, loadFiles, isAdmin]);

  const handleUploadFiles = async (e) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    setUploadingFiles(true);
    try {
      await uploadService.uploadRequestFiles(request.id, selected);
      await loadFiles();
    } catch (err) {
      alert("Erreur lors de l'upload des fichiers");
    } finally {
      setUploadingFiles(false);
      e.target.value = '';
    }
  };

  const handleDeleteFile = async (fileId) => {
    if (!confirm('Supprimer ce fichier ?')) return;
    try {
      await uploadService.deleteRequestFile(fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch (err) {
      alert('Erreur lors de la suppression');
    }
  };

  const handleVerifyMfile = async () => {
    setIsVerifying(true);
    setMfileData(null);
    try {
      const res = await requestService.verifyMfile(request.id);
      setMfileData(res);
    } catch (err) {
      alert('Erreur lors de la vérification Mfile');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSave = async () => {
    setIsUpdating(true);
    try {
      await requestService.updateStatus(request.id, { status, notes_internes: notes });
      alert('Mise à jour effectuée avec succès');
      onClose();
    } catch (err) {
      alert(err.response?.data?.message || 'Erreur lors de la sauvegarde');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAssign = async (e) => {
    const nextAssigneeId = e.target.value;
    setAssigneeId(nextAssigneeId);
    if (!nextAssigneeId) return;
    setAssigning(true);
    try {
      await requestService.assignRequest(request.id, Number(nextAssigneeId));
      alert('Demande assignée avec succès');
      onClose();
    } catch (err) {
      alert(err.response?.data?.message || "Erreur lors de l'assignation");
      setAssigneeId(request.assignee_id ? String(request.assignee_id) : '');
    } finally {
      setAssigning(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!confirm("Confirmer l'annulation de cette demande ?")) return;
    setIsUpdating(true);
    try {
      await requestService.updateStatus(request.id, { status: 'annulé' });
      alert('Demande annulée');
      onClose();
    } catch (err) {
      alert(err.response?.data?.message || "Erreur lors de l'annulation");
    } finally {
      setIsUpdating(false);
    }
  };

  if (!request) return null;

  const statusColor = {
    'en attente': 'border-l-orange-400',
    'transmis': 'border-l-green-400',
    'livré': 'border-l-blue-400',
    'a traiter': 'border-l-purple-400',
    'rejete': 'border-l-red-400',
    'annulé': 'border-l-slate-400',
  };

  const allowedStatuses = isAdmin
    ? (TRANSITIONS[request.statut] || [])
    : [];
  const isTerminalRequest = TERMINAL_STATUSES.has(request.statut);

  const formatDate = (d) => d ? new Date(d).toLocaleString('fr-FR') : '—';

  const statusBadgeClass = (s) => {
    const map = {
      'en attente': 'status-badge-pending',
      'a traiter': 'status-badge-progress',
      'transmis': 'status-badge-transmitted',
      'livré': 'status-badge-delivered',
      'rejete': 'status-badge-rejected',
      'annulé': 'status-badge-annulled',
    };
    return map[s] || 'bg-slate-100 text-slate-600';
  };
  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
    return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
  };
  const getFileIcon = (mime) => {
    if (!mime) return File;
    if (mime.includes('pdf')) return FileText;
    if (mime.includes('image')) return File;
    return File;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 backdrop-blur-sm p-0 sm:p-4 sm:pt-12 overflow-y-auto animate-fade-in" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl min-h-screen sm:min-h-0 rounded-none sm:rounded-3xl shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`px-5 sm:px-8 py-5 sm:py-6 border-b border-slate-100 ${statusColor[request.statut] || 'border-l-transparent'} border-l-4 sticky top-0 bg-white z-10`}>
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <div className="p-2.5 sm:p-3 bg-gradient-to-br from-afgc-primary to-slate-800 text-afgc-secondary rounded-xl sm:rounded-2xl shadow-md flex-shrink-0">
                <FileText size={22} />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight truncate">{request.nom_entreprise}</h2>
                <p className="text-xs sm:text-sm text-slate-500 font-medium flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                  Dossier <span className="font-bold text-slate-700">{request.num_dossier}</span>
                  <span className="text-slate-300">·</span>
                  Acte <span className="font-bold text-slate-700">{request.num_acte}</span>
                  <span className="text-slate-300">·</span>
                  {request.annee}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2.5 hover:bg-slate-100 rounded-full transition-colors">
              <X size={20} className="text-slate-400" />
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-8 grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Main info */}
          <div className="lg:col-span-2 space-y-6 lg:space-y-8">
            {/* Machine à états : étapes horodatées */}
            {stateHistory && stateHistory.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-5 flex items-center gap-2">
                  <Shield size={14} /> Étapes de la demande
                </h3>
                <div className="space-y-4">
                  {stateHistory.map((h, idx) => (
                    <div key={h.id} className="flex gap-4 animate-fade-in-up" style={{ animationDelay: `${idx * 50}ms` }}>
                      <div className="flex flex-col items-center">
                        <div className={`w-3 h-3 rounded-full border-2 ${idx === 0 ? 'bg-afgc-secondary border-afgc-secondary' : 'bg-white border-slate-300'}`}></div>
                        {idx < stateHistory.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 mt-1"></div>}
                      </div>
                      <div className="pb-6">
                        <p className="text-sm font-bold text-slate-700">{h.action}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {h.user_name} · {formatDate(h.timestamp)}
                        </p>
                        {h.previous_status && h.new_status && h.previous_status !== h.new_status && (
                          <p className="text-xs mt-1">
                            <span className={`status-badge !px-2 !py-0.5 !text-[10px] ${statusBadgeClass(h.previous_status)}`}>{STATUS_LABELS[h.previous_status] || h.previous_status}</span>
                            <span className="mx-1 text-slate-400">→</span>
                            <span className={`status-badge !px-2 !py-0.5 !text-[10px] ${statusBadgeClass(h.new_status)}`}>{STATUS_LABELS[h.new_status] || h.new_status}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timeline / History */}
            {history && history.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-5 flex items-center gap-2">
                  <Clock size={14} /> Chronologie
                </h3>
                <div className="space-y-4">
                  {history.map((h, idx) => (
                    <div key={h.id} className="flex gap-4 animate-fade-in-up" style={{ animationDelay: `${idx * 50}ms` }}>
                      <div className="flex flex-col items-center">
                        <div className={`w-3 h-3 rounded-full border-2 ${idx === 0 ? 'bg-afgc-secondary border-afgc-secondary' : 'bg-white border-slate-300'}`}></div>
                        {idx < history.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 mt-1"></div>}
                      </div>
                      <div className="pb-6">
                        <p className="text-sm font-bold text-slate-700">{h.action}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{h.user_name} · {formatDate(h.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Demandeur : annulation de sa propre demande */}
            {!isAdmin && !isTerminalRequest && (
              <div className="pt-6 border-t border-slate-100">
                <button
                  onClick={handleCancelRequest}
                  disabled={isUpdating}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 font-bold text-sm transition-all disabled:opacity-50"
                >
                  <X size={16} /> Annuler la demande
                </button>
              </div>
            )}

            {/* Admin section */}
            {isAdmin && (
              <div className="space-y-6 pt-6 border-t border-slate-100">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Shield size={14} /> Traitement archiviste
                </h3>

                {/* Assignation */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 ml-1">Assignée à</label>
                  <div className="relative">
                    <UserCircle2 size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <select
                      className="input-premium pl-12"
                      value={assigneeId}
                      onChange={handleAssign}
                      disabled={assigning}
                    >
                      <option value="">— Non assignée —</option>
                      {archivists.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.full_name} · {a.open_tasks || 0} en cours
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Statut — étapes autorisées par la machine à états */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 ml-1">Statut</label>
                  {isTerminalRequest ? (
                    <p className="text-sm text-slate-500">
                      Demande terminée — état final : <b>{STATUS_LABELS[request.statut] || request.statut}</b>.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allowedStatuses.map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatus(s)}
                          className={`px-3 sm:px-4 py-2 rounded-xl text-[10px] sm:text-xs font-bold transition-all uppercase tracking-wider ${
                            status === s
                              ? 'bg-afgc-primary text-white shadow-sm'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {STATUS_LABELS[s] || s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 ml-1">Notes internes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="input-premium resize-none"
                    placeholder="Ajouter une note interne..."
                  />
                </div>

                {/* Upload de fichiers archiviste */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 ml-1">Documents traités</label>
                  <div className="flex gap-2">
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploadingFiles}
                      className="btn-secondary flex items-center gap-2 flex-1 justify-center">
                      {uploadingFiles ? (
                        <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                      ) : <Upload size={18} />}
                      {uploadingFiles ? 'Upload...' : 'Ajouter des fichiers'}
                    </button>
                    <input ref={fileInputRef} type="file" multiple onChange={handleUploadFiles}
                      className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  {!isTerminalRequest && (
                    <button
                      onClick={handleSave}
                      disabled={isUpdating || !allowedStatuses.includes(status)}
                      className="btn-primary flex items-center justify-center gap-2 flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isUpdating ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : <Save size={18} />}
                      {isUpdating ? 'Sauvegarde...' : 'Sauvegarder'}
                    </button>
                  )}

                  <button onClick={handleVerifyMfile} disabled={isVerifying}
                    className="btn-secondary flex items-center justify-center gap-2 flex-1">
                    {isVerifying ? (
                      <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                    ) : <Search size={18} />}
                    {isVerifying ? 'Vérification...' : 'Vérifier Mfile'}
                  </button>
                </div>

                {/* Mfile result */}
                {mfileData && (
                  <div className={`p-4 rounded-xl border text-sm ${mfileData.exists ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-600'}`}>
                    <div className="flex items-center gap-2 font-bold mb-1">
                      {mfileData.exists ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                      {mfileData.exists ? 'Document trouvé dans Mfile' : 'Document introuvable'}
                    </div>
                    {mfileData.fileUrl && (
                      <p className="text-xs mt-1 opacity-75">URL : {mfileData.fileUrl}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-5">
            <div className="glass-card p-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Informations</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Statut actuel</p>
                  <span className={`status-badge mt-1 ${
                    request.statut === 'en attente' ? 'status-badge-pending' :
                    request.statut === 'transmis' ? 'status-badge-transmitted' :
                    request.statut === 'livré' ? 'status-badge-delivered' :
                    request.statut === 'a traiter' ? 'status-badge-progress' :
                    request.statut === 'rejete' ? 'status-badge-rejected' :
                    request.statut === 'annulé' ? 'status-badge-annulled' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {STATUS_LABELS[request.statut] || request.statut}
                  </span>
                </div>
                {request.assignee_name && (
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Assignée à</p>
                    <p className="text-sm font-bold text-slate-700 mt-0.5">{request.assignee_name}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Priorité</p>
                  <p className="text-sm font-bold text-slate-700 mt-0.5">{request.priorite}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Type de document</p>
                  <p className="text-sm font-medium text-slate-700 mt-0.5">{request.type_document || 'Non spécifié'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Motif</p>
                  <p className="text-sm font-medium text-slate-700 mt-0.5">{request.motif}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Date de création</p>
                  <p className="text-sm font-medium text-slate-700 mt-0.5">{formatDate(request.created_at)}</p>
                </div>
                {request.date_livraison && (
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Date de livraison</p>
                    <p className="text-sm font-medium text-slate-700 mt-0.5">{formatDate(request.date_livraison)}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Pièces jointes */}
            <div className="glass-card p-5 space-y-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Paperclip size={14} /> Pièces jointes
              </h3>

              {filesLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <div className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                  Chargement...
                </div>
              ) : files.length === 0 ? (
                <p className="text-sm text-slate-400">Aucun fichier joint</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {files.map((f) => {
                    const Icon = getFileIcon(f.mime_type);
                    return (
                      <div key={f.id} className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-xl group hover:bg-slate-100 transition-colors">
                        <div className="p-1.5 bg-white rounded-lg shadow-sm">
                          <Icon size={14} className="text-afgc-secondary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-700 truncate">{f.original_name}</p>
                          <p className="text-[10px] text-slate-400">{formatSize(f.file_size)}</p>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <a href={f.url} target="_blank" rel="noopener noreferrer"
                            className="p-1.5 hover:bg-afgc-secondary/10 rounded-lg text-slate-400 hover:text-afgc-secondary transition-colors"
                            title="Télécharger">
                            <Download size={14} />
                          </a>
                          {isAdmin && (
                            <button onClick={() => handleDeleteFile(f.id)}
                              className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition-colors"
                              title="Supprimer">
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RequestDetailsModal;
