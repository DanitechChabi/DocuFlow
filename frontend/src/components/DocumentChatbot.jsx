import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { X, Send, FileText, Search, Bot, RotateCcw, ArrowUpRight } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { documentService } from '../services/documentService';
import { analyserQuestion, decrireFiltres, versParametres } from '../utils/docubotIntent';

/**
 * DocuBot — interrogation du référentiel documentaire en langage courant.
 *
 * L'interprétation des questions vit dans `utils/docubotIntent.js` : c'est du
 * calcul pur, et l'y avoir sorti la rend éprouvable sans monter React. Ce fichier
 * ne garde que la conversation et son affichage.
 *
 * CE QUI NE MARCHAIT PAS
 *
 * 1. LES TYPES ÉTAIENT ÉCRITS EN DUR, ET NE CORRESPONDAIENT PAS AUX DONNÉES —
 *    voir l'en-tête de `docubotIntent.js`, qui porte le détail du défaut. En
 *    résumé : « montre les factures » envoyait `type_document='Facture'`, une
 *    valeur qu'aucun document ne porte, et le bot répondait « aucun document »
 *    sur un référentiel qui en contenait.
 *
 * 2. « COMBIEN » RÉPONDAIT FAUX. La réponse comptait `docs.length`, c'est-à-dire
 *    le nombre de lignes de la PAGE demandée (`page_size: 10`). Une organisation
 *    de 400 contrats s'entendait répondre « J'ai trouvé 10 document(s) ». Le
 *    total exact est dans `pagination.total`.
 *
 * 3. LE TEXTE DES RÉPONSES PASSAIT PAR `dangerouslySetInnerHTML`, alors qu'il
 *    interpole la question de l'utilisateur (« Aucun document trouvé pour "…" »).
 *    Toute balise saisie dans le champ était donc injectée telle quelle dans le
 *    DOM. `TexteEnrichi` rend le gras sans jamais construire de HTML.
 *
 * 4. LES RÉSULTATS ÉTAIENT INERTES : le bot trouvait le document, l'affichait, et
 *    laissait l'utilisateur le rechercher à la main dans la page Documents. Ils
 *    ouvrent maintenant la fiche via `/documents?doc=<id>`.
 *
 * CE QUI N'A PAS ÉTÉ « CORRIGÉ », APRÈS VÉRIFICATION
 *
 * - `reference_mfile` reste affiché. C'est la colonne de référence du document,
 *   présentée sous le libellé « Référence » dans DocumentsPage, GlobalSearch et
 *   les cartes ; le bot n'a aucune raison d'être le seul à la masquer.
 * - Le bot reste visible pour tout utilisateur connecté. `GET /documents` n'est
 *   pas gardé par `gedAccessMiddleware` et la page Documents figure dans la
 *   topbar de tous les rôles : lui donner un périmètre plus étroit que la page
 *   qu'il sert ne protégerait rien et retirerait un raccourci.
 */

/**
 * Rend `**gras**` sans construire de HTML.
 *
 * Le message contient la question de l'utilisateur ; le passer à
 * `dangerouslySetInnerHTML` exécutait tout balisage saisi dans le champ et
 * cassait l'affichage au premier « < » d'une question légitime.
 */
const TexteEnrichi = ({ texte }) => {
  const morceaux = String(texte ?? '').split(/(\*\*[^*]+\*\*)/g);
  return (
    <p className="text-sm whitespace-pre-wrap break-words">
      {morceaux.map((m, i) => (
        m.length > 4 && m.startsWith('**') && m.endsWith('**')
          ? <strong key={i}>{m.slice(2, -2)}</strong>
          : <React.Fragment key={i}>{m}</React.Fragment>
      ))}
    </p>
  );
};

const ACCUEIL = {
  role: 'bot',
  text: 'Bonjour ! Je suis DocuBot 🤖 — posez-moi vos questions sur les documents. '
    + 'Je reconnais les types, statuts et années réellement présents dans votre référentiel.',
};

const DocumentChatbot = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([ACCUEIL]);
  const [input, setInput] = useState('');
  const [searching, setSearching] = useState(false);
  // Vocabulaire de l'organisation. `null` = pas encore chargé ; un objet vide =
  // chargement en échec, auquel cas seule la recherche libre opère — ce que le
  // backend couvre de toute façon, `q` filtrant aussi sur le type.
  const [facettes, setFacettes] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // Échap ferme le panneau. Sans cela, la seule sortie était la croix : un
  // panneau flottant sans raccourci de fermeture se fait fermer au rechargement
  // de la page, ce qui coûte la conversation.
  useEffect(() => {
    if (!isOpen) return;
    const surTouche = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [isOpen]);

  // Facettes chargées à l'OUVERTURE et non au montage : le composant est monté
  // sur toutes les pages connectées, et une requête au montage serait payée par
  // chaque utilisateur, y compris ceux qui n'ouvrent jamais le bot.
  useEffect(() => {
    if (!isOpen || facettes) return;
    let annule = false;
    documentService.getDocuments({ page: 1, page_size: 1 })
      .then((data) => { if (!annule) setFacettes(data?.facets || {}); })
      .catch(() => { if (!annule) setFacettes({}); });
    return () => { annule = true; };
  }, [isOpen, facettes]);

  const envoyer = useCallback(async (texteBrut) => {
    const q = String(texteBrut ?? input).trim();
    if (!q || searching) return;

    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setInput('');
    setSearching(true);

    try {
      const intention = analyserQuestion(q, facettes || {});
      const params = versParametres(intention, 5);

      const data = await documentService.getDocuments(params);
      const docs = data?.documents || [];
      // Le total vient de la pagination et non de la liste : celle-ci est bornée
      // à `page_size`, et l'annoncer comme un total est une réponse fausse.
      const total = Number(data?.pagination?.total ?? docs.length);

      // Les facettes accompagnent chaque réponse : on en profite pour rafraîchir
      // le vocabulaire, qui a pu changer depuis l'ouverture du panneau.
      if (data?.facets) setFacettes(data.facets);

      const filtres = decrireFiltres(intention);
      let reponse;
      if (total === 0) {
        reponse = `Aucun document${filtres || ` correspondant à « ${q} »`}.`;
        const typesConnus = (data?.facets?.type_document || facettes?.type_document || []);
        if (intention.type && typesConnus.length) {
          reponse += `\n\nTypes présents dans votre référentiel : ${typesConnus.join(', ')}.`;
        } else {
          reponse += ' Essayez avec d\'autres mots-clés.';
        }
      } else if (intention.compter) {
        reponse = `📊 **${total}** document${total > 1 ? 's' : ''}${filtres}.`;
      } else {
        reponse = `📄 **${total}** document${total > 1 ? 's' : ''} trouvé${total > 1 ? 's' : ''}${filtres} :`;
      }

      setMessages((prev) => [...prev, {
        role: 'bot',
        text: reponse,
        documents: intention.compter ? [] : docs,
        total,
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'bot',
        text: err?.response?.status === 401
          ? '🔒 Votre session a expiré. Reconnectez-vous pour interroger le référentiel.'
          : '❌ La recherche a échoué. Réessayez dans un instant.',
      }]);
    } finally {
      setSearching(false);
    }
  }, [input, searching, facettes]);

  const surTouche = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      envoyer();
    }
  };

  /**
   * Ouvre la fiche du document dans la page Documents.
   *
   * L'identifiant passe par l'URL (`?doc=`) plutôt que par un modal rendu ici :
   * DocumentsPage porte déjà la fiche, ses dossiers et ses droits d'édition, et
   * l'adresse obtenue se transmet par un lien.
   *
   * Les paramètres en cours ne sont conservés que si l'on est DÉJÀ sur la page
   * Documents : y reporter le `?onglet=` d'un portail d'administration n'aurait
   * aucun sens.
   */
  const ouvrirDocument = (id) => {
    const surDocuments = location.pathname === '/documents';
    const params = new URLSearchParams(surDocuments ? location.search : '');
    params.set('doc', String(id));
    navigate({ pathname: '/documents', search: `?${params.toString()}` });
    setIsOpen(false);
  };

  const reinitialiser = () => {
    setMessages([ACCUEIL]);
    setInput('');
    inputRef.current?.focus();
  };

  // Suggestions bâties sur les facettes : elles montrent à l'utilisateur le
  // vocabulaire que le bot reconnaît vraiment, au lieu d'exemples génériques qui
  // pouvaient ne correspondre à aucun document.
  const suggestions = useMemo(() => {
    const s = [];
    for (const t of (facettes?.type_document || []).slice(0, 2)) s.push(`Documents de type ${t}`);
    const annee = (facettes?.annees || [])[0];
    if (annee) s.push(`Combien de documents en ${annee} ?`);
    if (!s.length) s.push('Combien de documents ?');
    return s.slice(0, 3);
  }, [facettes]);

  const ficheDocument = (doc) => (
    <button
      key={doc.id}
      type="button"
      onClick={() => ouvrirDocument(doc.id)}
      className="w-full text-left bg-white/10 rounded-xl p-3 border border-white/5 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-docuflow-secondary/60 transition-colors group"
      title={`Ouvrir la fiche ${doc.reference_mfile || ''}`}
    >
      <div className="flex items-start gap-2">
        <FileText size={14} className="text-docuflow-secondary mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white truncate">{doc.reference_mfile || `Document #${doc.id}`}</p>
          <p className="text-xs text-white/50 truncate">
            {doc.nom_entreprise}{doc.type_document ? ` — ${doc.type_document}` : ''}
          </p>
          <p className="text-[10px] text-white/30">
            {doc.annee}{doc.version ? ` • v${doc.version}` : ''}{doc.dossier_name ? ` • ${doc.dossier_name}` : ''}
          </p>
        </div>
        <ArrowUpRight size={13} className="text-white/20 group-hover:text-docuflow-secondary flex-shrink-0 transition-colors" />
      </div>
    </button>
  );

  return (
    <>
      {/* Bouton flottant — style robot, position bas-gauche */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 left-6 z-30 group"
          title="DocuBot — Assistant documentaire"
          aria-label="Ouvrir DocuBot, l'assistant documentaire"
        >
          <div className="relative">
            {/* Halo animé */}
            <div className="absolute -inset-2 rounded-full bg-gradient-to-r from-docuflow-secondary to-blue-500 opacity-30 blur-lg group-hover:opacity-50 transition-opacity animate-pulse"></div>
            {/* Robot icon */}
            <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-docuflow-secondary to-blue-600 text-white shadow-xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

      {/* Panneau de conversation. Les dimensions étaient fixes (380 × 520) : sur
          un téléphone de 360 px, le panneau débordait à droite et son champ de
          saisie sortait de l'écran. */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="DocuBot — assistant documentaire"
          className="fixed bottom-6 left-6 z-40 w-[min(380px,calc(100vw-3rem))] h-[min(520px,calc(100dvh-6rem))] rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-scale-in"
          style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}
        >
          {/* En-tête */}
          <div className="px-5 py-4 flex items-center justify-between border-b border-white/10">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-docuflow-secondary/20 flex items-center justify-center flex-shrink-0">
                <Bot size={18} className="text-docuflow-secondary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">DocuBot</p>
                <p className="text-[10px] text-white/40 truncate">Assistant documentaire</p>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {messages.length > 1 && (
                <button
                  onClick={reinitialiser}
                  className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors"
                  title="Nouvelle conversation"
                  aria-label="Effacer la conversation"
                >
                  <RotateCcw size={15} />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors"
                aria-label="Fermer DocuBot"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-docuflow-secondary text-white rounded-br-md'
                    : 'bg-white/5 text-white/90 rounded-bl-md'
                }`}>
                  <TexteEnrichi texte={msg.text} />
                  {msg.documents?.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.documents.map((doc) => ficheDocument(doc))}
                      {/* Le nombre de fiches affichées est borné : le dire évite
                          de laisser croire que la liste est complète. */}
                      {msg.total > msg.documents.length && (
                        <p className="text-[10px] text-white/40 pl-1">
                          … et {msg.total - msg.documents.length} autre{msg.total - msg.documents.length > 1 ? 's' : ''}.
                          Ouvrez un résultat pour voir la liste entière.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Suggestions issues des facettes, tant que la conversation n'a pas
                commencé. */}
            {messages.length === 1 && !searching && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => envoyer(s)}
                    className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/60 hover:bg-white/10 hover:text-white/90 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {searching && (
              <div className="flex justify-start">
                <div className="bg-white/5 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Search size={14} className="text-docuflow-secondary animate-pulse" />
                    <span className="text-sm text-white/50">Recherche…</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Saisie */}
          <div className="p-4 border-t border-white/10">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={surTouche}
                placeholder="Posez votre question…"
                aria-label="Votre question pour DocuBot"
                className="flex-1 min-w-0 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-docuflow-secondary/50 focus:bg-white/10 transition-colors"
              />
              <button
                onClick={() => envoyer()}
                disabled={!input.trim() || searching}
                className="p-2.5 rounded-xl bg-docuflow-secondary text-white hover:bg-docuflow-secondary/80 disabled:opacity-30 transition-all flex-shrink-0"
                aria-label="Envoyer la question"
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
