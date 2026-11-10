import React from 'react';
import { STATUTS, MOTIFS } from '../../services/courrierService';

/** Statut d'un courrier, avec le motif de clôture et l'alerte de retard. */
const PastilleStatut = ({ c }) => {
  const [libelle, classe] = STATUTS[c.statut] || [c.statut, 'bg-slate-100 text-slate-600 border-slate-200'];
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${classe}`}>
        {c.statut === 'clos' && c.clos_motif ? MOTIFS[c.clos_motif] : libelle}
      </span>
      {c.en_retard && <span className="px-2 py-0.5 rounded-full border text-[11px] font-bold bg-red-50 text-red-700 border-red-200 whitespace-nowrap">En retard</span>}
    </span>
  );
};

export default PastilleStatut;
