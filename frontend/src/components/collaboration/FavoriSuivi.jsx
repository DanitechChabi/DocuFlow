import React, { useEffect, useState } from 'react';
import { Star, BellRing, BellOff } from 'lucide-react';
import { collaborationService } from '../../services/collaborationService';
import { toast } from '../Toast';

/**
 * Étoile (favori) et cloche (suivre le document) de l'en-tête de la fiche
 * (migration 033). Suivre : être prévenu des nouvelles versions, changements
 * de statut, commentaires et gels.
 */
const FavoriSuivi = ({ documentId }) => {
  const [etat, setEtat] = useState(null);
  useEffect(() => {
    collaborationService.etat(documentId).then(setEtat).catch(() => setEtat(null));
  }, [documentId]);
  if (!etat) return null;

  const basculer = async (quoi) => {
    const actif = !etat[quoi];
    setEtat({ ...etat, [quoi]: actif });
    try {
      await collaborationService[quoi](documentId, actif);
      if (quoi === 'suivi') toast.success(actif ? 'Vous serez prévenu des changements de ce document' : 'Vous ne suivez plus ce document');
    } catch (err) {
      setEtat({ ...etat, [quoi]: !actif });
      toast.error(err.response?.data?.message || 'Action impossible');
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => basculer('favori')} aria-pressed={etat.favori}
        title={etat.favori ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        className={`w-9 h-9 rounded-xl flex items-center justify-center hover:bg-amber-50 ${etat.favori ? 'text-amber-500' : 'text-slate-400'}`}>
        <Star size={17} fill={etat.favori ? 'currentColor' : 'none'} />
      </button>
      <button type="button" onClick={() => basculer('suivi')} aria-pressed={etat.suivi}
        title={etat.suivi ? 'Ne plus suivre' : 'Suivre ce document'}
        className={`w-9 h-9 rounded-xl flex items-center justify-center hover:bg-blue-50 ${etat.suivi ? 'text-docuflow-secondary' : 'text-slate-400'}`}>
        {etat.suivi ? <BellRing size={17} /> : <BellOff size={17} />}
      </button>
    </div>
  );
};

export default FavoriSuivi;
