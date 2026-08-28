import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Download, FileText, File, Building2, Calendar, User, Tag, FolderOpen,
  Upload, Trash2, Clock, CheckCircle, AlertCircle, Pencil, Eye, Share2, Mail,
  Lock, Unlock, Link2, Wand2,
} from 'lucide-react';
import { documentService } from '../services/documentService';
import { authService } from '../services/authService';
import DocumentFormModal from './DocumentFormModal';
import ConfirmDialog from './ConfirmDialog';
import { toast } from './Toast';
import DocumentMetadataEditor from './DocumentMetadataEditor';
import { STATUS_CLASSES, STATUS_LABELS } from '../utils/documentStatuses';

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
  const [deleteFileTarget, setDeleteFileTarget] = useState(null);
  // Suppression du document (douce → corbeille, restaurable).
  const [supprimerOuvert, setSupprimerOuvert] = useState(false);
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);

  const handleSupprimerDocument = async () => {
    setSuppressionEnCours(true);
    try {
      await documentService.deleteDocument(documentId);
      toast.success('Document mis à la corbeille — restaurable depuis Documents › Corbeille.');
      setSupprimerOuvert(false);
      onClose();
      if (onChanged) onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Suppression impossible.');
      setSupprimerOuvert(false);
    } finally {
      setSuppressionEnCours(false);
    }
  };
  // Partage & Relations
  const [showShare, setShowShare] = useState(false);
  const [shareEmails, setShareEmails] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [relations, setRelations] = useState([]);
  // Indexation (champs du schéma de métadonnées de l'organisation) : c'est
  // l'écran qui donne un sens au statut « à indexer » posé par le téléversement
  // en masse — sans lui, la file d'attente n'avait AUCUNE entrée d'interface
  // pour remplir les champs configurés dans le portail d'administration.
  const [showIndexing, setShowIndexing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await documentService.getDocument(documentId);
      setDoc(data);
      setSelectedFile(data.files?.[0] || null);
      setNewStatus(data.statut || '');
      try {
        const rels = await documentService.getRelations(documentId);
        setRelations(rels);
      } catch { /* silencieux */ }
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
      toast.success(`${newFiles.length} fichier(s) ajouté(s)`);
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
    setDeleteFileTarget(fileId);
  };

  const confirmDeleteFile = async () => {
    if (!deleteFileTarget) return;
    try {
      await documentService.deleteFile(documentId, deleteFileTarget);
      toast.success('Fichier supprimé');
      setDeleteFileTarget(null);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors de la suppression');
      setDeleteFileTarget(null);
    }
  };

  const handleSetStatus = async () => {
    if (!newStatus || newStatus === doc.statut) return;
    setStatusBusy(true);
    try {
      await documentService.setStatus(documentId, newStatus, statusComment || undefined);
      toast.success('Statut mis à jour');
      setStatusComment('');
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors du changement de statut');
    } finally {
      setStatusBusy(false);
    }
  };

  const handleShare = async () => {
    const emails = shareEmails.split(/[,;\s]+/).map(e => e.trim()).filter(e => e.includes('@'));
    if (!emails.length) return toast.error('Entrez au moins une adresse email valide');
    setShareBusy(true);
    try {
      const result = await documentService.shareDocument(documentId, emails, shareMessage);
      // On affiche le compte-rendu du serveur, et non le nombre d'adresses
      // saisies : si les notifications sont désactivées ou qu'un envoi échoue,
      // annoncer « partagé avec 3 personnes » ferait attendre des e-mails qui
      // n'arriveront jamais. Le serveur renvoie `sent` et un message explicite.
      const message = result?.message || `Document partagé avec ${emails.length} personne(s)`;
      if (result?.sent === 0) toast.error(message);
      else toast.success(message);
      setShowShare(false);
      setShareEmails('');
      setShareMessage('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du partage');
    } finally {
      setShareBusy(false);
    }
  };

  const handleCheckout = async () => {
    try {
      const res = await documentService.checkoutDocument(documentId);
      toast.success(res.message || 'Check-out effectué');
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du verrouillage');
    }
  };

  const handleCheckin = async () => {
    try {
      const res = await documentService.checkinDocument(documentId);
      toast.success(res.message || 'Check-in effectué');
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du déverrouillage');
    }
  };

  const isPdf = selectedFile?.mime_type === 'application/pdf';
  const isImage = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(selectedFile?.mime_type);

  // Qui peut libérer le verrou : le backend n'accepte que le détenteur ou un
  // administrateur (403 sinon). La comparaison se fait en nombres, parce que
  // `checked_out_by` remonte de PostgreSQL en entier alors que l'identifiant
  // stocké en session a pu transiter par une chaîne JSON.
  const utilisateur = authService.getCurrentUser();
  const estDetenteur = doc?.checked_out_by != null
    && Number(doc.checked_out_by) === Number(utilisateur?.id);
  const peutLiberer = estDetenteur || isAdmin;

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
            <button onClick={() => setShowShare(true)} className="btn-secondary flex items-center gap-1.5"><Share2 size={15} /> Partager</button>
            {/* Indexation : visible pour le personnel (la route /:id/metadata
                est réservée aux rôles GED côté serveur). Mise en avant quand le
                document attend son indexation — c'est l'action à faire. */}
            {isAdmin && (
              <button
                onClick={() => setShowIndexing(true)}
                className={`flex items-center gap-1.5 ${doc?.statut === 'à indexer' ? 'btn-primary' : 'btn-secondary'}`}
              >
                <Wand2 size={15} /> Indexer
              </button>
            )}
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

          {loading && <div className="py-20 text-center text-slate-400"><div className="w-8 h-8 border-2 border-slate-300 border-t-docuflow-secondary rounded-full animate-spin mx-auto mb-3"></div>Chargement du document…</div>}
          {!loading && doc && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Colonne gauche : métadonnées */}
              <div className="lg:col-span-2 space-y-5">
                <div className="glass-card-premium p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`status-badge ${STATUS_CLASSES[doc.statut] || ''}`}>{STATUS_LABELS[doc.statut] || doc.statut}</span>
                    <div className="flex items-center gap-1.5">
                      {doc.is_checked_out ? (
                        <span className="badge badge-warn"><Lock size={11} /> Verrouillé</span>
                      ) : (
                        <span className="badge badge-ok"><Unlock size={11} /> Libre</span>
                      )}
                      <span className="text-xs text-slate-400 font-medium">v{doc.version}</span>
                    </div>
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
                        <span key={i} className="px-2 py-0.5 rounded-full bg-blue-50 text-docuflow-secondary text-[11px] font-bold"><Tag size={10} className="inline mr-1" />{t}</span>
                      ))}
                    </div>
                  )}
                  {doc.description && <p className="text-sm text-slate-600 leading-relaxed">{doc.description}</p>}
                </div>

                {/* Documents liés : relations et dépendances */}
                {relations.length > 0 && (
                  <div className="glass-card-premium p-5 space-y-3">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between">
                      <span className="flex items-center gap-1.5"><Link2 size={14} /> Documents liés ({relations.length})</span>
                    </h3>
                    <div className="space-y-2">
                      {relations.map(rel => (
                        <div key={rel.id} className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-docuflow-secondary">{rel.reference_mfile}</span>
                            <p className="text-slate-600 truncate max-w-[180px]">{rel.nom_entreprise}</p>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-docuflow-secondary font-bold capitalize">{rel.relation_type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/*
                  Verrouillage pour édition. Cette carte appartient à la colonne
                  des métadonnées, et non à la liste des fichiers : le verrou
                  porte sur LE DOCUMENT, pas sur une version. Placée dans la
                  rangée d'actions de chaque fichier, elle se répétait autant de
                  fois qu'il y avait de versions.
                */}
                <div className="glass-card-premium p-5 space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      {doc.is_checked_out ? <Lock size={14} /> : <Unlock size={14} />} Verrouillage pour édition
                    </span>
                    <span className={doc.is_checked_out ? 'badge badge-warn' : 'badge badge-ok'}>
                      {doc.is_checked_out ? 'Verrouillé' : 'Disponible'}
                    </span>
                  </h3>

                  {doc.is_checked_out ? (
                    <>
                      {/*
                        Le backend n'autorise le déverrouillage qu'au détenteur du
                        verrou ou à un administrateur. Proposer le bouton à tous
                        garantissait un 403 : l'utilisateur cliquait pour
                        n'obtenir qu'un refus. On explique plutôt l'attente.
                      */}
                      {peutLiberer ? (
                        <>
                          <button onClick={handleCheckin} className="btn btn-primary w-full">
                            <Unlock size={15} /> Libérer le document
                          </button>
                          {!estDetenteur && (
                            <p className="text-[11px] text-[var(--df-warn)]">
                              Verrouillé par un autre utilisateur : vous le libérez en tant qu'administrateur.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-slate-500">
                          Un autre utilisateur a verrouillé ce document pour le modifier.
                          Lui seul, ou un administrateur, peut le libérer.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <button onClick={handleCheckout} className="btn btn-secondary w-full">
                        <Lock size={15} /> Verrouiller pour modification
                      </button>
                      <p className="text-[11px] text-slate-400">
                        Signale aux autres utilisateurs que vous travaillez sur ce document.
                      </p>
                    </>
                  )}
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

                {isAdmin && (
                  <div className="glass-card-premium p-5 space-y-3">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Suppression</h3>
                    <button
                      onClick={() => setSupprimerOuvert(true)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 text-red-600 font-semibold hover:bg-red-50 transition-colors text-sm"
                    >
                      <Trash2 size={15} /> Mettre à la corbeille
                    </button>
                    <p className="text-[11px] text-slate-400">
                      Le document part en corbeille : il reste restaurable, ses fichiers
                      et son historique sont conservés.
                    </p>
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
                          selectedFile?.id === f.id ? 'border-docuflow-secondary bg-blue-50/50' : 'border-slate-100 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-docuflow-secondary to-blue-600 flex items-center justify-center text-white flex-shrink-0">
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
                        <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-docuflow-secondary flex-shrink-0">
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

      {showIndexing && doc && (
        <DocumentMetadataEditor
          documentId={doc.id}
          onClose={() => setShowIndexing(false)}
          onSuccess={() => { if (onChanged) onChanged(); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteFileTarget}
        title="Supprimer ce fichier ?"
        message="Cette action est irréversible. Le fichier sera supprimé du stockage définitivement."
        confirmLabel="Supprimer"
        type="danger"
        onConfirm={confirmDeleteFile}
        onClose={() => setDeleteFileTarget(null)}
      />

      {/* Suppression du document — douce : la corbeille reste restaurable. */}
      <ConfirmDialog
        isOpen={supprimerOuvert}
        title={`Mettre « ${doc?.reference_mfile || 'ce document'} » à la corbeille ?`}
        message="Le document disparaît du référentiel mais reste restaurable depuis la corbeille, avec ses fichiers, ses métadonnées et son historique."
        confirmLabel="Mettre à la corbeille"
        type="danger"
        onConfirm={handleSupprimerDocument}
        onClose={() => setSupprimerOuvert(false)}
      />

      {/* Modal de partage */}
      {showShare && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setShowShare(false)}>
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl animate-scale-in overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-docuflow-secondary/10 rounded-xl"><Share2 size={18} className="text-docuflow-secondary" /></div>
                <h3 className="text-lg font-bold text-slate-800">Partager le document</h3>
              </div>
              <button onClick={() => setShowShare(false)} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Adresses email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={shareEmails}
                    onChange={e => setShareEmails(e.target.value)}
                    placeholder="email1@gmail.com, email2@gmail.com"
                    className="input-premium pl-10"
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Séparez plusieurs adresses par une virgule</p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Message (optionnel)</label>
                <textarea
                  value={shareMessage}
                  onChange={e => setShareMessage(e.target.value)}
                  placeholder="Ajoutez un message pour les destinataires..."
                  className="input-premium min-h-[80px] resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={handleShare} disabled={shareBusy} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  {shareBusy ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Share2 size={16} />}
                  {shareBusy ? 'Envoi...' : 'Envoyer'}
                </button>
                <button onClick={() => setShowShare(false)} className="btn-secondary">Annuler</button>
              </div>
            </div>
          </div>
        </div>
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
