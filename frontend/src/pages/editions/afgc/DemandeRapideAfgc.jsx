import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, X, FileSearch } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import BoiteDemande from './BoiteDemande';

// ============================================================================
// « Demander un dossier » depuis n'importe quelle page : Ctrl+K (Cmd+K), ou
// la barre du haut, ouvre la boîte de demande par-dessus l'écran en cours.
// Sur le site AFGC, elle remplace la recherche de documents pour qui n'a pas
// accès à la GED : chercher un document qu'on ne peut pas ouvrir n'a pas de
// sens, demander un dossier en a un.
// ============================================================================

const DemandeRapideAfgc = () => {
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    const clavier = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOuvert((v) => !v);
      }
    };
    const ouvrir = () => setOuvert(true);
    document.addEventListener('keydown', clavier);
    window.addEventListener('afgc:demander', ouvrir);
    return () => {
      document.removeEventListener('keydown', clavier);
      window.removeEventListener('afgc:demander', ouvrir);
    };
  }, []);

  return (
    <Modal open={ouvert} onClose={() => setOuvert(false)} panelClassName="w-full max-w-2xl mx-4">
      <div className="bg-white rounded-3xl shadow-2xl p-5 md:p-6">
        <div className="flex items-center gap-3 mb-4">
          <PlusCircle size={20} className="text-docuflow-secondary" />
          <h2 className="font-black text-slate-900 text-lg flex-1">Demander un dossier</h2>
          <button type="button" onClick={() => setOuvert(false)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100" aria-label="Fermer"><X size={18} /></button>
        </div>
        <BoiteDemande autoFocus onEnvoye={() => window.dispatchEvent(new CustomEvent('afgc:demande-envoyee'))} />
        <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-sm">
          <Link to="/demandes/mes-demandes" onClick={() => setOuvert(false)} className="font-bold text-docuflow-secondary hover:underline inline-flex items-center gap-1.5">
            <FileSearch size={15} /> Mes dossiers
          </Link>
          <Link to="/demandes/nouvelle?liste=1" onClick={() => setOuvert(false)} className="font-bold text-slate-500 hover:text-slate-700">
            Demander une liste (Excel)
          </Link>
          <span className="ml-auto text-xs text-slate-400 hidden sm:inline">Ctrl+K pour ouvrir ou fermer</span>
        </div>
      </div>
    </Modal>
  );
};

export default DemandeRapideAfgc;
