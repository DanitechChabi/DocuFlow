import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Plus, FolderOpen, FileText, Building2, Calendar, Hash,
  FolderPlus, ChevronLeft, ChevronRight, AlertCircle,
} from 'lucide-react';
import { documentService } from '../services/documentService';
import { authService } from '../services/authService';
import DocumentFormModal from '../components/DocumentFormModal';
import DocumentDetailsModal from '../components/DocumentDetailsModal';

const STATUS_CLASSES = {
  'disponible': 'status-badge-delivered',
  'prêt': 'status-badge-progress',
  'archivé': 'status-badge-annulled',
};

const STATUS_LABELS = { 'disponible': 'Disponible', 'prêt': 'Prêt', 'archivé': 'Archivé' };

const DocumentsPage = () => {
  const user = authService.getCurrentUser();
  const isAdmin = ['superadmin', 'admin', 'archiviste'].includes(user?.role);
  const [searchParams] = useSearchParams();

  // Recherche globale depuis la topbar → pré-remplir ?q=
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ statut: '', type_document: '', annee: '', dossier_id: '' });
  const [folders, setFolders] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);

  const [showForm, setShowForm] = useState(false);
  const [editingDoc, setEditingDoc] = useState(null);
  const [detailDoc, setDetailDoc] = useState(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, page_size: pageSize };
      if (search) params.q = search;
      if (filters.statut) params.statut = filters.statut;
      if (filters.type_document) params.type_document = filters.type_document;
      if (filters.annee) params.annee = filters.annee;
      if (filters.dossier_id) params.dossier_id = filters.dossier_id;
      if (filters.tag) params.tag = filters.tag;
      const res = await documentService.getDocuments(params);
      setData(res);
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors du chargement des documents');
    } finally {
      setLoading(false);
    }
  }, [search, filters, page, pageSize]);

  const loadFolders = useCallback(async () => {
    try {
      setFolders(await documentService.getFolders());
    } catch { /* silencieux */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadFolders(); }, [loadFolders]);

  // Debounce de la recherche
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 400);
    return () => clearTimeout(t);
  }, [q]);

  // Suivre les changements de ?q= (nouvelle recherche depuis la topbar)
  useEffect(() => {
    const urlQ = searchParams.get('q');
    if (urlQ !== null && urlQ !== q) setQ(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    try {
      await documentService.createFolder(folderName.trim());
      setFolderName('');
      setFolderOpen(false);
      await loadFolders();
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur création dossier');
    }
  };

  const handleFolderFilter = (e) => {
    const v = e.target.value;
    setFilters((f) => ({ ...f, dossier_id: v }));
    setPage(1);
  };

  const total = data?.pagination?.total || 0;
  const totalPages = data?.pagination?.total_pages || 1;

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 md:py-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 animate-fade-in-down">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <FolderOpen className="text-afgc-secondary" size={24} />
                Documents
              </h1>
              <p className="text-sm text-slate-400 font-medium">Référentiel documentaire — recherche, classement et versions</p>
            </div>
          </div>
          {isAdmin && (
            <button onClick={() => { setEditingDoc(null); setShowForm(true); }} className="btn-primary flex items-center gap-2">
              <Plus size={18} /> Nouveau document
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="glass-card-premium p-4 mb-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="input-premium pl-11"
                placeholder="Rechercher : entreprise, dossier, acte, référence, description…"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
              />
            </div>
            <select className="input-premium w-auto" value={filters.statut} onChange={(e) => { setFilters((f) => ({ ...f, statut: e.target.value })); setPage(1); }}>
              <option value="">Statut : tous</option>
              <option value="disponible">Disponible</option>
              <option value="prêt">Prêt</option>
              <option value="archivé">Archivé</option>
            </select>
            <select className="input-premium w-auto" value={filters.type_document} onChange={(e) => { setFilters((f) => ({ ...f, type_document: e.target.value })); setPage(1); }}>
              <option value="">Type : tous</option>
              {['Acte', 'Contrat', 'Rapport', 'PV', 'Lettre', 'Dossier', 'Autre'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              className="input-premium w-auto"
              placeholder="Année"
              value={filters.annee}
              onChange={(e) => { setFilters((f) => ({ ...f, annee: e.target.value })); setPage(1); }}
            />
            <select className="input-premium w-auto" value={filters.dossier_id} onChange={handleFolderFilter}>
              <option value="">Dossier : tous</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button onClick={() => setFolderOpen((v) => !v)} className="btn-secondary flex items-center gap-2" title="Gérer les dossiers">
              <FolderPlus size={16} /> Dossiers
            </button>
          </div>

          {/* Facettes : tags cliquables */}
          {data?.facets?.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1 self-center">Tags :</span>
              {data.facets.tags.slice(0, 12).map((tag) => (
                <button
                  key={tag}
                  onClick={() => { setFilters(f => ({ ...f, tag: f.tag === tag ? '' : tag })); setPage(1); }}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                    filters.tag === tag
                      ? 'bg-afgc-secondary text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {folderOpen && (
            <form onSubmit={handleCreateFolder} className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <input
                className="input-premium flex-1"
                placeholder="Nom du nouveau dossier (ex. Archives 2026)"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
              />
              <button type="submit" className="btn-primary">Créer</button>
            </form>
          )}

          <div className="text-xs text-slate-400 font-medium">
            {loading ? 'Chargement…' : `${total} document${total > 1 ? 's' : ''}`}
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50/80 backdrop-blur-sm text-red-600 rounded-xl border border-red-200 text-sm font-bold flex items-center gap-3">
            <AlertCircle size={18} /> {error}
          </div>
        )}

        {/* Table */}
        <div className="glass-card-premium overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Référence</th>
                  <th className="px-4 py-3 text-left">Entreprise</th>
                  <th className="px-4 py-3 text-left">N° dossier / acte</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Année</th>
                  <th className="px-4 py-3 text-left">Dossier</th>
                  <th className="px-4 py-3 text-left">Statut</th>
                  <th className="px-4 py-3 text-center">Fichiers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!loading && data?.documents?.map((d) => (
                  <tr key={d.id} onClick={() => setDetailDoc(d.id)} className="hover:bg-blue-50/40 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-bold text-afgc-secondary">{d.reference_mfile}</td>
                    <td className="px-4 py-3 font-medium text-slate-800 flex items-center gap-2"><Building2 size={14} className="text-slate-400" /> {d.nom_entreprise}</td>
                    <td className="px-4 py-3 text-slate-600">{d.num_dossier} / {d.num_acte}</td>
                    <td className="px-4 py-3">{d.type_document || '—'}</td>
                    <td className="px-4 py-3"><Calendar size={13} className="inline mr-1 text-slate-400" />{d.annee}</td>
                    <td className="px-4 py-3">{d.dossier_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`status-badge ${STATUS_CLASSES[d.statut] || ''}`}>{STATUS_LABELS[d.statut] || d.statut}</span>
                    </td>
                    <td className="px-4 py-3 text-center"><FileText size={14} className="inline mr-1 text-slate-400" />{d.files_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && data?.documents?.length === 0 && (
              <div className="py-16 text-center text-slate-400">
                <FileText size={36} className="mx-auto mb-3 opacity-40" />
                <p className="font-medium">Aucun document trouvé</p>
                <p className="text-sm">Ajustez votre recherche ou créez un document.</p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="btn-secondary flex items-center gap-1 disabled:opacity-40"
              >
                <ChevronLeft size={16} /> Précédent
              </button>
              <span className="text-sm text-slate-500 font-medium">Page {page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="btn-secondary flex items-center gap-1 disabled:opacity-40"
              >
                Suivant <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <DocumentFormModal
          editing={editingDoc}
          folders={folders}
          onClose={() => setShowForm(false)}
          onSuccess={() => { setShowForm(false); load(); loadFolders(); }}
        />
      )}
      {detailDoc && (
        <DocumentDetailsModal
          documentId={detailDoc}
          isAdmin={isAdmin}
          folders={folders}
          onClose={() => setDetailDoc(null)}
          onChanged={() => { load(); }}
        />
      )}
    </div>
  );
};

export default DocumentsPage;
