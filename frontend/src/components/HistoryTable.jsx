import React from 'react';
import { Clock, ShieldCheck, ExternalLink, History } from 'lucide-react';

const HistoryTable = ({ logs, onRequestClick }) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse min-w-[500px] md:min-w-0">
        <thead className="bg-slate-50/80 border-b border-slate-100">
          <tr>
            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Utilisateur</th>
            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Action</th>
            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date & Heure</th>
            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Sécurité</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {logs.map((log, idx) => (
            <tr key={log.id} className="hover:bg-slate-50/80 transition-all duration-150 animate-fade-in-up group" style={{ animationDelay: `${idx * 30}ms` }}>
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-afgc-secondary to-blue-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">
                    {log.user_name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <span className="font-medium text-slate-700 text-sm">{log.user_name}</span>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">{log.action}</span>
                  {log.request_id && (
                    <button
                      onClick={() => onRequestClick(log.request_id)}
                      className="p-1.5 bg-afgc-primary/5 text-afgc-primary rounded-lg hover:bg-afgc-primary/10 transition-all opacity-0 group-hover:opacity-100"
                      title="Voir la demande"
                    >
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-1.5 text-sm text-slate-500">
                  <Clock size={14} className="text-slate-400" />
                  {log.timestamp ? new Date(log.timestamp).toLocaleString('fr-FR') : 'N/A'}
                </div>
              </td>
              <td className="px-6 py-4 text-right">
                {log.ip_address ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 rounded-lg text-[10px] font-mono text-slate-500">
                    <ShieldCheck size={11} /> {log.ip_address}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-300 italic">Non tracé</span>
                )}
              </td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={4} className="p-12 text-center">
                <History size={40} className="mx-auto mb-3 text-slate-200" />
                <p className="text-slate-400 font-medium text-sm">Aucun historique d'activité</p>
                <p className="text-xs text-slate-300">Les actions des utilisateurs apparaîtront ici</p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default HistoryTable;
