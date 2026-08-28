import React from 'react';
import { Link } from 'react-router-dom';
import { FolderOpen, Wand2, Archive, Clock } from 'lucide-react';
import { STATUS_LABELS } from '../utils/documentStatuses';

/**
 * Vue d'ensemble du module DOCUMENTS (/documents) : cartes de synthèse
 * (documents, à indexer, dossiers, espace utilisé), accès rapides aux vues de
 * travail, documents récents. Les données viennent de la page parente.
 */
const GEDOverview = ({ data, folders, loading }) => {
  const documents = data?.documents || [];
  const aIndexer = documents.filter((d) => d.statut === 'à indexer').length;
  const recents = documents.slice(0, 6);

  const formatTaille = (octets) => {
    if (!octets) return '0 o';
    if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(0)} Ko`;
    return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
  };

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 md:py-8">
      <div className="max-w-6xl mx-auto animate-fade-in-up">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="stat-card animate-fade-in-up">
            <div className="min-w-0">
              <p className="stat-card-label">Documents</p>
              <p className="stat-card-value">{data?.pagination?.total ?? '—'}</p>
            </div>
            <div className="stat-card-icon" style={{ background: 'var(--df-accent-bg)', color: 'var(--df-accent)' }}><FolderOpen size={18} /></div>
          </div>
          <div className="stat-card animate-fade-in-up" style={{ animationDelay: '60ms' }}>
            <div className="min-w-0">
              <p className="stat-card-label">À indexer</p>
              <p className="stat-card-value">{aIndexer}</p>
            </div>
            <div className="stat-card-icon" style={{ background: 'var(--df-warn-bg)', color: 'var(--df-warn)' }}><Wand2 size={18} /></div>
          </div>
          <div className="stat-card animate-fade-in-up" style={{ animationDelay: '120ms' }}>
            <div className="min-w-0">
              <p className="stat-card-label">Dossiers</p>
              <p className="stat-card-value">{folders?.length ?? '—'}</p>
            </div>
            <div className="stat-card-icon" style={{ background: 'var(--df-info-bg)', color: 'var(--df-info)' }}><Archive size={18} /></div>
          </div>
          <div className="stat-card animate-fade-in-up" style={{ animationDelay: '180ms' }}>
            <div className="min-w-0">
              <p className="stat-card-label">Espace utilisé</p>
              <p className="stat-card-value">{data?.storage_used != null ? formatTaille(data.storage_used) : '—'}</p>
            </div>
            <div className="stat-card-icon" style={{ background: 'var(--df-ok-bg)', color: 'var(--df-ok)' }}><Archive size={18} /></div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          <Link to="/documents/a-indexer" className="glass-card-premium p-5 hover:shadow-elevated transition-all flex items-center gap-4 group">
            <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-110 transition-transform"><Wand2 size={20} /></div>
            <div>
              <div className="font-bold text-slate-900">File d&apos;indexation</div>
              <div className="text-xs text-slate-500">{aIndexer} document(s) attendent leurs métadonnées</div>
            </div>
          </Link>
          <Link to="/documents/liste" className="glass-card-premium p-5 hover:shadow-elevated transition-all flex items-center gap-4 group">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform"><FolderOpen size={20} /></div>
            <div>
              <div className="font-bold text-slate-900">Tous les documents</div>
              <div className="text-xs text-slate-500">Recherche, filtres, arborescence, vues dynamiques</div>
            </div>
          </Link>
          <Link to="/documents/archives" className="glass-card-premium p-5 hover:shadow-elevated transition-all flex items-center gap-4 group">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform"><Archive size={20} /></div>
            <div>
              <div className="font-bold text-slate-900">Archives</div>
              <div className="text-xs text-slate-500">Les documents archivés du référentiel</div>
            </div>
          </Link>
        </div>

        <div className="glass-card-premium p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900 flex items-center gap-2"><Clock size={16} className="text-docuflow-secondary" /> Ajoutés récemment</h3>
            <Link to="/documents/liste" className="text-xs font-bold text-docuflow-secondary hover:underline">Tout voir</Link>
          </div>
          {loading ? (
            <div className="py-6 text-center text-slate-400"><div className="w-6 h-6 border-2 border-slate-200 border-t-docuflow-secondary rounded-full animate-spin mx-auto" /></div>
          ) : recents.length ? (
            <div className="space-y-2">
              {recents.map((d) => (
                <div key={d.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 truncate">{d.reference_mfile}</div>
                    <div className="text-[11px] text-slate-400 truncate">{d.nom_entreprise}{d.type_document && ` · ${d.type_document}`}</div>
                  </div>
                  <span className={`status-badge ${d.statut === 'à indexer' ? 'status-badge-pending' : d.statut === 'archivé' ? 'status-badge-done' : 'status-badge-ok'}`}>
                    {STATUS_LABELS[d.statut] || d.statut}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-3 text-center">Aucun document — versez vos premiers fichiers depuis la liste.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default GEDOverview;
