import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, RotateCcw, AlertTriangle, FileText, Clock, ShieldAlert } from 'lucide-react';
import { documentService } from '../services/documentService';
import { usePermissions } from '../hooks/usePermissions';
import PageHeader from '../components/PageHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import { toast } from '../components/Toast';
import { STATUS_CLASSES, STATUS_LABELS } from '../utils/documentStatuses';

// ============================================================================
// CorbeillePage — les documents supprimés, restaurables, purgeables.
//
// La suppression depuis le référentiel est DOUCE : elle aboutit ici. La
// restauration rend le document à l'identique (statut, fichiers, métadonnées,
// historique). La destruction physique existe — permission documents.purge —
// mais c'est un geste exprès, à double tour de clé, jamais le bouton du quotidien.
// ============================================================================

const formatDate = (v) => (v ? new Date(v).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const CorbeillePage = () => {
  const { can } = usePermissions();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [purgeCible, setPurgeCible] = useState(null); // document à purger
  const [busy, setBusy] = useState(null); // id en cours d'action

  const charger = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await documentService.getCorbeille());
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur lors du chargement de la corbeille.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const restaurer = async (id) => {
    setBusy(id);
    try {
      await documentService.restoreDocument(id);
      toast.success('Document restauré — il est de retour dans le référentiel.');
      charger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Restauration impossible.');
    } finally {
      setBusy(null);
    }
  };

  const confirmerPurge = async () => {
    if (!purgeCible) return;
    setBusy(purgeCible.id);
    try {
      await documentService.purgeDocument(purgeCible.id);
      toast.success(`« ${purgeCible.reference_mfile} » définitivement détruit.`);
      setPurgeCible(null);
      charger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Purge impossible.');
      setPurgeCible(null);
    } finally {
      setBusy(null);
    }
  };

  const peutPurger = can('documents.purge');

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 md:py-8">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="Corbeille"
          subtitle="Les documents supprimés restent restaurables jusqu'à leur destruction définitive"
          icon={Trash2}
          breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Corbeille' }]}
          documentTitle="Corbeille"
        />

        <div className="mt-6 space-y-4">
          {error && (
            <div className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-200 text-sm font-bold flex items-center gap-3">
              <AlertTriangle size={18} /> {error}
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-slate-400">
              <div className="w-8 h-8 border-2 border-slate-300 border-t-docuflow-secondary rounded-full animate-spin mx-auto mb-3" />
              Chargement de la corbeille…
            </div>
          ) : items.length === 0 ? (
            <div className="glass-card-premium py-14 text-center">
              <Trash2 size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="font-bold text-slate-500">La corbeille est vide</p>
              <p className="text-sm text-slate-400 mt-1">
                Les documents supprimés apparaissent ici et restent restaurables.
              </p>
            </div>
          ) : (
            <>
              {!peutPurger && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 flex items-center gap-2">
                  <ShieldAlert size={14} className="flex-shrink-0" />
                  La destruction définitive exige la permission « Purger définitivement » — seul un
                  administrateur peut l'accorder depuis Rôles &amp; permissions.
                </div>
              )}
              <div className="space-y-2">
                {items.map((d) => (
                  <div key={d.id} className="glass-card-premium p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0">
                      <FileText size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-800 text-sm">{d.reference_mfile}</span>
                        <span className={`status-badge ${STATUS_CLASSES[d.statut] || ''}`}>{STATUS_LABELS[d.statut] || d.statut}</span>
                      </div>
                      <div className="text-xs text-slate-400 truncate">
                        {d.nom_entreprise}{d.num_dossier && ` · Dossier ${d.num_dossier}`}{d.num_acte && ` · Acte ${d.num_acte}`}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <Clock size={11} />
                        Supprimé le {formatDate(d.deleted_at)}
                        {d.deleted_by_name && <> par {d.deleted_by_name}</>}
                        {d.files_count > 0 && <> · {d.files_count} fichier(s)</>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => restaurer(d.id)}
                        disabled={busy === d.id}
                        className="btn-secondary flex items-center gap-1.5 !py-2"
                      >
                        <RotateCcw size={14} /> Restaurer
                      </button>
                      {peutPurger && (
                        <button
                          onClick={() => setPurgeCible(d)}
                          disabled={busy === d.id}
                          className="w-9 h-9 rounded-xl bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center"
                          title="Détruire définitivement"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!purgeCible}
        title={`Détruire définitivement « ${purgeCible?.reference_mfile} » ?`}
        message="Cette action est IRRÉVERSIBLE : le document, ses fichiers, son historique et ses métadonnées seront détruits. Aucune restauration ne sera possible."
        confirmLabel="Détruire définitivement"
        type="danger"
        onConfirm={confirmerPurge}
        onClose={() => setPurgeCible(null)}
      />
    </div>
  );
};

export default CorbeillePage;
