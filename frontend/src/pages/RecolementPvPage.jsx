import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { Printer, Loader2, ArrowLeft } from 'lucide-react';
import { physiqueService, RESULTATS } from '../services/physiqueService';
import { empreinteGroupee } from '../services/archivesService';
import { useTitrePage } from '../hooks/useTitrePage';

/** Procès-verbal de récolement (migration 038), figé à la clôture par son empreinte. */
const dateFr = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : '—');

const Pv = ({ r }) => (
  <article className="certificat">
    <header className="certificat-entete">
      <div>
        <p className="certificat-surtitre">{r.organisation?.nom || ''}{r.organisation?.adresse ? ` — ${r.organisation.adresse}` : ''}</p>
        <h1>Procès-verbal de récolement</h1>
        <p className="certificat-numero">{r.intitule} — périmètre {r.perimetre_libelle}</p>
      </div>
    </header>
    <p className="certificat-texte">
      Récolement ouvert le {dateFr(r.ouvert_at)} par {r.ouvert_par_nom}, clos le {dateFr(r.clos_at)} par {r.clos_par_nom} :
      {' '}{r.bilan.total} ligne(s) constatée(s) — {Object.entries(RESULTATS).filter(([k]) => r.bilan[k]).map(([k, [l]]) => `${r.bilan[k]} ${l.toLowerCase()}`).join(', ')}.
    </p>
    {r.observations && <section><h2>Observations</h2><p className="certificat-texte">{r.observations}</p></section>}
    <section>
      <h2>Constats</h2>
      <table>
        <thead><tr><th>Cote</th><th>Boîte ou document</th><th>Constat</th><th>Observation</th></tr></thead>
        <tbody>
          {r.lignes.map((l) => (
            <tr key={l.id}><td className="mono">{l.cote}</td><td>{l.libelle}</td><td>{RESULTATS[l.resultat]?.[0] || '—'}</td><td>{l.observation || ''}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
    <section className="certificat-sceau">
      <h2>Scellement</h2>
      <dl className="certificat-grille">
        <dt>Empreinte du procès-verbal</dt><dd className="mono">{empreinteGroupee(r.empreinte)}</dd>
        <dt>Contrôle</dt><dd>{r.empreinte_conforme ? 'Conforme : rien n\'a changé depuis la clôture' : 'NON CONFORME'}</dd>
      </dl>
    </section>
    <section><h2>Signatures</h2><dl className="certificat-grille"><dt>L'archiviste</dt><dd>&nbsp;</dd><dt>Le responsable</dt><dd>&nbsp;</dd></dl></section>
  </article>
);

const RecolementPvPage = () => {
  const { id } = useParams();
  useTitrePage('Procès-verbal de récolement');
  const [r, setR] = useState(null);
  const [erreur, setErreur] = useState(null);
  useEffect(() => { physiqueService.pv(id).then(setR).catch((e) => setErreur(e.response?.data?.message || 'Procès-verbal indisponible')); }, [id]);
  return (
    <div className="px-4 sm:px-8 py-6 max-w-[920px] mx-auto">
      <div className="flex items-center justify-between gap-3 mb-5">
        <Link to={`/documents/magasins?vue=recolements&recolement=${id}`} className="text-sm font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"><ArrowLeft size={15} /> Récolement</Link>
        <button type="button" onClick={() => window.print()} disabled={!r} className="btn btn-primary"><Printer size={16} /> Imprimer</button>
      </div>
      {erreur ? <div className="glass-card-premium p-10 text-center text-sm text-red-600 font-semibold">{erreur}</div>
        : !r ? <div className="glass-card-premium p-16 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto" /></div>
          : <div className="certificat-ecran"><Pv r={r} /></div>}
      {r && createPortal(<div className="portail-impression portail-portrait"><style>{'@media print { @page { size: A4 portrait; margin: 14mm; } }'}</style><Pv r={r} /></div>, document.body)}
    </div>
  );
};

export default RecolementPvPage;
