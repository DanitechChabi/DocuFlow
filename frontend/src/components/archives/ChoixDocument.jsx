import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { documentService } from '../../services/documentService';

/**
 * Choix d'un document de la GED par sa référence ou son contenu : sert à
 * rattacher une pièce justificative (courrier de visa de la DAN, récépissé de
 * versement) déjà scannée et versée. Valeur : { id, reference } ou null.
 */
const ChoixDocument = ({ valeur, onChange, placeholder = 'Référence ou mots du document…', id }) => {
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState([]);

  useEffect(() => {
    const terme = q.trim();
    if (terme.length < 2) { setResultats([]); return undefined; }
    const minuterie = setTimeout(() => {
      documentService.getDocuments({ q: terme, page_size: 6 })
        .then((r) => setResultats(r?.documents || []))
        .catch(() => setResultats([]));
    }, 250);
    return () => clearTimeout(minuterie);
  }, [q]);

  if (valeur) {
    return (
      <div className="input-premium flex items-center justify-between gap-2 text-sm">
        <span className="truncate"><strong>{valeur.reference}</strong>{valeur.intitule ? ` — ${valeur.intitule}` : ''}</span>
        <button type="button" onClick={() => onChange(null)} className="text-slate-400 hover:text-red-600" aria-label="Retirer la pièce"><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input id={id} className="input-premium pl-8 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoComplete="off" />
      {resultats.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
          {resultats.map((d) => (
            <li key={d.id}>
              <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                onClick={() => { onChange({ id: d.id, reference: d.reference_mfile, intitule: d.description || d.nom_entreprise }); setQ(''); setResultats([]); }}>
                <strong>{d.reference_mfile}</strong> <span className="text-slate-500">{d.description || d.nom_entreprise}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ChoixDocument;
