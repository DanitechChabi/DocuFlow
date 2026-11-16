import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import JsBarcode from 'jsbarcode';
import { Printer, X, Tag } from 'lucide-react';
import Modal from '../../../components/ui/Modal';

// ============================================================================
// Étiquettes à code-barres des dossiers entrés (053). Code 128 — lu par toute
// douchette USB — portant « D0001234 », le n° du dossier. Deux formats :
//   - rouleau : une étiquette de 57 × 32 mm par page (imprimante d'étiquettes) ;
//   - planche : A4, 3 × 8 étiquettes de 70 × 37 mm (planches adhésives).
// ============================================================================

export const codeDe = (id) => `D${String(id).padStart(7, '0')}`;

export const FORMATS = {
  rouleau: { libelle: 'Imprimante d\'étiquettes (rouleau 57 × 32 mm)', l: 57, h: 32 },
  planche: { libelle: 'Planche A4 de 24 étiquettes (70 × 37 mm)', l: 70, h: 37 },
};

const court = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');
const finSemaine = (iso) => {
  const [a, m, j] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + 6)).toISOString().slice(0, 10);
};
const armoireCourte = (a) => (a ? a.split(' ou ').map((x) => x.split(' · ')[0].replace(/^Armoire\s*/i, 'Arm. ')).join(' ou ') : '');

/** Code-barres SVG (Code 128). */
const CodeBarres = ({ valeur, hauteur }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      const svg = ref.current;
      JsBarcode(svg, valeur, { format: 'CODE128', displayValue: false, margin: 14, height: 40, width: 2 }); // marges : zone de silence exigée par les lecteurs
      // JsBarcode fixe largeur, hauteur et style en pixels : on passe à un
      // viewBox, et c'est la case de l'étiquette qui donne la taille.
      const l = parseFloat(svg.getAttribute('width')) || 200;
      const h = parseFloat(svg.getAttribute('height')) || 40;
      svg.setAttribute('viewBox', `0 0 ${l} ${h}`);
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('style', `width:100%;height:${hauteur}mm;display:block`);
    } catch { /* valeur illisible : l'étiquette garde le texte */ }
  }, [valeur, hauteur]);
  return <svg ref={ref} style={{ width: '100%', height: `${hauteur}mm`, display: 'block' }} />;
};

/** Une étiquette : nom, acte et type, semaine / point / lettre / armoire, code-barres. */
export const Etiquette = ({ d, format = 'rouleau' }) => {
  const f = FORMATS[format];
  const au = d.au || finSemaine(d.semaine);
  return (
    <div className="etiq-afgc" style={{ width: `${f.l}mm`, height: `${f.h}mm`, padding: '2mm 2.5mm', boxSizing: 'border-box', overflow: 'hidden', fontFamily: 'Arial, sans-serif', color: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: '8.5pt', fontWeight: 800, lineHeight: 1.1, maxHeight: '2.2em', overflow: 'hidden' }}>{d.denomination || '—'}</div>
      <div style={{ fontSize: '7pt', lineHeight: 1.25, marginTop: '0.4mm' }}>
        {[d.num_actes && `Acte ${d.num_actes}`, d.type_garantie].filter(Boolean).join(' · ')}
      </div>
      <div style={{ fontSize: '7pt', fontWeight: 700, lineHeight: 1.25 }}>
        Sem. {court(d.semaine)}→{court(au)}/{au.slice(0, 4)} · Pt {court(d.date_point)}
        {d.lettre ? ` · L. ${d.lettre}` : ''}{d.armoire ? ` · ${armoireCourte(d.armoire)}` : ''}
      </div>
      <div style={{ marginTop: 'auto' }}>
        <CodeBarres valeur={codeDe(d.id)} hauteur={format === 'planche' ? 10 : 8.5} />
        <div style={{ fontSize: '7pt', fontFamily: 'monospace', textAlign: 'center', letterSpacing: '0.12em', lineHeight: 1.1 }}>{codeDe(d.id)}</div>
      </div>
    </div>
  );
};

/**
 * Imprime des étiquettes : portail d'impression, mise en page du format,
 * puis la boîte d'impression du navigateur. `onFini` à la fermeture.
 */
export const ImpressionEtiquettes = ({ dossiers, format, onFini }) => {
  const fini = useRef(onFini);
  fini.current = onFini;
  useEffect(() => {
    const fin = () => fini.current?.();
    window.addEventListener('afterprint', fin);
    // Une seule fois, après que les codes-barres se sont dessinés.
    const minuteur = setTimeout(() => window.print(), 300);
    return () => { clearTimeout(minuteur); window.removeEventListener('afterprint', fin); };
  }, []);
  const f = FORMATS[format];
  const page = format === 'planche'
    ? '@page { size: 210mm 297mm; margin: 0; }'
    : `@page { size: ${f.l}mm ${f.h}mm; margin: 0; }`;
  return createPortal(
    <div className="portail-impression">
      <style>{`@media print {
        ${page}
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; border: 0 !important; border-radius: 0 !important; height: auto !important; overflow: visible !important; }
        .portail-impression { margin: 0; padding: 0; }
        .portail-impression .etiqs-afgc { display: ${format === 'planche' ? 'grid' : 'block'}; grid-template-columns: repeat(3, 70mm); grid-auto-rows: 37mm; }
        .portail-impression .etiq-afgc { break-inside: avoid; ${format === 'rouleau' ? 'break-after: page;' : ''} }
      }`}</style>
      <div className="etiqs-afgc">
        {dossiers.map((d) => <Etiquette key={d.id} d={d} format={format} />)}
      </div>
    </div>,
    document.body,
  );
};

/** Choix du format et aperçu, avant d'imprimer. */
export const ModaleEtiquettes = ({ dossiers, titre, onClose, onImprimer }) => {
  const [format, setFormat] = useState(() => {
    try { return localStorage.getItem('afgc.etiquettes.format') || 'rouleau'; } catch { return 'rouleau'; }
  });
  const choisir = (f) => { setFormat(f); try { localStorage.setItem('afgc.etiquettes.format', f); } catch { /* sans stockage */ } };
  const n = dossiers.length;
  return (
    <Modal open onClose={onClose} panelClassName="w-full max-w-lg mx-4">
      <div className="bg-white rounded-3xl shadow-2xl p-6">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center flex-shrink-0"><Tag size={20} /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-black text-slate-900">Imprimer {n > 1 ? `${n} étiquettes` : 'l\'étiquette'}</h3>
            {titre && <p className="text-sm font-semibold text-slate-600">{titre}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="mt-4 space-y-2">
          {Object.entries(FORMATS).map(([cle, f]) => (
            <label key={cle} className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 cursor-pointer ${format === cle ? 'border-violet-500 bg-violet-50' : 'border-slate-200'}`}>
              <input type="radio" name="format" checked={format === cle} onChange={() => choisir(cle)} className="accent-violet-600" />
              <span className="text-sm font-bold text-slate-800">{f.libelle}</span>
            </label>
          ))}
        </div>
        {dossiers[0] && (
          <div className="mt-4">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">Aperçu</div>
            <div className="inline-block border border-dashed border-slate-300 rounded-lg bg-white">
              <Etiquette d={dossiers[0]} format={format} />
            </div>
          </div>
        )}
        <p className="mt-3 text-sm text-slate-600">Dans la boîte d'impression, choisissez l'imprimante, taille réelle (100 %), sans marges ni en-têtes.</p>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="button" onClick={() => onImprimer(format)} disabled={!n}
            className="px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
            <Printer size={16} /> Imprimer
          </button>
        </div>
      </div>
    </Modal>
  );
};
