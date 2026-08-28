import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Plus, FolderOpen, FileText, Building2, Calendar,
  FolderPlus, ChevronLeft, ChevronRight, AlertCircle, Layers,
  FolderTree as FolderTreeIcon, List, LayoutGrid, Wand2, Trash2,
} from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { documentService } from '../services/documentService';
import { authService } from '../services/authService';
import { toast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import DocumentFormModal from '../components/DocumentFormModal';
import DocumentDetailsModal from '../components/DocumentDetailsModal';
import DocumentAssemblyModal from '../components/DocumentAssemblyModal';
import DynamicViewBuilder from '../components/DynamicViewBuilder';
import DraggableDocumentGroup from '../components/DraggableDocumentGroup';
import { DocumentPreviewLightbox } from '../components/DocumentPreview';
import FolderTree from '../components/FolderTree';
import PageHeader from '../components/PageHeader';
import GEDOverview from '../components/GEDOverview';
import { useOngletUrl } from '../hooks/useOngletUrl';
import { STATUS_CLASSES, STATUS_LABELS, STATUS_VALUES } from '../utils/documentStatuses';

// Étiquette produite par le COALESCE de getDynamicViewData pour les documents
// sans valeur. Ce n'est pas une valeur stockable : elle doit rester identique de
// part et d'autre, le backend la retraduisant en NULL à l'écriture.
const UNCLASSIFIED_GROUP = 'Non classé';

// Modes d'affichage du référentiel, dans l'ordre des boutons. Hissé hors du
// composant : useOngletUrl mémorise sur ce tableau, qu'un littéral recréé à
// chaque rendu invaliderait en permanence.
const MODES_AFFICHAGE = ['list', 'dynamic'];

const DocumentsPage = ({ vue = null, statutFiltre = null }) => {
  const user = authService.getCurrentUser();
  const isAdmin = ['superadmin', 'admin', 'archiviste'].includes(user?.role);
  const [searchParams, setSearchParams] = useSearchParams();

  // Recherche globale depuis la topbar → pré-remplir ?q=
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    statut: statutFiltre || '',
    type_document: '',
    annee: '',
    dossier_id: '',
  });
  const [folders, setFolders] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);

  const [showForm, setShowForm] = useState(false);
  // Suppression douce depuis la liste : cible en attente de confirmation.
  const [supprimerDoc, setSupprimerDoc] = useState(null);

  const confirmerSuppression = async () => {
    if (!supprimerDoc) return;
    try {
      await documentService.deleteDocument(supprimerDoc.id);
      toast.success(`« ${supprimerDoc.reference_mfile} » mis à la corbeille — restaurable depuis Documents › Corbeille.`);
      setSupprimerDoc(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Suppression impossible.');
      setSupprimerDoc(null);
    }
  };
  // Le mode d'affichage vit dans l'URL (?vue=dynamic) et non dans un état local :
  // « regarde les documents groupés par type » se transmet alors par un lien, et
  // F5 ne renvoie plus l'archiviste à la liste plate qu'il venait de quitter.
  const [viewMode, setViewMode] = useOngletUrl(MODES_AFFICHAGE, 'vue');
  const [groupByField, setGroupByField] = useState('type_document');
  const [dynamicGroups, setDynamicGroups] = useState([]);
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const [dynamicError, setDynamicError] = useState('');
  const [showAssembly, setShowAssembly] = useState(false);
  const [showViewBuilder, setShowViewBuilder] = useState(false);
  const [savedViews, setSavedViews] = useState([]);
  // Vue enregistrée en cours de lecture (null = regroupement ad hoc). En mode
  // vue enregistrée, c'est le backend qui décide du champ de regroupement.
  const [activeViewId, setActiveViewId] = useState(null);
  const [activeGroupField, setActiveGroupField] = useState('type_document');
  const [pendingDropGroup, setPendingDropGroup] = useState(null);
  // Aperçu plein écran : l'état vit ici et non dans la fiche, pour qu'une seule
  // vue soit ouverte à la fois. Portée par chaque carte, une centaine de fiches
  // porteraient une centaine d'états morts.
  const [apercuDoc, setApercuDoc] = useState(null);

  // 6 px avant de considérer qu'il s'agit d'un glissement : sans cette
  // contrainte, le clic d'ouverture d'une fiche document déclenchait un drag et
  // le détail ne s'ouvrait plus.
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const loadDynamicView = useCallback(async () => {
    setDynamicLoading(true);
    setDynamicError('');
    try {
      const res = await documentService.getDynamicViewData(groupByField, activeViewId);
      setDynamicGroups(res.groups);
      // Le champ réellement appliqué vient de la réponse : pour une vue
      // enregistrée, il est porté par la vue et non par l'état local.
      setActiveGroupField(res.group_by_field);
    } catch (err) {
      // Une erreur avalée ici produisait exactement le symptôme signalé : la vue
      // dynamique n'affichait rien, sans le moindre message.
      setDynamicGroups([]);
      setDynamicError(err?.response?.data?.message || 'Impossible de calculer la vue dynamique.');
    } finally {
      setDynamicLoading(false);
    }
  }, [groupByField, activeViewId]);

  const loadSavedViews = useCallback(async () => {
    try {
      setSavedViews(await documentService.getDynamicViews());
    } catch { /* silencieux : une vue enregistrée absente ne bloque pas la page */ }
  }, []);

  useEffect(() => {
    if (viewMode === 'dynamic') { loadDynamicView(); loadSavedViews(); }
  }, [viewMode, loadDynamicView, loadSavedViews]);

  /**
   * Dépôt d'un document dans un autre groupe : écrit la métadonnée de
   * regroupement. Deux chemins d'écriture selon le champ, car `updateDocument`
   * n'accepte pas `statut` (liste `allowed` de documentController) — un PATCH y
   * serait accepté puis silencieusement ignoré, ou refusé faute de champ à
   * modifier. Le statut passe donc par `setStatus`, qui journalise en plus le
   * changement dans l'historique du document.
   */
  const handleDocumentDrop = async ({ active, over }) => {
    if (!over) return; // relâché en dehors d'un groupe

    const targetGroup = over.data?.current?.groupName;
    const doc = active.data?.current?.document;
    if (!targetGroup || !doc) return;

    const currentValue = doc[activeGroupField] ?? null;
    const currentGroup = currentValue === null || currentValue === '' ? UNCLASSIFIED_GROUP : String(currentValue);
    if (currentGroup === targetGroup) return; // déjà dans ce groupe

    if (activeGroupField === 'statut') {
      if (!STATUS_VALUES.includes(targetGroup)) {
        toast.error(`« ${targetGroup} » n'est pas un statut valide`);
        return;
      }
    } else if (activeGroupField === 'annee' && targetGroup !== UNCLASSIFIED_GROUP && !Number.isFinite(Number(targetGroup))) {
      // `annee` est une colonne numérique : un groupe non numérique ne peut pas y être écrit.
      toast.error('Année invalide');
      return;
    }

    setPendingDropGroup(targetGroup);
    try {
      if (activeGroupField === 'statut') {
        await documentService.setStatus(doc.id, targetGroup, 'Reclassement par glisser-déposer');
      } else {
        // « Non classé » est retraduit en NULL par le backend : on l'envoie tel
        // quel plutôt que de dupliquer ici la règle de vidage.
        await documentService.updateDocument(doc.id, { [activeGroupField]: targetGroup });
      }
      // Rechargement plutôt que déplacement optimiste : les compteurs, l'ordre
      // des groupes (ORDER BY count DESC) et l'apparition/disparition d'un groupe
      // sont calculés par le backend. Les recalculer côté client dupliquerait
      // cette logique et divergerait au premier écart.
      await loadDynamicView();
      toast.success(`Document déplacé vers « ${targetGroup} »`);
    } catch (err) {
      const data = err.response?.data;
      toast.error(data?.message || data?.error || 'Le déplacement a échoué');
    } finally {
      setPendingDropGroup(null);
    }
  };
  const [editingDoc, setEditingDoc] = useState(null);
  const [detailDoc, setDetailDoc] = useState(null);
  const [folderOpen, setFolderOpen] = useState(false);

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

  // Suivre les changements de ?q= (nouvelle recherche depuis la barre supérieure).
  //
  // La comparaison se fait sur la VALEUR, pas sur l'objet searchParams : tout
  // changement d'un autre paramètre (?doc=, ?vue=) re-déclenche l'effet, et
  // réécraser q ramenait la saisie locale en arrière sans action de
  // l'utilisateur (le champ et les résultats « sautaient » au retour de fiche).
  // La page est RÉINITIALISÉE : rester en page 3 sur une recherche qui n'a
  // qu'une page de résultats affichait « aucun document trouvé » — compteur
  // juste, pagination masquée, aucune issue visible.
  const urlQ = searchParams.get('q') ?? '';
  useEffect(() => {
    if (urlQ !== q) {
      setQ(urlQ);
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  // Fiche ouverte depuis l'extérieur de la page : `?doc=<id>`.
  //
  // DocuBot trouve un document et doit pouvoir l'OUVRIR. Sans ce relais, son
  // résultat renvoyait au mieux vers la liste, où il fallait retrouver à la main
  // le document que le bot venait de nommer. L'identifiant passe par l'URL
  // plutôt que par un état partagé parce que la fiche vit ici, avec les dossiers
  // et les droits d'édition qu'elle utilise — et parce que l'adresse obtenue se
  // transmet alors par un lien.
  //
  // Le paramètre est retiré de l'URL à la fermeture, sinon un rechargement
  // rouvrirait indéfiniment une fiche que l'utilisateur vient de fermer.
  useEffect(() => {
    const brut = searchParams.get('doc');
    if (!brut) return;
    const id = Number(brut);
    // Un identifiant non numérique — lien tronqué, adresse bricolée — est ignoré
    // au lieu d'ouvrir un modal qui échouerait à charger.
    if (Number.isInteger(id) && id > 0) setDetailDoc(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const fermerFiche = useCallback(() => {
    setDetailDoc(null);
    setSearchParams((precedents) => {
      const suivants = new URLSearchParams(precedents);
      suivants.delete('doc');
      return suivants;
    }, { replace: true });
  }, [setSearchParams]);

  // ---- Dossiers : arborescence -------------------------------------------
  // Les quatre gestionnaires renvoient leur promesse : FolderTree ferme ses
  // formulaires en ligne seulement après succès, de sorte qu'un refus du backend
  // (cycle, profondeur, nom en doublon) laisse la saisie en place et le message
  // d'erreur visible, au lieu de tout refermer comme si l'action avait abouti.
  const handleCreateFolder = async (nom, parentId = null) => {
    setError('');
    try {
      await documentService.createFolder(nom, parentId);
      await loadFolders();
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur création dossier');
      throw err;
    }
  };

  const handleRenameFolder = async (id, nom) => {
    setError('');
    try {
      await documentService.renameFolder(id, nom);
      await loadFolders();
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur renommage dossier');
      throw err;
    }
  };

  const handleMoveFolder = async (id, parentId) => {
    setError('');
    try {
      await documentService.moveFolder(id, parentId);
      await loadFolders();
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur déplacement dossier');
      throw err;
    }
  };

  const handleDeleteFolder = async (id, recursif = false) => {
    setError('');
    try {
      const res = await documentService.deleteFolder(id, recursif);
      // Les documents ne sont pas supprimés avec leur dossier, ils sont
      // déclassés. Le taire donnerait l'impression d'une perte de données.
      if (res?.documents_declasses > 0) {
        toast.success(`Dossier supprimé — ${res.documents_declasses} document(s) déclassé(s)`);
      }
      // Le dossier supprimé peut être celui qui filtre la liste : sans cette
      // remise à zéro, la vue reste filtrée sur un dossier inexistant et
      // paraît vide.
      if (String(filters.dossier_id) === String(id)) {
        setFilters((f) => ({ ...f, dossier_id: '' }));
        setPage(1);
      }
      await Promise.all([loadFolders(), load()]);
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur suppression dossier');
      throw err;
    }
  };

  const handleFolderFilter = (v) => {
    setFilters((f) => ({ ...f, dossier_id: v == null ? '' : String(v) }));
    setPage(1);
  };

  const total = data?.pagination?.total || 0;
  const totalPages = data?.pagination?.total_pages || 1;

  // /documents sans ?vue= : la vue d'ensemble du module (cartes, accès
  // rapides, récents) — la liste détaillée reste à /documents/liste.
  if (vue === 'ensemble') {
    return <GEDOverview data={data} folders={folders} loading={loading} />;
  }

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 md:py-8">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title={statutFiltre === 'à indexer' ? 'À indexer' : statutFiltre === 'archivé' ? 'Archives' : 'Documents'}
          subtitle={statutFiltre === 'à indexer'
            ? 'Documents versés en masse qui attendent leurs métadonnées'
            : statutFiltre === 'archivé'
              ? 'Documents archivés du référentiel'
              : 'Référentiel documentaire — recherche, classement et versions'}
          icon={FolderOpen}
          breadcrumb={[
            { label: 'Accueil', to: '/' },
            { label: 'Documents', to: '/documents' },
            ...(statutFiltre ? [{ label: statutFiltre === 'à indexer' ? 'À indexer' : 'Archives' }] : []),
          ]}
          actions={
            <>
              {/* La primitive .segmented porte l'état sur aria-pressed : le mode
                  actif est ainsi annoncé aux lecteurs d'écran, alors qu'un simple
                  fond blanc ne l'était que visuellement. */}
              <div className="segmented">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-pressed={viewMode === 'list'}
                >
                  <List size={14} /> Liste
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('dynamic')}
                  aria-pressed={viewMode === 'dynamic'}
                >
                  <LayoutGrid size={14} /> Vues dynamiques
                </button>
              </div>
              {isAdmin && (
                <>
                  <button onClick={() => setShowAssembly(true)} className="btn btn-secondary">
                    <Wand2 size={15} /> Assemblage de dossier
                  </button>
                  <button onClick={() => { setEditingDoc(null); setShowForm(true); }} className="btn btn-primary">
                    <Plus size={18} /> Nouveau document
                  </button>
                </>
              )}
            </>
          }
        />

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
              {/* Dérivé du domaine partagé. La liste était écrite à la main et
                  ignorait « à indexer » : les documents versés en masse
                  n'étaient atteignables par aucun filtre, donc impossible de
                  lister le lot qu'on venait de verser pour le compléter — le
                  seul intérêt de ce statut. */}
              {Object.entries(STATUS_LABELS).map(([valeur, libelle]) => (
                <option key={valeur} value={valeur}>{libelle}</option>
              ))}
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
            {/* Le chemin complet, et non le seul nom : deux dossiers « 2025 »
                sous deux parents différents seraient indiscernables. */}
            <select className="input-premium w-auto max-w-64" value={filters.dossier_id}
              onChange={(e) => handleFolderFilter(e.target.value)}>
              <option value="">Dossier : tous</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.path || f.name}</option>
              ))}
            </select>
            <button onClick={() => setFolderOpen((v) => !v)}
              className="btn btn-secondary" aria-pressed={folderOpen} title="Gérer l'arborescence des dossiers">
              <FolderTreeIcon size={16} /> Dossiers
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
                      ? 'bg-docuflow-secondary text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {folderOpen && (
            <div className="pt-3 border-t border-slate-100">
              <FolderTree
                dossiers={folders}
                isAdmin={isAdmin}
                dossierActif={filters.dossier_id}
                onSelectionner={handleFolderFilter}
                onCreer={handleCreateFolder}
                onRenommer={handleRenameFolder}
                onDeplacer={handleMoveFolder}
                onSupprimer={handleDeleteFolder}
              />
              {/* Le comportement n'est pas devinable : sélectionner « Archives »
                  ramène aussi les documents de « Archives / 2025 ». */}
              <p className="text-[11px] text-slate-400 mt-2">
                Sélectionner un dossier affiche aussi les documents de ses sous-dossiers.
              </p>
            </div>
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

        {/* Vues dynamiques : regroupement par métadonnée */}
        {viewMode === 'dynamic' && (
          <div className="space-y-4">
            <div className="glass-card-premium p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Regrouper dynamiquement par :</span>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { key: 'type_document', label: 'Type de document' },
                    { key: 'statut', label: 'Statut' },
                    { key: 'annee', label: 'Année' },
                    { key: 'nom_entreprise', label: 'Entreprise' },
                    { key: 'auteur', label: 'Auteur' }
                  ].map(opt => (
                    <button
                      key={opt.key}
                      // Choisir un regroupement ad hoc quitte la vue enregistrée :
                      // sinon le libellé afficherait une vue dont les filtres ne
                      // s'appliquent plus au résultat montré.
                      onClick={() => { setGroupByField(opt.key); setActiveViewId(null); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${!activeViewId && groupByField === opt.key ? 'bg-docuflow-secondary text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Vues enregistrées : regroupement ET filtres rejoués par le backend */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Vues enregistrées :</span>
                <div className="flex flex-wrap items-center gap-2">
                  {savedViews.length === 0 && (
                    <span className="text-xs text-slate-400 italic">Aucune vue enregistrée</span>
                  )}
                  {savedViews.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setActiveViewId((prev) => (prev === v.id ? null : v.id))}
                      title={v.description || v.name}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeViewId === v.id ? 'bg-docuflow-secondary text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                      {v.name}
                    </button>
                  ))}
                  {isAdmin && (
                    <button onClick={() => setShowViewBuilder(true)} className="btn-secondary flex items-center gap-1.5 text-xs">
                      <Layers size={14} /> Composer une vue
                    </button>
                  )}
                </div>
              </div>
            </div>

            {dynamicLoading && <div className="py-12 text-center text-slate-400">Calcul de la vue dynamique…</div>}

            {!dynamicLoading && dynamicError && (
              <div className="glass-card-premium p-8 text-center space-y-3">
                <p className="text-sm font-semibold text-red-500">{dynamicError}</p>
                <button onClick={loadDynamicView} className="btn-secondary text-sm py-2">Réessayer</button>
              </div>
            )}

            {!dynamicLoading && !dynamicError && dynamicGroups.length === 0 && (
              <div className="glass-card-premium p-10 text-center text-slate-400 space-y-2">
                <FolderOpen size={28} className="mx-auto opacity-40" />
                <p className="text-sm font-semibold text-slate-500">Aucun document à regrouper</p>
                <p className="text-xs">
                  Indexez des documents, ou choisissez un autre critère de regroupement.
                </p>
              </div>
            )}

            {!dynamicLoading && !dynamicError && dynamicGroups.length > 0 && (
              <>
                {isAdmin && (
                  <p className="text-xs text-slate-400 font-medium">
                    Faites glisser une fiche par sa poignée pour la reclasser :
                    la métadonnée « {activeGroupField} » du document est mise à jour.
                  </p>
                )}
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDocumentDrop}>
                  {dynamicGroups.map((grp) => (
                    <div key={grp.group_name} className="mb-4">
                      <DraggableDocumentGroup
                        groupName={grp.group_name}
                        count={grp.count}
                        documents={grp.documents || []}
                        canDrag={isAdmin}
                        // Un statut ne peut pas être vidé (domaine fermé côté
                        // backend) : le groupe « Non classé » n'accepte donc
                        // aucun dépôt quand le regroupement porte sur le statut.
                        acceptsDrop={isAdmin && !(activeGroupField === 'statut' && grp.group_name === UNCLASSIFIED_GROUP)}
                        isPending={pendingDropGroup === grp.group_name}
                        onOpenDocument={setDetailDoc}
                        onApercuDocument={setApercuDoc}
                      />
                    </div>
                  ))}
                </DndContext>
              </>
            )}
          </div>
        )}

        {/* Table standard */}
        {viewMode === 'list' && (
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
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!loading && data?.documents?.map((d) => (
                  <tr key={d.id} onClick={() => setDetailDoc(d.id)} className="hover:bg-blue-50/40 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-bold text-docuflow-secondary">{d.reference_mfile}</td>
                    <td className="px-4 py-3 font-medium text-slate-800 flex items-center gap-2"><Building2 size={14} className="text-slate-400" /> {d.nom_entreprise}</td>
                    <td className="px-4 py-3 text-slate-600">{d.num_dossier} / {d.num_acte}</td>
                    <td className="px-4 py-3">{d.type_document || '—'}</td>
                    <td className="px-4 py-3"><Calendar size={13} className="inline mr-1 text-slate-400" />{d.annee}</td>
                    <td className="px-4 py-3">{d.dossier_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`status-badge ${STATUS_CLASSES[d.statut] || ''}`}>{STATUS_LABELS[d.statut] || d.statut}</span>
                    </td>
                    <td className="px-4 py-3 text-center"><FileText size={14} className="inline mr-1 text-slate-400" />{d.files_count || 0}</td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      {isAdmin && (
                        <button
                          onClick={() => setSupprimerDoc(d)}
                          className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-red-400 hover:text-red-600 mx-auto transition-colors"
                          title="Mettre à la corbeille"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
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
        )}
      </div>

      {showForm && (
        <DocumentFormModal
          editing={editingDoc}
          folders={folders}
          onClose={() => setShowForm(false)}
          onSuccess={() => { setShowForm(false); load(); loadFolders(); }}
        />
      )}

      {/* Suppression douce depuis la liste — confirmée, puis corbeille. */}
      <ConfirmDialog
        isOpen={!!supprimerDoc}
        title={`Mettre « ${supprimerDoc?.reference_mfile || 'ce document'} » à la corbeille ?`}
        message="Le document disparaît du référentiel mais reste restaurable depuis la corbeille, avec ses fichiers, ses métadonnées et son historique."
        confirmLabel="Mettre à la corbeille"
        type="danger"
        onConfirm={confirmerSuppression}
        onClose={() => setSupprimerDoc(null)}
      />
      {showAssembly && (
        <DocumentAssemblyModal
          onClose={() => setShowAssembly(false)}
          onSuccess={() => { setShowAssembly(false); load(); }}
        />
      )}
      {showViewBuilder && (
        <DynamicViewBuilder
          onClose={() => setShowViewBuilder(false)}
          onCreated={(view) => {
            loadSavedViews();
            // On bascule directement sur la vue qui vient d'être composée :
            // l'auteur voit immédiatement le résultat de ses filtres.
            if (view?.id) setActiveViewId(view.id);
          }}
        />
      )}
      {detailDoc && (
        <DocumentDetailsModal
          documentId={detailDoc}
          isAdmin={isAdmin}
          folders={folders}
          onClose={fermerFiche}
          onChanged={() => { load(); }}
        />
      )}
      {apercuDoc && (
        <DocumentPreviewLightbox
          url={apercuDoc.apercu_url}
          mimeType={apercuDoc.mime_type}
          nomFichier={apercuDoc.original_name}
          titre={`${apercuDoc.reference_mfile} — ${apercuDoc.nom_entreprise}`}
          onClose={() => setApercuDoc(null)}
        />
      )}
    </div>
  );
};

export default DocumentsPage;
