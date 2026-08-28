import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, FileSearch, ClipboardList, PlusCircle, FolderOpen, Wand2, Archive,
  ArrowRight, Activity, Clock,
} from 'lucide-react';
import { requestService } from '../services/requestService';
import { documentService } from '../services/documentService';
import { notificationService } from '../services/notificationService';
import { authService } from '../services/authService';
import { usePermissions } from '../hooks/usePermissions';
import PageHeader from '../components/PageHeader';

// ============================================================================
// HomePage — le vestibule de la plateforme à deux modules.
//
// DEMANDES et DOCUMENTS sont deux mondes SÉPARÉS : l'accueil ne les mélange
// jamais sur un même écran. Il propose les deux PORTES — chacune n'apparaît
// que si l'utilisateur peut y entrer — avec un indicateur de travail en cours
// (à traiter / à indexer) : assez pour décider où aller, pas assez pour
// transformer l'accueil en un troisième module hybride. On ENTRE ensuite dans
// le module choisi, qui vit sa vie de son côté.
// ============================================================================

const HomePage = () => {
  const { can } = usePermissions();
  const user = authService.getCurrentUser();

  const [aTraiter, setATraiter] = useState(null);
  const [aIndexer, setAIndexer] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async () => {
    const taches = [];
    // Indicateurs seulement — le contenu vit dans chaque module.
    if (can('requests.process')) {
      taches.push(
        requestService.getStats()
          .then((s) => setATraiter((s?.['a traiter'] || 0) + (s?.['en attente'] || 0)))
          .catch(() => {})
      );
    }
    if (can('documents.view')) {
      taches.push(
        documentService.getDocuments({ page_size: 20 })
          .then((d) => setAIndexer((d?.documents || []).filter((x) => x.statut === 'à indexer').length))
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

  const voitDemandes = can('requests.view');
  const voitDocuments = can('documents.view');

  return (
    <div className="relative p-4 md:p-8 max-w-7xl mx-auto">
      <div className="fixed top-0 right-0 w-1/3 h-1/3 bg-blue-500/[0.03] rounded-full blur-3xl pointer-events-none"></div>

      <PageHeader
        title={`Bonjour, ${(user?.full_name || '').split(' ')[0] || 'bienvenue'}`}
        subtitle="Où voulez-vous travailler ?"
        icon={LayoutDashboard}
        breadcrumb={[{ label: 'Accueil' }]}
        documentTitle="Accueil"
      />

      {/* Les deux portes — chacune n'existe que si l'utilisateur peut y entrer */}
      <div className={`grid gap-6 mt-8 ${voitDemandes && voitDocuments ? 'lg:grid-cols-2' : 'max-w-xl'}`}>
        {/* ---- MODULE DEMANDES ---- */}
        {voitDemandes && (
          <Link
            to="/demandes"
            className="glass-card-premium p-8 hover:shadow-elevated transition-all group relative overflow-hidden animate-fade-in-up"
          >
            <div className="absolute top-0 right-0 w-40 h-40 bg-blue-500/[0.06] rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none group-hover:bg-blue-500/[0.12] transition-colors" />
            <div className="flex items-start justify-between mb-6">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <FileSearch size={26} />
              </div>
              <span className="flex items-center gap-1 text-xs font-bold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                Entrer <ArrowRight size={13} />
              </span>
            </div>
            <h2 className="text-2xl font-black text-slate-900 mb-1.5">Demandes</h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-6">
              Déposer, traiter et suivre les demandes de l'organisation — de l'attente à la livraison.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {aTraiter !== null && aTraiter > 0 && can('requests.process') && (
                <span className="px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 text-xs font-bold flex items-center gap-1.5">
                  <ClipboardList size={13} /> {aTraiter} à traiter
                </span>
              )}
              {can('requests.create') && (
                <span className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center gap-1.5">
                  <PlusCircle size={13} /> Nouvelle demande
                </span>
              )}
            </div>
          </Link>
        )}

        {/* ---- MODULE DOCUMENTS ---- */}
        {voitDocuments && (
          <Link
            to="/documents"
            className="glass-card-premium p-8 hover:shadow-elevated transition-all group relative overflow-hidden animate-fade-in-up delay-75"
          >
            <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/[0.06] rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none group-hover:bg-emerald-500/[0.12] transition-colors" />
            <div className="flex items-start justify-between mb-6">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <FolderOpen size={26} />
              </div>
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                Entrer <ArrowRight size={13} />
              </span>
            </div>
            <h2 className="text-2xl font-black text-slate-900 mb-1.5">Documents</h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-6">
              Le référentiel documentaire : classement, métadonnées, versions, indexation et archivage.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {aIndexer !== null && aIndexer > 0 && can('documents.index') && (
                <span className="px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 text-xs font-bold flex items-center gap-1.5">
                  <Wand2 size={13} /> {aIndexer} à indexer
                </span>
              )}
              <span className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center gap-1.5">
                <Archive size={13} /> Référentiel
              </span>
            </div>
          </Link>
        )}
      </div>

      {/* Activité récente — un fil d'annonces, pas un module : chaque ligne
          renvoie VERS son module, elle n'en remplace pas le contenu. */}
      <div className="glass-card-premium p-6 mt-8 animate-fade-in-up delay-150">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-900 flex items-center gap-2"><Activity size={16} className="text-docuflow-secondary" /> Activité récente</h3>
        </div>
        {chargement ? (
          <div className="py-4 text-center text-slate-400"><div className="w-6 h-6 border-2 border-slate-200 border-t-docuflow-secondary rounded-full animate-spin mx-auto" /></div>
        ) : notifications.length ? (
          <div className="space-y-1">
            {notifications.map((n) => (
              <div key={n.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${n.type === 'request_status' ? 'bg-blue-50 text-blue-500' : 'bg-slate-100 text-slate-400'}`}>
                  <Clock size={14} />
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
  );
};

export default HomePage;
