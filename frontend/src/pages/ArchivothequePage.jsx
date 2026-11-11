import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Landmark, Search, Loader2, FileText, X, ExternalLink } from 'lucide-react';
import { archivothequeService } from '../services/archivothequeService';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Archivothèque virtuelle (migration 045) : la vitrine publique d'une
 * organisation. Quelques pièces choisies, consultables sans compte — chacune
 * communicable, sans donnée personnelle, et publiée sur autorisation. Rien
 * d'interne n'apparaît ici : ni référence, ni nom d'agent.
 */
const Vignette = ({ slug, piece }) => (piece.type === 'image' ? (
  <img src={archivothequeService.urlFichier(slug, piece.id)} alt="" loading="lazy" className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]" />
) : (
  <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[#f6f1e7] text-[#8a6d3b]">
    <FileText size={38} strokeWidth={1.4} />
    <span className="text-[11px] font-bold tracking-widest uppercase">Document</span>
  </div>
));

const Visionneuse = ({ slug, piece, onFermer }) => {
  const url = archivothequeService.urlFichier(slug, piece.id, true);
  useEffect(() => {
    const touche = (e) => { if (e.key === 'Escape') onFermer(); };
    window.addEventListener('keydown', touche);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', touche); document.body.style.overflow = ''; };
  }, [onFermer]);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 flex items-stretch sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={piece.titre} onClick={onFermer}>
      <div className="bg-white w-full max-w-5xl sm:rounded-2xl overflow-hidden flex flex-col max-h-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-200">
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-slate-900 text-lg leading-snug">{piece.titre}</h2>
            <p className="text-sm text-slate-500">{[piece.date_affichee, piece.theme].filter(Boolean).join(' · ')}</p>
          </div>
          <a href={url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-slate-900 p-2 -m-1" title="Ouvrir dans un nouvel onglet" aria-label="Ouvrir dans un nouvel onglet"><ExternalLink size={18} /></a>
          <button type="button" onClick={onFermer} className="text-slate-500 hover:text-slate-900 p-2 -m-1" aria-label="Fermer"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100">
          {piece.type === 'image'
            ? <img src={url} alt={piece.titre} className="mx-auto max-h-[70vh] w-auto object-contain" />
            : <iframe src={url} title={piece.titre} className="w-full h-[70vh] bg-white" />}
        </div>
        {piece.notice && <p className="px-5 py-4 text-sm text-slate-700 whitespace-pre-line border-t border-slate-200 max-h-40 overflow-auto">{piece.notice}</p>}
      </div>
    </div>
  );
};

const ArchivothequePage = () => {
  const { slug } = useParams();
  const [v, setV] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [theme, setTheme] = useState('');
  const [q, setQ] = useState('');
  const [ouverte, setOuverte] = useState(null);
  useTitrePage(v ? `Archivothèque — ${v.nom}` : 'Archivothèque');
  useEffect(() => {
    archivothequeService.vitrine(slug).then(setV)
      .catch((e) => setErreur(e.message === 'introuvable' ? "Cette archivothèque n'existe pas, ou n'est pas ouverte au public." : 'Archivothèque momentanément indisponible. Réessayez dans un instant.'));
  }, [slug]);
  const pieces = useMemo(() => {
    const terme = q.trim().toLowerCase();
    return (v?.pieces || []).filter((p) => (!theme || p.theme === theme)
      && (!terme || `${p.titre} ${p.notice || ''} ${p.date_affichee || ''} ${p.theme || ''}`.toLowerCase().includes(terme)));
  }, [v, theme, q]);

  if (erreur) return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><p className="text-slate-600 font-semibold text-center">{erreur}</p></div>;
  if (!v) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 size={28} className="animate-spin text-slate-400" /></div>;

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-slate-900">
      <header className="bg-[#1c2536] text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10 sm:py-14">
          <div className="flex items-center gap-3">
            {v.logo ? <img src={v.logo} alt="" className="w-11 h-11 rounded-lg object-cover bg-white" /> : <div className="w-11 h-11 rounded-lg bg-white/10 flex items-center justify-center"><Landmark size={22} /></div>}
            <p className="font-semibold text-white/80">{v.nom}</p>
          </div>
          <h1 className="mt-6 text-4xl sm:text-5xl font-black tracking-tight text-white">Archivothèque</h1>
          <p className="mt-3 max-w-2xl text-white/75 whitespace-pre-line">{v.presentation || 'Une sélection de documents tirés de nos archives, ouverts à tous.'}</p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        {v.pieces.length === 0 ? (
          <p className="text-center text-slate-500 py-20">Aucune pièce n'est encore publiée. Revenez bientôt.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <label className="relative flex-1 min-w-[220px] max-w-md">
                <span className="sr-only">Rechercher une pièce</span>
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une pièce…"
                  className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:border-slate-900" />
              </label>
              {v.themes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {['', ...v.themes].map((t) => (
                    <button key={t || 'tous'} type="button" onClick={() => setTheme(t)} aria-pressed={theme === t}
                      className={`h-9 px-3.5 rounded-full text-sm font-semibold border ${theme === t ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'}`}>{t || 'Tout'}</button>
                  ))}
                </div>
              )}
            </div>
            {pieces.length === 0 ? <p className="text-center text-slate-500 py-16">Aucune pièce ne correspond à cette recherche.</p> : (
              <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {pieces.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setOuverte(p)} className="group w-full text-left rounded-2xl overflow-hidden bg-white border border-slate-200 hover:border-slate-400 hover:shadow-lg transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900">
                      <div className="aspect-[4/3] overflow-hidden bg-slate-100"><Vignette slug={v.slug} piece={p} /></div>
                      <div className="p-4">
                        <h2 className="font-bold leading-snug line-clamp-2">{p.titre}</h2>
                        <p className="text-sm text-slate-500 mt-1">{[p.date_affichee, p.theme].filter(Boolean).join(' · ') || ' '}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-4 sm:px-8 py-8 text-xs text-slate-500 border-t border-slate-200">
        Documents publiés par {v.nom}. Chaque pièce est communicable au public, ne porte aucune donnée personnelle et a été autorisée à la publication. Archives tenues avec DocuFlow.
      </footer>
      {ouverte && <Visionneuse slug={v.slug} piece={ouverte} onFermer={() => setOuverte(null)} />}
    </div>
  );
};

export default ArchivothequePage;
