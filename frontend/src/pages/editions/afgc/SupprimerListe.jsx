import React, { useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { listeService } from '../../../services/listeService';
import { toast } from '../../../components/Toast';

/**
 * Supprimer une liste (classeur de soldes créditeurs ancien, envoyé deux fois
 * ou par erreur) et ses demandes. Impossible tant qu'un de ses dossiers est
 * sorti : son retour doit d'abord être noté.
 */
const SupprimerListe = ({ liste, onFait }) => {
  const [ouvert, setOuvert] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const dehors = (liste.dossiers || []).filter((d) => d.etat === 'transmis').length;
  const n = (liste.dossiers || []).length;
  const supprimer = async () => {
    setEnvoi(true);
    try {
      await listeService.supprimer(liste.id);
      toast.success(`Liste supprimée : ${liste.libelle}.`);
      setOuvert(false);
      onFait?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'La liste n\'a pas pu être supprimée.');
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <>
      <button type="button" onClick={() => setOuvert(true)} disabled={dehors > 0}
        title={dehors ? `${dehors} dossier${dehors > 1 ? 's' : ''} encore sorti${dehors > 1 ? 's' : ''} : notez d'abord le retour` : 'Supprimer la liste et ses demandes'}
        className="px-3.5 py-2 rounded-xl border border-red-200 text-sm font-bold text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
        <Trash2 size={14} /> Supprimer la liste
      </button>
      <Modal open={ouvert} onClose={envoi ? undefined : () => setOuvert(false)} panelClassName="w-full max-w-md mx-4">
        <div className="bg-white rounded-xl shadow-2xl p-6">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0"><Trash2 size={20} /></span>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-slate-900">Supprimer cette liste ?</h3>
              <p className="text-sm font-bold text-slate-800 break-all">{liste.libelle}{liste.fichier ? ` · ${liste.fichier}` : ''}</p>
              <p className="text-sm text-slate-700 mt-1">
                {n > 1 ? `Ses ${n} demandes seront supprimées` : 'Sa demande sera supprimée'} : elles disparaîtront de « Mes dossiers » et de la file de l'archive.
                Ce geste est définitif.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => setOuvert(false)} disabled={envoi} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100">Garder</button>
            <button type="button" onClick={supprimer} disabled={envoi}
              className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
              {envoi ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Supprimer
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default SupprimerListe;
