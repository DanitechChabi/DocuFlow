import React, { useState, useEffect, useRef } from 'react';
import { Search, FileText, FolderOpen, User, Command, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { documentService } from '../services/documentService';

/**
 * Recherche globale style Cmd+K (Notion, Linear, Vercel).
 * S'ouvre avec Ctrl+K ou Cmd+K.
 * Recherche documents, dossiers, pages de navigation.
 */
const GlobalSearch = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Raccourci clavier Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Focus l'input quand le modal s'ouvre
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Recherche debounce
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await documentService.getDocuments({ q: query, page_size: 8 });
        const docs = (data.documents || []).map(d => ({
          type: 'document',
          id: d.id,
          title: d.reference_mfile,
          subtitle: `${d.nom_entreprise} — ${d.type_document || 'N/A'}`,
          icon: FileText,
          action: () => { navigate('/documents?q=' + encodeURIComponent(query)); setIsOpen(false); },
        }));
        setResults(docs);
      } catch {
        // Recherche en échec (réseau, session expirée) : liste vide plutôt qu'un
        // modal cassé — l'utilisateur peut relancer sa saisie.
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, navigate]);

  // Pages de navigation rapides
  const quickPages = [
    { type: 'page', title: 'Tableau de bord', subtitle: '/dashboard', icon: ArrowRight, action: () => { navigate('/dashboard'); setIsOpen(false); } },
    { type: 'page', title: 'Mes demandes', subtitle: '/dashboard/requests', icon: ArrowRight, action: () => { navigate('/dashboard/requests'); setIsOpen(false); } },
    { type: 'page', title: 'Documents', subtitle: '/documents', icon: FolderOpen, action: () => { navigate('/documents'); setIsOpen(false); } },
    { type: 'page', title: 'Mon profil', subtitle: '/profile', icon: User, action: () => { navigate('/profile'); setIsOpen(false); } },
  ];

  const allResults = query.trim()
    ? results
    : quickPages;

  // Navigation au clavier
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, allResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && allResults[selectedIndex]) {
      allResults[selectedIndex].action();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
        {/* Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <Search size={20} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Rechercher un document, naviguer…"
            className="flex-1 text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
          />
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 text-slate-400 rounded">ESC</kbd>
          </div>
        </div>

        {/* Résultats */}
        <div className="max-h-80 overflow-y-auto">
          {searching && (
            <div className="px-5 py-8 text-center text-sm text-slate-400">
              <div className="w-5 h-5 border-2 border-slate-200 border-t-docuflow-secondary rounded-full animate-spin mx-auto mb-2"></div>
              Recherche…
            </div>
          )}

          {!searching && allResults.length === 0 && query.trim() && (
            <div className="px-5 py-8 text-center text-sm text-slate-400">
              Aucun résultat pour "{query}"
            </div>
          )}

          {!searching && allResults.length > 0 && (
            <div className="py-2">
              {!query.trim() && (
                <p className="px-5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Navigation rapide</p>
              )}
              {allResults.map((item, i) => {
                const Icon = item.icon;
                return (
                  <button
                    key={i}
                    onClick={item.action}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${
                      i === selectedIndex ? 'bg-docuflow-secondary/5' : 'hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={16} className="text-slate-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{item.title}</p>
                      <p className="text-xs text-slate-400 truncate">{item.subtitle}</p>
                    </div>
                    {i === selectedIndex && (
                      <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 text-slate-400 rounded">↵</kbd>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-slate-100 rounded font-mono">↑↓</kbd> naviguer</span>
            <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-slate-100 rounded font-mono">↵</kbd> ouvrir</span>
            <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-slate-100 rounded font-mono">esc</kbd> fermer</span>
          </div>
          <span className="text-[10px] text-slate-300 font-medium flex items-center gap-1">
            <Command size={10} />K
          </span>
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;
