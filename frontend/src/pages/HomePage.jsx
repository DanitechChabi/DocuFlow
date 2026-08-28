import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, FileSearch, ClipboardList, Clock, CheckCircle2, XCircle,
  FolderOpen, Wand2, Archive, ArrowRight, Activity, PlusCircle,
} from 'lucide-react';
import { requestService } from '../services/requestService';
import { documentService } from '../services/documentService';
import { notificationService } from '../services/notificationService';
import { authService } from '../services/authService';
import { usePermissions } from '../hooks/usePermissions';
import PageHeader from '../components/PageHeader';
import { STATUS_LABELS } from '../utils/documentStatuses';

// ============================================================================
// HomePage — accueil global de la plateforme.
//
// La vision synthétique des DEUX modules : demandes en cours et à traiter,
// documents récents et en attente d'indexation, activité, notifications.
// Chaque bloc n'apparaît que si l'utilisateur détient la permission de sa
// destination — l'accueil d'un demandeur (demandes seules) n'est pas celui
// d'un archiviste (GED au premier plan).
//
// Les compteurs viennent des endpoints existants (stats demandes, liste
// documents) : aucune route nouvelle, aucun double comptage.
// ============================================================================

const formatTaille = (octets) => {
  if (!octets) return '0 o';
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(0)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
};

const HomePage = () => {
  const { can } = usePermissions();
  const user = authService.getCurrentUser();

  const [statsDemandes, setStatsDemandes] = useState(null);
  const [mesDemandes, setMesDemandes] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [espaceUtilise, setEspaceUtilise] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async () => {
    const taches = [];
    // Chaque source est indépendante : l'échec d'une section (permission
    // manquante → 403, réseau) ne doit pas vider l'accueil entier.
    if (can('requests.process')) taches.push(
      requestService.getStats().then(setStatsDemandes).catch(() => {})
    );
    if (can('requests.view')) taches.push(
      requestService.getMyRequests().then((r) => setMesDemandes(Array.isArray(r) ? r.slice(0, 5) : [])).catch(() => {})
    );
    if (can('documents.view')) {
      taches.push(
        documentService.getDocuments({ page_size: 6 })
          .then((d) => setDocuments(d?.documents || []))
          .catch(() => {})
      );
      // L'espace utilisé : la somme des tailles de fichiers est servie avec la
      // liste (document_files.file_size) — aucune route dédiée à maintenir.
      taches.push(
        documentService.getDocuments({ page_size: 1 })
          .then((d) => setEspaceUtilise(d?.storage_used ?? null))
          .catch(() => {})
      );
    }
    taches.push(
      notificationService.getNotifications().then((n) => setNotifications(Array.isArray(n) ? n.slice(0, 4) : [])).catch(() => {})
    );
    await Promise.all(taches);
    setChargement(false);
  }, [can]);

  useEffect(() => { charger(); }, [charger]);

  const enCours = (statsDemandes?.['en attente'] || 0) + (statsDemandes?.['a traiter'] || 0) + (statsDemandes?.['transmis'] || 0);
  const aTraiter = statsDemandes?.['a traiter'] || 0;
  const livrees = statsDemandes?.['livré'] || 0;
  const rejetees = statsDemandes?.['rejete'] || 0;

  const aIndexer = documents.filter((d) => d.statut === 'à indexer').length;
  const archives = documents.filter((d) => d.statut === 'archivé').length;

  // Carte statistique — visible seulement si la permission existe.
  const carte = (label, valeur, icone, ton, lien, permission) => {
    if (!can(permission)) return null;
    return (
      <Link
        to={lien}
        className="glass-card-premium p-5 hover:shadow-elevated transition-all group"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
            <div className={`text-3xl font-black mt-1 ${ton}`}>{valeur}</div>
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${ton === 'text-blue-600' ? 'bg-blue-50' : ton === 'text-amber-600' ? 'bg-amber-50' : ton === 'text-emerald-600' ? 'bg-emerald-50' : 'bg-red-50'} group-hover:scale-110 transition-transform`}>
            {icone}
          </div>
        </div>
      </Link>
    );
  };

  return (
    <div className="relative p-4 md:p-8 max-w-7xl mx-auto">
      <div className="fixed top-0 right-0 w-1/3 h-1/3 bg-blue-500/[0.03] rounded-full blur-3xl pointer-events-none"></div>

      <PageHeader
        title={`Bonjour, ${(user?.full_name || '').split(' ')[0] || 'bienvenue'}`}
        subtitle="Vue d'ensemble de votre activité documentaire et de vos demandes"
        icon={LayoutDashboard}
        breadcrumb={[{ label: 'Accueil' }]}
        documentTitle="Accueil"
      />

      {chargement ? (
        <div className="py-20 text-center text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-docuflow-secondary rounded-full animate-spin mx-auto mb-3" />
          Chargement de votre activité…
        </div>
      ) : (
        <div className="space-y-8 mt-6">
          {/* Cartes synthèse */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {carte('Demandes en cours', enCours, <FileSearch size={18} />, 'text-blue-600', '/demandes', 'requests.view')}
            {carte('À traiter', aTraiter, <ClipboardList size={18} />, 'text-amber-600', '/demandes/a-traiter', 'requests.process')}
            {carte('À indexer', aIndexer, <Wand2 size={18} />, 'text-amber-600', '/documents/a-indexer', 'documents.index')}
            {carte('Documents récents', documents.length, <FolderOpen size={18} />, 'text-emerald-600', '/documents/liste', 'documents.view')}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Mes demandes récentes */}
            {can('requests.view') && (
              <div className="glass-card-premium p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2"><FileSearch size={16} className="text-docuflow-secondary" /> Mes demandes récentes</h3>
                  <Link to="/demandes/mes-demandes" className="text-xs font-bold text-docuflow-secondary hover:underline flex items-center gap-1">
                    Tout voir <ArrowRight size={12} />
                  </Link>
                </div>
                {mesDemandes.length ? (
                  <div className="space-y-2">
                    {mesDemandes.map((r) => (
                      <Link
                        key={r.id}
                        to="/demandes/mes-demandes"
                        className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-800 truncate">
                            {r.type_document || 'Demande'} — {r.nom_entreprise}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {r.num_dossier && `Dossier ${r.num_dossier}`}
                            {r.created_at && ` · ${new Date(r.created_at).toLocaleDateString('fr-FR')}`}
                          </div>
                        </div>
                        <span className={`status-badge ${r.statut === 'livré' ? 'status-badge-done' : r.statut === 'rejete' ? 'status-badge-danger' : 'status-badge-pending'}`}>
                          {r.statut}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center">
                    <p className="text-sm text-slate-400 mb-3">Aucune demande pour le moment.</p>
                    {can('requests.create') && (
                      <Link to="/demandes/nouvelle" className="btn-primary inline-flex items-center gap-2 !py-2 !px-4 text-sm">
                        <PlusCircle size={15} /> Déposer une demande
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Documents récents */}
            {can('documents.view') && (
              <div className="glass-card-premium p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2"><FolderOpen size={16} className="text-docuflow-secondary" /> Documents récents</h3>
                  <Link to="/documents/liste" className="text-xs font-bold text-docuflow-secondary hover:underline flex items-center gap-1">
                    Tout voir <ArrowRight size={12} />
                  </Link>
                </div>
                {documents.length ? (
                  <div className="space-y-2">
                    {documents.slice(0, 5).map((d) => (
                      <Link
                        key={d.id}
                        to={`/documents/liste?doc=${d.id}`}
                        className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-800 truncate">{d.reference_mfile}</div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {d.nom_entreprise}{d.type_document && ` · ${d.type_document}`}
                          </div>
                        </div>
                        <span className={`status-badge ${d.statut === 'à indexer' ? 'status-badge-pending' : d.statut === 'archivé' ? 'status-badge-done' : 'status-badge-ok'}`}>
                          {STATUS_LABELS[d.statut] || d.statut}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-sm text-slate-400">
                    Aucun document dans le référentiel.
                  </div>
                )}
                {espaceUtilise != null && (
                  <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 text-[11px] text-slate-400">
                    <Archive size={12} />
                    Espace documentaire utilisé : <strong className="text-slate-600">{formatTaille(espaceUtilise)}</strong>
                    {archives > 0 && <> · {archives} archivé(s)</>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Activité récente — notifications */}
          <div className="glass-card-premium p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 flex items-center gap-2"><Activity size={16} className="text-docuflow-secondary" /> Activité récente</h3>
            </div>
            {notifications.length ? (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <div key={n.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${n.type === 'request_status' ? 'bg-blue-50 text-blue-500' : 'bg-slate-100 text-slate-400'}`}>
                      {n.type === 'request_status' ? <Clock size={14} /> : <CheckCircle2 size={14} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-800 truncate">{n.titre || n.title}</div>
                      <div className="text-xs text-slate-400 line-clamp-1">{n.message}</div>
                    </div>
                    <span className="text-[10px] text-slate-300 flex-shrink-0">
                      {n.created_at && new Date(n.created_at).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 py-3 text-center">Aucune activité récente.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage;
