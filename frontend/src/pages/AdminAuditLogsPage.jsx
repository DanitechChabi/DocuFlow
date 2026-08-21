import React, { useState, useEffect, useCallback } from 'react';
import { auditService } from '../services/auditService';
import {
  Search, ShieldAlert, Clock, FileText,
  Activity, RefreshCcw, AlertCircle
} from 'lucide-react';
import { toast } from '../components/Toast';
import PageHeader from '../components/PageHeader';

/**
 * AdminAuditLogsPage — Vue en lecture seule du journal d'audit (Append-Only).
 * Cette page permet aux administrateurs de suivre toutes les actions significatives
 * effectuées au sein de leur organisation.
 */
const AdminAuditLogsPage = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await auditService.getAuditLogs();
      // La route peut renvoyer un tableau ou un objet paginé selon le chemin :
      // normaliser évite un `.filter is not a function` qui viderait la page.
      setLogs(Array.isArray(data) ? data : (data?.logs || []));
    } catch (err) {
      console.error('Error fetching audit logs:', err);
      toast.error(err.response?.data?.message || 'Erreur lors de la récupération des logs d\'audit');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Filtering
  const filteredLogs = logs.filter((log) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (
      (log.actor_name || '').toLowerCase().includes(s) ||
      (log.action || '').toLowerCase().includes(s) ||
      (log.details || JSON.stringify(log.details) || '').toLowerCase().includes(s)
    );
  });

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Action badge colors — `action` peut être nul sur d'anciennes lignes ; sans ce
  // garde-fou, `.includes` lèverait une TypeError qui ferait écran blanc sur toute
  // la page au lieu de dégrader une seule cellule.
  const getActionColor = (action) => {
    const a = (action || '').toLowerCase();
    if (a.includes('create') || a.includes('upload')) return 'bg-green-100 text-green-600';
    if (a.includes('update') || a.includes('modify')) return 'bg-blue-100 text-blue-600';
    if (a.includes('delete') || a.includes('remove')) return 'bg-red-100 text-red-600';
    if (a.includes('view') || a.includes('download')) return 'bg-slate-100 text-slate-600';
    return 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Journal d'audit"
          subtitle="Tracé immuable des actions menées dans l'organisation"
          icon={ShieldAlert}
          breadcrumb={[
            { label: 'Tableau de bord', to: '/dashboard' },
            { label: "Journal d'audit" },
          ]}
          actions={
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="btn btn-secondary"
            >
              <RefreshCcw size={15} className={loading ? 'animate-spin' : undefined} /> Actualiser
            </button>
          }
        />

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 sm:max-w-md">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-premium pl-10"
              placeholder="Rechercher un utilisateur, une action ou un détail…"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-medium bg-white px-3 py-2 rounded-xl border border-slate-100">
            <Activity size={14} />
            <span>{filteredLogs.length} entrée{filteredLogs.length > 1 ? 's' : ''} trouvée{filteredLogs.length > 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Logs Table */}
        {loading ? (
          <div className="grid gap-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-20 rounded-2xl skeleton" />)}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-50 flex items-center justify-center">
              <AlertCircle size={26} className="text-slate-300" />
            </div>
            <h3 className="text-base font-black text-slate-800 mb-1">Aucun log trouvé</h3>
            <p className="text-sm text-slate-400 max-w-sm mx-auto mb-5">
              Il n'y a aucun enregistrement d'audit correspondant à vos critères de recherche.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-400">
                    <th className="px-6 py-4 font-bold">Date & Heure</th>
                    <th className="px-6 py-4 font-bold">Utilisateur</th>
                    <th className="px-6 py-4 font-bold">Action</th>
                    <th className="px-6 py-4 font-bold">Détails</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredLogs.map((log, idx) => (
                    <tr key={log.id || idx} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 text-slate-500">
                          <Clock size={14} className="text-slate-300" />
                          <span className="text-xs font-medium">{formatDate(log.occurred_at)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-black flex-shrink-0">
                            {(log.actor_name || 'U').charAt(0).toUpperCase()}
                          </div>
                          <span className="font-bold text-slate-700 text-xs">{log.actor_name || 'Système'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${getActionColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-start gap-2">
                          <FileText size={14} className="text-slate-300 mt-0.5 flex-shrink-0" />
                          <span className="text-xs text-slate-600 leading-relaxed">
                            {typeof log.details === 'object'
                              ? JSON.stringify(log.details)
                              : (log.details || 'Aucun détail disponible')}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminAuditLogsPage;
