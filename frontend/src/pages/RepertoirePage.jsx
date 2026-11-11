import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { Printer, Loader2, ArrowLeft, FileSpreadsheet, Tags } from 'lucide-react';
import { physiqueService, TYPES_EMPLACEMENT, COULEURS } from '../services/physiqueService';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Répertoire d'un périmètre d'archives papier (migration 043) : l'instrument
 * de recherche tiré des descriptions — boîte par boîte, dossier par dossier.
 * Imprimable (paysage) et exportable vers un tableur : c'est le bordereau de
 * traitement, sans ressaisie.
 */
const Pastille = ({ couleur }) => (couleur && COULEURS[couleur] ? (
  <span title={`Étiquette ${COULEURS[couleur][0].toLowerCase()}`}
    style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, border: '1px solid #64748b', background: COULEURS[couleur][1], WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact', verticalAlign: 'middle', marginRight: 6 }} />
) : null);

/**
 * Propriétés d'un dossier à imprimer : celles que l'analyse ne dit pas déjà
 * (la charte de nommage reprend souvent la référence et l'objet), les nombres
 * formatés.
 */
function description(d) {
  const analyse = (d.analyse || '').toLowerCase();
  return [
    d.classe,
    ...d.details
      .filter(([, v]) => !analyse.includes(String(v).toLowerCase()))
      .map(([l, v, type]) => `${l} : ${type === 'number' && !Number.isNaN(Number(v)) ? Number(v).toLocaleString('fr-FR') : v}`),
  ].filter(Boolean).join(' · ');
}

const Repertoire = ({ r }) => (
  <article className="certificat">
    <header className="certificat-entete">
      <div>
        <p className="certificat-surtitre">{r.organisation?.nom || ''}</p>
        <h1>Répertoire des archives</h1>
        <p className="certificat-numero">
          {TYPES_EMPLACEMENT[r.perimetre.type]} {r.perimetre.cote}{r.perimetre.libelle ? ` — ${r.perimetre.libelle}` : ''} · {r.boites.length} boîte(s) · {r.total_dossiers} dossier(s) · établi le {new Date(r.etabli_at).toLocaleDateString('fr-FR')}
        </p>
      </div>
    </header>
    {r.boites.length === 0 ? <p className="certificat-texte">Aucune boîte dans ce périmètre.</p> : (
      <table style={{ marginTop: 14 }}>
        <thead><tr><th style={{ width: '17%' }}>Cote</th><th style={{ width: '9%' }}>Référence</th><th style={{ width: '28%' }}>Analyse</th><th style={{ width: '8%' }}>Dates extrêmes</th><th>Description</th></tr></thead>
        <tbody>
          {r.boites.map((b) => (
            <React.Fragment key={b.id}>
              <tr style={{ background: '#f1f5f9', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                <td className="mono" style={{ fontWeight: 800, whiteSpace: 'nowrap' }}><Pastille couleur={b.couleur_etiquette} />{b.cote}</td>
                <td>{b.type === 'boite' ? 'Boîte' : 'Tablette'}</td>
                <td style={{ fontWeight: 700 }}>{b.libelle || <span className="discret">Sans intitulé</span>}</td>
                <td style={{ fontWeight: 700 }}>{b.dates_extremes}</td>
                <td>
                  {[b.fonds && `Fonds : ${b.fonds}`, b.type_boite, b.couleur_etiquette && `étiquette ${COULEURS[b.couleur_etiquette][0].toLowerCase()}`, `${b.dossiers.length} dossier(s)`].filter(Boolean).join(' · ')}
                  {b.masques > 0 && <span className="discret"> · {b.masques} hors de votre périmètre</span>}
                </td>
              </tr>
              {b.dossiers.map((d) => (
                <tr key={d.id}>
                  <td className="mono" style={{ paddingLeft: 18 }}>{d.cote || '—'}</td>
                  <td className="mono">{d.reference}</td>
                  <td>{d.analyse}</td>
                  <td>{d.dates_extremes}</td>
                  <td>{description(d)}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    )}
  </article>
);

/** Export tableur : une ligne par dossier, les propriétés de classe en colonnes. */
function versCsv(r) {
  const proprietes = [...new Set(r.boites.flatMap((b) => b.dossiers.flatMap((d) => d.details.map(([l]) => l))))];
  const entetes = ['Cote de la boîte', 'Intitulé de la boîte', 'Fonds', 'Type de boîte', "Couleur d'étiquette", 'Dates extrêmes de la boîte',
    'Cote du dossier', 'Référence', 'Analyse', 'Dates extrêmes', 'Classe', ...proprietes];
  const cellule = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lignes = [entetes.map(cellule).join(';')];
  for (const b of r.boites) {
    const boite = [b.cote, b.libelle, b.fonds, b.type_boite, b.couleur_etiquette ? COULEURS[b.couleur_etiquette][0] : '', b.dates_extremes];
    const dossiers = b.dossiers.length ? b.dossiers : [null];
    for (const d of dossiers) {
      const valeurs = d ? Object.fromEntries(d.details.map(([l, v]) => [l, v])) : {};
      lignes.push([...boite, ...(d ? [d.cote, d.reference, d.analyse, d.dates_extremes, d.classe] : ['', '', '', '', '']), ...proprietes.map((p) => valeurs[p] ?? '')].map(cellule).join(';'));
    }
  }
  // BOM : Excel lit alors les accents correctement.
  return `﻿${lignes.join('\r\n')}`;
}

const RepertoirePage = () => {
  const { id } = useParams();
  useTitrePage('Répertoire des archives');
  const [r, setR] = useState(null);
  const [erreur, setErreur] = useState(null);
  useEffect(() => { physiqueService.repertoire(id).then(setR).catch((e) => setErreur(e.response?.data?.message || 'Répertoire indisponible')); }, [id]);
  const lien = useMemo(() => (r ? URL.createObjectURL(new Blob([versCsv(r)], { type: 'text/csv;charset=utf-8' })) : null), [r]);
  useEffect(() => () => { if (lien) URL.revokeObjectURL(lien); }, [lien]);
  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1200px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <Link to="/documents/magasins" className="text-sm font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"><ArrowLeft size={15} /> Magasins</Link>
        <div className="flex flex-wrap gap-2">
          {r && <Link to={`/documents/magasins/${id}/etiquettes`} className="btn btn-secondary"><Tags size={16} /> Étiquettes</Link>}
          {lien && <a href={lien} download={`repertoire-${r.perimetre.cote}.csv`} className="btn btn-secondary"><FileSpreadsheet size={16} /> Exporter (Excel)</a>}
          <button type="button" onClick={() => window.print()} disabled={!r} className="btn btn-primary"><Printer size={16} /> Imprimer</button>
        </div>
      </div>
      {erreur ? <div className="glass-card-premium p-10 text-center text-sm text-red-600 font-semibold">{erreur}</div>
        : !r ? <div className="glass-card-premium p-16 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto" /></div>
          : <div className="certificat-ecran overflow-x-auto"><Repertoire r={r} /></div>}
      {r && createPortal(<div className="portail-impression"><style>{'@media print { @page { size: A4 landscape; margin: 12mm; } }'}</style><Repertoire r={r} /></div>, document.body)}
    </div>
  );
};

export default RepertoirePage;
