import React, { useState } from 'react';
import { libelleDemande, aDesReferences, ETATS_PRET } from '../utils/demande';
import { usePermissions } from '../hooks/usePermissions';
import { FileText, Clock, Hash, ChevronRight, Filter } from 'lucide-react';

const statusConfig = {
  'en attente': { label: 'En attente', cls: 'status-badge-pending' },
  'transmis': { label: 'Transmis', cls: 'status-badge-transmitted' },
  'livré': { label: 'Livré', cls: 'status-badge-delivered' },
  'a traiter': { label: 'À traiter', cls: 'status-badge-progress' },
  'rejete': { label: 'Rejeté', cls: 'status-badge-rejected' },
  'annulé': { label: 'Annulé', cls: 'status-badge-annulled' },
};

const FILTERS = [
  { key: 'all', label: 'Toutes' },
  { key: 'en attente', label: 'En attente' },
  { key: 'a traiter', label: 'À traiter' },
  { key: 'transmis', label: 'Transmis' },
  { key: 'livré', label: 'Livré' },
  { key: 'rejete', label: 'Rejeté' },
  { key: 'annulé', label: 'Annulé' },
];

// Lignes d'attente pendant le chargement — évite le message « Aucune demande
// trouvée » qui s'affichait avant les données (le tableau démarre vide avant
// le premier fetch), un faux négatif trompeur à l'arrivée sur la page.
const SkeletonRows = ({ count = 5 }) => (
  <>
    {Array.from({ length: count }).map((_, idx) => (
      <tr key={idx}>
        <td className="px-6 py-4"><div className="skeleton h-4 w-32 mb-2" /><div className="skeleton h-3 w-20" /></td>
        <td className="px-6 py-4"><div className="skeleton h-4 w-24 mb-2" /><div className="skeleton h-3 w-16" /></td>
        <td className="px-6 py-4"><div className="skeleton h-4 w-28 mb-2" /><div className="skeleton h-3 w-14" /></td>
        <td className="px-6 py-4"><div className="skeleton h-5 w-20 rounded-full" /></td>
        <td className="px-6 py-4"><div className="skeleton h-4 w-20" /></td>
        <td className="px-6 py-4 text-right"><div className="skeleton h-4 w-14 ml-auto" /></td>
      </tr>
    ))}
  </>
);

/**
 * @param {Function} [onNouvelle] si fourni, l'état vide invite à demander un
 *        document (liste « Mes demandes » d'un utilisateur qui peut demander).
 */
const RequestTable = ({ requests, onOpenDetails, search = '', loading = false, onNouvelle }) => {
  // Badge « Dans la GED » (migration 027) : réservé à qui consulte la GED —
  // le score est calculé sur tous les documents, dossiers restreints compris.
  const { can } = usePermissions();
  const voitGed = can('documents.view');
  const [filter, setFilter] = useState('all');

  const searchTerm = String(search || '').trim().toLowerCase();

  const filteredRequests = requests.filter(r => {
    const matchStatus = filter === 'all' || r.statut === filter;
    if (!searchTerm) return matchStatus;
    // Recherche sur entreprise, références, motif, type, statut, demandeur, priorité
    const haystack = [
      r.nom_entreprise, r.description, r.beneficiaire, r.num_dossier, r.num_acte, String(r.annee || ''),
      r.type_document, r.motif, r.statut, r.requester_name, r.priorite,
    ].filter(Boolean).join(' ').toLowerCase();
    return matchStatus && haystack.includes(searchTerm);
  });

  const counts = {};
  requests.forEach(r => {
    counts[r.statut] = (counts[r.statut] || 0) + 1;
  });

  return (
    <div>
      {/* Barre de recherche + filtres */}
      <div className="px-4 md:px-6 pt-2 pb-2 border-b border-slate-100">
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
                    ? 'bg-docuflow-primary text-white shadow-md shadow-slate-200'
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
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Assigné à</th>
              <th className="px-6 py-4 text-right"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? <SkeletonRows /> : filteredRequests.map((req, idx) => {
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
                      <span className="font-bold text-slate-800 text-sm max-w-xs truncate" title={req.description || undefined}>{libelleDemande(req)}</span>
                      <span className="text-xs text-slate-400 mt-0.5">
                        <Clock size={11} className="inline mr-1" />
                        {req.created_at ? new Date(req.created_at).toLocaleDateString('fr-FR') : 'N/A'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col space-y-0.5">
                      {aDesReferences(req) ? (
                        <>
                          <span className="text-sm font-medium text-slate-700">
                            <Hash size={12} className="inline mr-1 text-slate-400" />
                            {req.num_dossier || '—'}
                          </span>
                          <span className="text-xs text-slate-400">{req.num_acte || '—'} · {req.annee || '—'}</span>
                        </>
                      ) : (
                        <span className="text-xs italic text-slate-400">Sans référence</span>
                      )}
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
                    {voitGed && req.ged_score >= 60 && !['livré', 'rejete', 'annulé'].includes(req.statut) && (
                      <span className="ml-1.5 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200"
                        title="Un document correspondant semble déjà numérisé : ouvrez la demande pour le transmettre.">
                        Dans la GED
                      </span>
                    )}
                    {/* Dossier physique prêté (migration 025) */}
                    {ETATS_PRET[req.loan_etat] && (
                      <span className={`ml-1.5 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${ETATS_PRET[req.loan_etat].classe}`}>
                        {ETATS_PRET[req.loan_etat].libelle}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-600">
                      {req.assignee_name || <span className="text-slate-300">—</span>}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-docuflow-secondary opacity-0 group-hover:opacity-100 transition-all duration-200">
                      Détails <ChevronRight size={14} />
                    </span>
                  </td>
                </tr>
              );
            })}
            {!loading && filteredRequests.length === 0 && (
              <tr>
                <td colSpan={6} className="p-12 text-center">
                  <FileText size={40} className="mx-auto mb-3 text-slate-200" />
                  <p className="text-slate-400 font-medium text-sm">Aucune demande trouvée</p>
                  <p className="text-xs text-slate-300">
                    {searchTerm
                      ? `Aucune demande ne correspond à « ${search.trim()} »`
                      : filter !== 'all'
                        ? `Aucune demande avec le statut « ${filter} »`
                        : onNouvelle
                          ? 'Besoin d\'un document ou d\'un dossier ? Une phrase suffit pour le demander.'
                          : 'Les nouvelles demandes apparaîtront ici'}
                  </p>
                  {onNouvelle && !searchTerm && filter === 'all' && (
                    <button onClick={onNouvelle} className="btn btn-primary mt-4 inline-flex">
                      <FileText size={16} /> Demander un document
                    </button>
                  )}
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
