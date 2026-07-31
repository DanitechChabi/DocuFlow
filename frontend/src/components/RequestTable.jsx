import React, { useState } from 'react';
import { FileText, Clock, Hash, ChevronRight, AlertCircle, Filter } from 'lucide-react';

const statusConfig = {
  'en attente': { label: 'En attente', cls: 'status-badge-pending' },
  'transmis': { label: 'Transmis', cls: 'status-badge-transmitted' },
  'livré': { label: 'Livré', cls: 'status-badge-delivered' },
  'a traiter': { label: 'À traiter', cls: 'status-badge-progress' },
  'rejete': { label: 'Rejeté', cls: 'status-badge-rejected' },
};

const FILTERS = [
  { key: 'all', label: 'Toutes' },
  { key: 'en attente', label: 'En attente' },
  { key: 'a traiter', label: 'À traiter' },
  { key: 'transmis', label: 'Transmis' },
  { key: 'livré', label: 'Livré' },
  { key: 'rejete', label: 'Rejeté' },
];

const RequestTable = ({ requests, role, onRefresh, onOpenDetails }) => {
  const [filter, setFilter] = useState('all');

  const filteredRequests = filter === 'all'
    ? requests
    : requests.filter(r => r.statut === filter);

  const counts = {};
  requests.forEach(r => {
    counts[r.statut] = (counts[r.statut] || 0) + 1;
  });

  return (
    <div>
      {/* Filter bar */}
      <div className="px-4 md:px-6 pt-4 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2 overflow-x-auto -mx-2 px-2 pb-2 scrollbar-none">
          <Filter size={14} className="text-slate-400 flex-shrink-0" />
          {FILTERS.map((f) => {
            const count = f.key === 'all' ? requests.length : (counts[f.key] || 0);
            const isActive = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 ${
                  isActive
                    ? 'bg-afgc-primary text-white shadow-md shadow-slate-200'
                    : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700 hover:shadow-sm'
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[600px] md:min-w-0">
          <thead className="bg-slate-50/80 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Demandeur & Entreprise</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Références</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Motif & Priorité</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Statut</th>
              <th className="px-6 py-4 text-right"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredRequests.map((req, idx) => {
              const status = statusConfig[req.statut] || { label: req.statut, cls: 'bg-slate-100 text-slate-600' };
              return (
                <tr
                  key={req.id}
                  onClick={() => onOpenDetails(req.id)}
                  className="hover:bg-slate-50/80 transition-all duration-150 cursor-pointer group animate-fade-in-up"
                  style={{ animationDelay: `${idx * 30}ms` }}
                >
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-800 text-sm">{req.nom_entreprise}</span>
                      <span className="text-xs text-slate-400 mt-0.5">
                        <Clock size={11} className="inline mr-1" />
                        {req.created_at ? new Date(req.created_at).toLocaleDateString('fr-FR') : 'N/A'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col space-y-0.5">
                      <span className="text-sm font-medium text-slate-700">
                        <Hash size={12} className="inline mr-1 text-slate-400" />
                        {req.num_dossier}
                      </span>
                      <span className="text-xs text-slate-400">{req.num_acte} · {req.annee}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col space-y-0.5">
                      <span className="text-sm font-medium text-slate-700">{req.motif}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${
                        req.priorite === 'urgente' ? 'text-red-500' :
                        req.priorite === 'haute' ? 'text-orange-500' :
                        req.priorite === 'normale' ? 'text-blue-500' :
                        'text-slate-400'
                      }`}>{req.priorite}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`status-badge ${status.cls}`}>
                      {status.label}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-afgc-secondary opacity-0 group-hover:opacity-100 transition-all duration-200">
                      Détails <ChevronRight size={14} />
                    </span>
                  </td>
                </tr>
              );
            })}
            {filteredRequests.length === 0 && (
              <tr>
                <td colSpan={5} className="p-12 text-center">
                  <FileText size={40} className="mx-auto mb-3 text-slate-200" />
                  <p className="text-slate-400 font-medium text-sm">Aucune demande trouvée</p>
                  <p className="text-xs text-slate-300">
                    {filter !== 'all'
                      ? `Aucune demande avec le statut « ${filter} »`
                      : 'Les nouvelles demandes apparaîtront ici'}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RequestTable;
