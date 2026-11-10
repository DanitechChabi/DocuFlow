import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { Printer, Loader2, ArrowLeft } from 'lucide-react';
import { courrierService, SENS, STATUTS, MOTIFS, dateFr } from '../services/courrierService';
import { useSettings } from '../contexts/SettingsContext';
import { useTitrePage } from '../hooks/useTitrePage';

/** Registre du courrier imprimable, par sens et par période (paysage). */
const Registre = ({ org, sens, du, au, courriers }) => (
  <article className="certificat">
    <header className="certificat-entete">
      <div>
        <p className="certificat-surtitre">{org}</p>
        <h1>Registre du courrier — {SENS[sens]}</h1>
        <p className="certificat-numero">Du {dateFr(du)} au {dateFr(au)} · {courriers.length} courrier(s)</p>
      </div>
    </header>
    <table>
      <thead><tr><th>N°</th><th>Enregistré le</th><th>{sens === 'depart' ? 'Destinataire' : 'Expéditeur'}</th><th>Date et référence</th><th>Objet</th><th>{sens === 'depart' ? 'Expédition' : 'Agent chargé'}</th><th>Suite</th></tr></thead>
      <tbody>
        {courriers.map((c) => (
          <tr key={c.id}>
            <td className="mono">{c.numero}</td>
            <td>{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
            <td>{c.correspondant}{c.organisme ? ` — ${c.organisme}` : ''}</td>
            <td>{c.date_courrier ? dateFr(c.date_courrier) : ''}{c.reference_externe ? ` · ${c.reference_externe}` : ''}</td>
            <td>{c.confidentiel ? 'Confidentiel' : c.objet}</td>
            <td>{sens === 'depart' ? (c.expedie_at ? `${new Date(c.expedie_at).toLocaleDateString('fr-FR')}${c.mode_expedition ? ` · ${c.mode_expedition}` : ''}` : '') : (c.assigne_nom || '')}</td>
            <td>{c.statut === 'clos' ? MOTIFS[c.clos_motif] : STATUTS[c.statut]?.[0]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </article>
);

const CourrierRegistrePage = () => {
  useTitrePage('Registre du courrier');
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const sens = SENS[params.get('sens')] ? params.get('sens') : 'arrivee';
  const du = params.get('du') || `${new Date().getFullYear()}-01-01`;
  const au = params.get('au') || new Date().toISOString().slice(0, 10);
  const [courriers, setCourriers] = useState(null);
  useEffect(() => {
    setCourriers(null);
    courrierService.lister({ sens, du, au, taille: 2000 }).then((r) => setCourriers([...r.courriers].reverse())).catch(() => setCourriers([]));
  }, [sens, du, au]);
  const regler = (cle, v) => { const p = new URLSearchParams(params); p.set(cle, v); setParams(p, { replace: true }); };
  const org = settings.legal_entity || settings.site_name || '';
  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1200px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <Link to="/courrier" className="text-sm font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"><ArrowLeft size={15} /> Courrier</Link>
        <div className="flex flex-wrap items-end gap-2">
          <select className="input-premium w-auto" value={sens} onChange={(e) => regler('sens', e.target.value)} aria-label="Sens">{Object.entries(SENS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label className="text-[11px] font-bold text-slate-500">Du<input type="date" className="input-premium" value={du} onChange={(e) => regler('du', e.target.value)} /></label>
          <label className="text-[11px] font-bold text-slate-500">Au<input type="date" className="input-premium" value={au} onChange={(e) => regler('au', e.target.value)} /></label>
          <button type="button" onClick={() => window.print()} disabled={!courriers} className="btn btn-primary"><Printer size={16} /> Imprimer</button>
        </div>
      </div>
      {!courriers ? <div className="glass-card-premium p-16 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto" /></div>
        : <div className="certificat-ecran"><Registre org={org} sens={sens} du={du} au={au} courriers={courriers} /></div>}
      {courriers && createPortal(<div className="portail-impression"><style>{'@media print { @page { size: A4 landscape; margin: 12mm; } }'}</style><Registre org={org} sens={sens} du={du} au={au} courriers={courriers} /></div>, document.body)}
    </div>
  );
};

export default CourrierRegistrePage;
