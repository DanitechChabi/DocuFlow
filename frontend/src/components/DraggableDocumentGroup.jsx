import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { FolderOpen } from 'lucide-react';
import DraggableDocumentCard from './DraggableDocumentCard';

/**
 * DraggableDocumentGroup — un groupe d'une vue dynamique, qui accepte le dépôt
 * d'un document venu d'un autre groupe.
 *
 * Déposer ici revient à écrire `groupName` dans la métadonnée de regroupement du
 * document. Le groupe « Non classé » est un cas particulier : ce n'est pas une
 * valeur stockée mais l'étiquette du COALESCE côté SQL. Le backend la traduit en
 * NULL (updateDocument), sauf pour le statut qui n'admet que trois valeurs — d'où
 * `acceptsDrop`, décidé par le parent qui seul connaît le champ de regroupement.
 */
const DraggableDocumentGroup = ({
  groupName,
  count,
  documents = [],
  canDrag = false,
  acceptsDrop = true,
  isPending = false,
  onOpenDocument,
  onApercuDocument,
  onSupprimerDocument,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `group-${groupName}`,
    disabled: !acceptsDrop,
    data: { groupName },
  });

  return (
    <div
      ref={setNodeRef}
      className={`glass-card-premium p-5 space-y-3 transition-all ${
        isOver && acceptsDrop ? 'ring-2 ring-docuflow-secondary ring-offset-2 bg-blue-50/40' : ''
      } ${isPending ? 'opacity-60 pointer-events-none' : ''}`}
    >
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
          <FolderOpen size={18} className="text-docuflow-secondary" />
          {groupName}
        </h3>
        <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-docuflow-secondary text-xs font-bold">
          {count} document{count > 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {documents.map((docItem) => (
          <DraggableDocumentCard
            key={docItem.id}
            document={docItem}
            canDrag={canDrag}
            onOpen={onOpenDocument}
            onApercu={onApercuDocument}
            onSupprimer={onSupprimerDocument}
          />
        ))}
      </div>

      {/* Une zone de dépôt visible même quand le groupe est vide : sinon un
          groupe sans document n'offrirait aucune cible atteignable. */}
      {documents.length === 0 && (
        <p className="py-6 text-center text-xs text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
          {acceptsDrop ? 'Déposez un document ici' : 'Aucun document'}
        </p>
      )}
    </div>
  );
};

export default DraggableDocumentGroup;
