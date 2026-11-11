import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { Printer, Loader2, ArrowLeft } from 'lucide-react';
import { physiqueService, COULEURS } from '../services/physiqueService';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Étiquettes des boîtes d'un périmètre (migration 043), à imprimer, découper
 * et coller au dos des boîtes : bande de couleur, fonds, cote, intitulé,
 * dates extrêmes. Tirées du répertoire : rien à ressaisir.
 */
const Etiquettes = ({ r }) => (
  <div className="etiquettes">
    {r.boites.filter((b) => b.type === 'boite').map((b) => (
      <div key={b.id} className="etiquette">
        <div className="etiquette-bande" style={{ background: b.couleur_etiquette ? COULEURS[b.couleur_etiquette][1] : '#ffffff' }} />
        <div className="etiquette-corps">
          <p className="etiquette-organisme">{r.organisation?.nom || ''}</p>
          {b.fonds && <p className="etiquette-fonds">{b.fonds}</p>}
          <p className="etiquette-cote">{b.cote}</p>
          {b.libelle && <p className="etiquette-intitule">{b.libelle}</p>}
          <div className="etiquette-pied">
            <span className="etiquette-dates">{b.dates_extremes || '—'}</span>
            <span style={{ textAlign: 'right' }}>{b.type_boite || 'Boîte'}<br />{b.dossiers.length + b.masques} dossier(s)</span>
          </div>
        </div>
      </div>
    ))}
  </div>
);

const EtiquettesPage = () => {
  const { id } = useParams();
  useTitrePage('Étiquettes de boîtes');
  const [r, setR] = useState(null);
  const [erreur, setErreur] = useState(null);
  useEffect(() => { physiqueService.repertoire(id).then(setR).catch((e) => setErreur(e.response?.data?.message || 'Étiquettes indisponibles')); }, [id]);
  const nb = r ? r.boites.filter((b) => b.type === 'boite').length : 0;
  return (
    <div className="px-4 sm:px-8 py-6 max-w-[920px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <Link to="/documents/magasins" className="text-sm font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"><ArrowLeft size={15} /> Magasins</Link>
        <button type="button" onClick={() => window.print()} disabled={!nb} className="btn btn-primary"><Printer size={16} /> Imprimer {nb ? `${nb} étiquette(s)` : ''}</button>
      </div>
      {erreur ? <div className="glass-card-premium p-10 text-center text-sm text-red-600 font-semibold">{erreur}</div>
        : !r ? <div className="glass-card-premium p-16 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto" /></div>
          : nb === 0 ? <div className="glass-card-premium p-10 text-center text-sm text-slate-500">Aucune boîte dans {r.perimetre.cote} : créez les boîtes dans « Magasins ».</div>
            : (
              <>
                <p className="text-sm text-slate-600 mb-4">Étiquettes des boîtes de <span className="font-mono font-bold">{r.perimetre.cote}</span>, deux par rangée. La bande reprend la couleur d'étiquette de la boîte ; cochez « Graphiques d'arrière-plan » dans la fenêtre d'impression si elle n'apparaît pas.</p>
                <Etiquettes r={r} />
              </>
            )}
      {r && nb > 0 && createPortal(<div className="portail-impression"><style>{'@media print { @page { size: A4 portrait; margin: 10mm; } }'}</style><Etiquettes r={r} /></div>, document.body)}
    </div>
  );
};

export default EtiquettesPage;
