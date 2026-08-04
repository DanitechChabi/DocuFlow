import React, { useState, useRef, useEffect } from 'react';
import { X, Send, FileText, Search, Bot } from 'lucide-react';
import { documentService } from '../services/documentService';

/**
 * Chatbot intelligent pour interroger le référentiel documentaire.
 * Recherche les documents par mots-clés et présente les résultats.
 */
const DocumentChatbot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'bot', text: 'Bonjour ! Je suis DocuBot 🤖 — posez-moi des questions sur les documents. Ex : "Trouve tous les contrats de 2026" ou "Documents de l\'entreprise X"' }
  ]);
  const [input, setInput] = useState('');
  const [searching, setSearching] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleSend = async () => {
    const q = input.trim();
    if (!q || searching) return;

    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setInput('');
    setSearching(true);

    try {
      // Interpréter l'intention utilisateur
      const intent = parseIntent(q);
      const params = { page: 1, page_size: 10 };
      if (intent.query) params.q = intent.query;
      if (intent.type) params.type_document = intent.type;
      if (intent.year) params.annee = intent.year;
      if (intent.status) params.statut = intent.status;
      if (intent.tag) params.tag = intent.tag;

      const data = await documentService.getDocuments(params);
      const docs = data.documents || [];

      let botReply = '';

      if (docs.length === 0) {
        botReply = `Aucun document trouvé pour "${q}". Essayez avec d'autres mots-clés.`;
      } else if (intent.intent === 'count') {
        botReply = `📊 J'ai trouvé **${docs.length}** document(s)${intent.query ? ` pour "${intent.query}"` : ''}${intent.type ? ` de type "${intent.type}"` : ''}${intent.year ? ` en ${intent.year}` : ''}.`;
      } else {
        botReply = `📄 J'ai trouvé **${docs.length}** document(s) :`;
      }

      setMessages(prev => [...prev, { role: 'bot', text: botReply, documents: docs.slice(0, 5) }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'bot', text: '❌ Erreur lors de la recherche. Réessayez.' }]);
    } finally {
      setSearching(false);
    }
  };

  const parseIntent = (text) => {
    const lower = text.toLowerCase();
    const intent = { intent: 'search', query: null, type: null, year: null, status: null, tag: null };

    // Extraire l'année
    const yearMatch = lower.match(/\b(20\d{2})\b/);
    if (yearMatch) intent.year = Number(yearMatch[1]);

    // Détecter le type de document
    const types = ['contrat', 'facture', 'rapport', 'pv', 'lettre', 'dossier', 'acte'];
    for (const t of types) {
      if (lower.includes(t)) { intent.type = t.charAt(0).toUpperCase() + t.slice(1); break; }
    }

    // Détecter les statuts
    if (lower.includes('disponible') || lower.includes('actif')) intent.status = 'disponible';
    if (lower.includes('archiv') || lower.includes('ancien')) intent.status = 'archivé';
    if (lower.includes('prêt') || lower.includes('pret')) intent.status = 'prêt';

    // Détecter intention "combien" / "nombre"
    if (lower.match(/\b(combien|nombre|total|stats|statistiques)\b/)) intent.intent = 'count';

    // Extraire le reste comme requête de recherche libre
    let query = text
      .replace(/\b(trouve|cherche|cherchez|recherche|affiche|montre|liste|list|donne|donner)\b/gi, '')
      .replace(/\b(tous?|toute?s?|les|des|du|de|la|le|un|une)\b/gi, '')
      .replace(/\b(contrat|facture|rapport|pv|lettre|dossier|acte|document)s?\b/gi, '')
      .replace(/\b(20\d{2})\b/g, '')
      .replace(/\b(disponible|archivé|archiv|prêt|pret|actif|ancien)s?\b/gi, '')
      .trim();

    if (query.length > 2) intent.query = query;

    return intent;
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatDoc = (doc) => (
    <div key={doc.id} className="bg-white/10 rounded-xl p-3 border border-white/5 hover:bg-white/15 transition-colors">
      <div className="flex items-start gap-2">
        <FileText size={14} className="text-afgc-secondary mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">{doc.reference_mfile}</p>
          <p className="text-xs text-white/50 truncate">{doc.nom_entreprise} — {doc.type_document || 'N/A'}</p>
          <p className="text-[10px] text-white/30">{doc.annee} • v{doc.version}</p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Floating button — style robot, position bas-gauche */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 left-6 z-30 group"
          title="DocuBot — Assistant documentaire"
        >
          <div className="relative">
            {/* Halo animé */}
            <div className="absolute -inset-2 rounded-full bg-gradient-to-r from-afgc-secondary to-blue-500 opacity-30 blur-lg group-hover:opacity-50 transition-opacity animate-pulse"></div>
            {/* Robot icon */}
            <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-afgc-secondary to-blue-600 text-white shadow-xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="10" rx="2"/>
                <circle cx="9" cy="16" r="1"/>
                <circle cx="15" cy="16" r="1"/>
                <path d="M12 11V7"/>
                <path d="M8 7h8"/>
                <path d="M9 3h6l1 4H8l1-4z"/>
              </svg>
            </div>
            {/* Badge "IA" */}
            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center shadow-md border-2 border-white">
              IA
            </div>
          </div>
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-6 left-6 z-40 w-[380px] h-[520px] rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-scale-in"
          style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}>
          {/* Header */}
          <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-afgc-secondary/20 flex items-center justify-center">
                <Bot size={18} className="text-afgc-secondary" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">DocuBot</p>
                <p className="text-[10px] text-white/40">Assistant documentaire</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/40">
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-afgc-secondary text-white rounded-br-md'
                    : 'bg-white/5 text-white/90 rounded-bl-md'
                }`}>
                  <p className="text-sm whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: msg.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                  {msg.documents && (
                    <div className="mt-3 space-y-2">
                      {msg.documents.map(doc => formatDoc(doc))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {searching && (
              <div className="flex justify-start">
                <div className="bg-white/5 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Search size={14} className="text-afgc-secondary animate-pulse" />
                    <span className="text-sm text-white/50">Recherche…</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-white/10">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Posez votre question…"
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-afgc-secondary/50 focus:bg-white/10 transition-colors"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || searching}
                className="p-2.5 rounded-xl bg-afgc-secondary text-white hover:bg-afgc-secondary/80 disabled:opacity-30 transition-all"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DocumentChatbot;
