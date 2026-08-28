import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Lock, Trash2 } from 'lucide-react';
import { DocumentThumbnail } from './DocumentPreview';
import { STATUS_CLASSES, STATUS_LABELS } from '../utils/documentStatuses';

/**
 * DraggableDocumentCard — fiche document déplaçable d'un groupe à l'autre dans
 * une vue dynamique.
 *
 * Le glissement est réservé aux profils autorisés à écrire (`canDrag`) : les
 * routes d'écriture de documentRoutes.js sont derrière roleMiddleware
 * (superadmin, admin, archiviste). Laisser un lecteur déplacer une fiche
 * produirait un 403 après coup, donc une poignée qui promet une action refusée.
 *
 * Un document verrouillé (extrait pour modification) n'est pas déplaçable non
 * plus : c'est le sens même du verrou, et le laisser bouger contredirait le
 * badge « Verrouillé » affiché sur la fiche.
 *
 * @param {function} props.onApercu Ouvre l'aperçu plein écran. L'état de cette
 *   vue appartient au parent : une seule est ouverte à la fois, alors qu'un
 *   groupe compte des centaines de fiches.
 */
const DraggableDocumentCard = ({ document: doc, canDrag = false, onOpen, onApercu, onSupprimer }) => {
  const locked = !!doc.is_checked_out;
  const draggable = canDrag && !locked;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `doc-${doc.id}`,
    disabled: !draggable,
    data: { documentId: doc.id, document: doc },
  });

  const style = {
    // Pas de `transition` ici : pendant le glissement, dnd-kit met à jour
    // `transform` à chaque frame ; une transition CSS ferait traîner la fiche
    // derrière le curseur.
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-3 bg-slate-50 rounded-xl border transition-colors space-y-1.5 ${
        isDragging ? 'border-docuflow-secondary shadow-lg' : 'border-slate-100 hover:bg-blue-50/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {draggable && (
            <span
              {...attributes}
              {...listeners}
              // La poignée porte les écouteurs, et non la carte entière : sans
              // cela, le clic d'ouverture de la fiche serait interprété comme le
              // début d'un glissement et le détail ne s'ouvrirait plus.
              className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition-colors shrink-0"
              title="Déplacer vers un autre groupe"
            >
              <GripVertical size={14} />
            </span>
          )}
          <span className="text-xs font-bold text-docuflow-secondary truncate">{doc.reference_mfile}</span>
        </div>
        {locked ? (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex items-center gap-1 shrink-0">
            <Lock size={10} /> Verrouillé
          </span>
        ) : (
          <span className={`status-badge text-[10px] shrink-0 ${STATUS_CLASSES[doc.statut] || ''}`}>
            {STATUS_LABELS[doc.statut] || doc.statut}
          </span>
        )}
        {onSupprimer && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSupprimer(doc); }}
            className="ml-auto w-6 h-6 rounded-md flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
            title="Mettre à la corbeille"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onOpen?.(doc.id)}
        className="w-full text-left cursor-pointer"
      >
        <p className="text-sm font-semibold text-slate-800 truncate">{doc.nom_entreprise}</p>
        <p className="text-xs text-slate-400">
          {doc.num_dossier} / {doc.num_acte} — {doc.annee}
        </p>
      </button>
      {/* L'aperçu vient après le libellé, pas avant : l'archiviste identifie la
          fiche par sa référence et son entreprise ; la vignette confirme, elle
          ne remplace pas. */}
      <DocumentThumbnail
        url={doc.apercu_url}
        mimeType={doc.mime_type}
        nomFichier={doc.original_name}
        onAgrandir={onApercu ? () => onApercu(doc) : undefined}
      />
    </div>
  );
};

export default DraggableDocumentCard;
