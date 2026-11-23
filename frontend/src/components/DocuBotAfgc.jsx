import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Send, RotateCcw, ArrowRight, MessageSquareText, Check, Loader2 } from 'lucide-react';
import api from '../services/api';
import { usePermissions } from '../hooks/usePermissions';
import { confirmer } from './Confirmer';

// ============================================================================
// DocuBot, édition AFGC : l'assistant des archives.
//
// Les questions partent au serveur (POST /api/ia/docubot), qui répond avec
// les données de l'organisation et selon les droits de la personne : où est
// un dossier, qui l'a, l'état de mes demandes, les retards, les chiffres, et
// l'aide « comment faire ». Il propose aussi des actions (enregistrer un
// retour, transmettre, annuler, demander) : elles ne partent qu'au clic, par
// les routes habituelles de l'API. La conversation reste le temps de la session
// (sessionStorage) ; « ce dont on parlait » (l'entreprise) suit, pour
// enchaîner « et qui l'a ? ».
// ============================================================================

const CLE = 'afgc.docubot';

// Les actions que DocuBot peut proposer d'exécuter : seulement ces adresses de
// l'API, qui vérifient elles-mêmes les droits de la personne.
const APPELS = [/^\/requests$/, /^\/requests\/\d+\/loan$/, /^\/requests\/\d+\/loan\/(return|rapporte)$/, /^\/requests\/\d+\/status$/];
const appelPermis = (a) => a?.type === 'appel' && ['post', 'patch'].includes(a.methode) && APPELS.some((r) => r.test(String(a.url || '')));
const lire = () => {
  try { return JSON.parse(sessionStorage.getItem(CLE)) || null; } catch { return null; }
};
const ecrire = (v) => {
  try { sessionStorage.setItem(CLE, JSON.stringify(v)); } catch { /* sans stockage : la conversation vit en mémoire */ }
};

/** **gras**, retours à la ligne et puces, sans jamais construire de HTML. */
const Texte = ({ texte, className = '' }) => (
  <div className={`text-sm leading-relaxed text-slate-800 ${className}`}>
    {String(texte ?? '').split('\n').map((ligne, i) => (
      <p key={i} className={ligne.startsWith('• ') ? 'pl-3 -indent-3' : i ? 'mt-1' : ''}>
        {ligne.split(/(\*\*[^*]+\*\*)/g).map((m, j) => (
          m.length > 4 && m.startsWith('**') && m.endsWith('**')
            ? <strong key={j} className="font-semibold text-slate-950">{m.slice(2, -2)}</strong>
            : <React.Fragment key={j}>{m}</React.Fragment>
        ))}
      </p>
    ))}
  </div>
);

const TONS = {
  vert: 'border-l-[#2C9C0A]', ambre: 'border-l-amber-500', rouge: 'border-l-red-500', bleu: 'border-l-slate-500', gris: 'border-l-slate-300',
};

const Fiche = ({ e }) => (
  <div className={`rounded-md border border-slate-200 border-l-4 ${TONS[e.ton] || TONS.gris} bg-white px-3 py-2`}>
    <div className="text-sm font-semibold text-slate-900">{e.titre}</div>
    {e.lignes?.map((l, i) => <Texte key={i} texte={l} className="text-[13px] text-slate-600" />)}
    {e.note && <p className="mt-1 text-xs text-amber-800">{e.note}</p>}
    {e.lien && (
      <a href={e.lien} target={/^https?:/.test(e.lien) ? '_blank' : undefined} rel="noreferrer"
        className="mt-1 inline-block text-xs font-semibold text-slate-700 underline hover:text-slate-900">
        {e.libelleLien || 'Ouvrir'}
      </a>
    )}
  </div>
);

// Ce que la personne voulait, quand la réponse n'allait pas (DocuBot en apprend).
const VOULAIT = [
  ['ou_est', 'Trouver un dossier'], ['qui_a', 'Savoir qui a un dossier'], ['mes_demandes', 'Suivre mes demandes'],
  ['retards', 'Retards, dossiers à rendre'], ['chiffres', 'Des chiffres'], ['aide', 'Comment faire'], ['autre', 'Autre chose'],
];
const ETAPES = {
  chercher_dossier: 'recherche du dossier', qui_a_le_dossier: 'dossiers sortis', mes_demandes: 'vos demandes', retards: 'retards',
  travail_du_jour: 'travail du jour', chiffres: 'chiffres', entrees_semaine: 'entrées de la semaine', aide: 'procédures',
};

/** « Utile ? Oui · Non » : chaque avis entraîne DocuBot. */
const Avis = ({ m, onAvis }) => {
  if (!m.echange) return null;
  if (m.avis === 'oui') return <p className="text-[11px] text-slate-400">Merci, c'est noté.</p>;
  if (m.avis === 'appris') return <p className="text-[11px] text-slate-400">Merci : DocuBot en tient compte dès maintenant.</p>;
  if (m.avis === 'non') {
    return (
      <div className="text-[11px] text-slate-500">
        Que vouliez-vous ?{' '}
        {VOULAIT.map(([cle, libelle]) => (
          <button key={cle} type="button" onClick={() => onAvis(m, false, cle)} className="mr-1.5 mt-1 px-2 py-0.5 rounded-full border border-slate-300 bg-white hover:border-slate-500">{libelle}</button>
        ))}
      </div>
    );
  }
  return (
    <p className="text-[11px] text-slate-400">
      Utile ?{' '}
      <button type="button" onClick={() => onAvis(m, true)} className="underline hover:text-slate-700">Oui</button>
      {' · '}
      <button type="button" onClick={() => onAvis(m, false)} className="underline hover:text-slate-700">Non</button>
    </p>
  );
};

/** Le point du matin (archive) : ce que DocuBot a relevé sans qu'on le lui demande. */
const Veille = ({ veille, onLien }) => {
  if (!veille) return null;
  return (
    <div className="space-y-2">
      <Texte texte={veille.texte} />
      {veille.items.map((i) => (
        <button key={i.cle} type="button" onClick={() => onLien(i.lien)}
          className={`w-full text-left rounded-md border border-slate-200 border-l-4 ${i.niveau === 'alerte' ? 'border-l-red-500' : 'border-l-amber-500'} bg-white px-3 py-2 hover:border-slate-400`}>
          <div className="text-sm font-semibold text-slate-900">{i.titre}</div>
          <div className="text-[13px] text-slate-600">{i.detail}</div>
          {i.exemples.length > 0 && <ul className="mt-1 text-[12px] text-slate-500 list-disc pl-4">{i.exemples.map((e) => <li key={e}>{e}</li>)}</ul>}
        </button>
      ))}
    </div>
  );
};

const DocuBotAfgc = () => {
  const navigate = useNavigate();
  const sauve = lire();
  const [ouvert, setOuvert] = useState(false);
  const [messages, setMessages] = useState(sauve?.messages || []);
  const [contexte, setContexte] = useState(sauve?.contexte || {});
  const [accueil, setAccueil] = useState(null);
  const [saisie, setSaisie] = useState('');
  const [attente, setAttente] = useState(false);
  const [longue, setLongue] = useState(false);
  const [veille, setVeille] = useState(null);
  const fin = useRef(null);
  const champ = useRef(null);

  useEffect(() => { ecrire({ messages: messages.slice(-40), contexte }); }, [messages, contexte]);
  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, attente, ouvert]);
  useEffect(() => { if (ouvert) champ.current?.focus(); }, [ouvert]);

  // Les suggestions d'accueil dépendent du rôle : chargées à la première ouverture.
  useEffect(() => {
    if (!ouvert || accueil) return;
    api.get('/ia/docubot').then((r) => setAccueil(r.data)).catch(() => setAccueil({ suggestions: [] }));
  }, [ouvert, accueil]);

  // La veille du matin, pour l'archive : chargée une fois par session (10 min), son nombre d'alertes sur le bouton.
  const { charge: droitsCharges, can } = usePermissions();
  const archive = droitsCharges && can('requests.process');
  useEffect(() => {
    if (!archive) return; // la veille est celle de l'archive : un agent n'a rien à charger
    let frais = null;
    try { frais = JSON.parse(sessionStorage.getItem('afgc.docubot.veille')); } catch { /* sans stockage */ }
    if (frais && Date.now() - frais.le < 10 * 60 * 1000) { setVeille(frais.veille); return; }
    api.get('/ia/docubot/veille').then((r) => {
      setVeille(r.data);
      try { sessionStorage.setItem('afgc.docubot.veille', JSON.stringify({ le: Date.now(), veille: r.data })); } catch { /* sans stockage */ }
    }).catch(() => setVeille(null));
  }, [archive]);

  useEffect(() => {
    if (!ouvert) return undefined;
    const surTouche = (e) => { if (e.key === 'Escape') setOuvert(false); };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [ouvert]);

  // Ouvrir DocuBot depuis ailleurs (raccourci, lien) : window.dispatchEvent(new CustomEvent('afgc:docubot', { detail: 'question' })).
  const envoyer = useCallback(async (texte) => {
    const q = String(texte ?? '').trim();
    if (!q || attente) return;
    setMessages((m) => [...m, { de: 'moi', texte: q }]);
    setSaisie('');
    setAttente(true);
    const minuteur = setTimeout(() => setLongue(true), 4000);
    try {
      // Raisonner (Ollama, sans carte graphique) peut prendre une minute.
      const { data } = await api.post('/ia/docubot', { question: q, contexte }, { timeout: 200000 });
      setMessages((m) => [...m, { de: 'bot', ...data }]);
      if (data.contexte) setContexte((c) => ({ ...c, ...data.contexte }));
    } catch (err) {
      setMessages((m) => [...m, {
        de: 'bot',
        texte: err?.response?.status === 401 ? 'Votre session a expiré : reconnectez-vous.' : 'Je n\'ai pas pu répondre. Réessayez dans un instant.',
      }]);
    } finally {
      clearTimeout(minuteur);
      setLongue(false);
      setAttente(false);
    }
  }, [attente, contexte]);

  // L'avis sur une réponse : enregistré, et DocuBot se réentraîne.
  const donnerAvis = async (m, utile, voulait = null) => {
    const marque = (avis) => setMessages((l) => l.map((x) => (x === m ? { ...x, avis } : x)));
    if (!utile && !voulait) { marque('non'); return; }
    marque(utile ? 'oui' : 'appris');
    try { await api.post(`/ia/docubot/echanges/${m.echange}/avis`, { utile, voulait }); } catch { /* l'avis n'empêche rien */ }
  };

  useEffect(() => {
    const surDemande = (e) => { setOuvert(true); if (typeof e.detail === 'string' && e.detail) envoyer(e.detail); };
    window.addEventListener('afgc:docubot', surDemande);
    return () => window.removeEventListener('afgc:docubot', surDemande);
  }, [envoyer]);

  // Un bouton « appel » : DocuBot fait l'action au clic, puis dit ce qui s'est passé.
  const [enCours, setEnCours] = useState(null);
  const executer = async (m, a) => {
    if (!appelPermis(a) || enCours) return;
    if (a.danger && !(await confirmer({ message: `${a.libelle} ?`, libelle: 'Confirmer', type: 'danger' }))) return;
    setEnCours(a);
    try {
      await api[a.methode](a.url, a.corps || {});
      setMessages((l) => [...l.map((x) => (x === m ? { ...x, fait: a.libelle } : x)), { de: 'bot', texte: a.succes || 'C\'est fait.' }]);
    } catch (err) {
      const raison = err?.response?.data?.message;
      setMessages((l) => [...l, { de: 'bot', texte: raison ? `Je n'ai pas pu le faire : ${raison}` : 'Je n\'ai pas pu le faire. Réessayez dans un instant.' }]);
    } finally {
      setEnCours(null);
    }
  };

  const agir = (a, m = null) => {
    if (a.type === 'appel') { if (m) executer(m, a); return; }
    if (a.type === 'demander') navigate(`/demandes/nouvelle?q=${encodeURIComponent(a.saisie || '')}`);
    else if (a.vers) navigate(a.vers);
    setOuvert(false);
  };

  const recommencer = () => { setMessages([]); setContexte({}); champ.current?.focus(); };
  const derniere = messages[messages.length - 1];

  return (
    <>
      {!ouvert && (
        <button type="button" onClick={() => setOuvert(true)}
          className="fixed bottom-[68px] right-3 sm:bottom-[80px] sm:right-5 z-30 h-11 sm:h-12 pl-3.5 pr-4 rounded-full bg-slate-800 text-white shadow-md hover:bg-slate-900 inline-flex items-center gap-2 text-sm font-semibold"
          aria-label="Ouvrir DocuBot, l'assistant des archives" title="DocuBot : posez une question sur les dossiers">
          <MessageSquareText size={18} /> <span className="hidden sm:inline">DocuBot</span>
          {veille?.alertes > 0 && <span className="ml-0.5 min-w-5 h-5 px-1 rounded-full bg-red-600 text-[11px] font-bold flex items-center justify-center" title="Points à voir ce matin">{veille.alertes}</span>}
        </button>
      )}

      {ouvert && (
        <section role="dialog" aria-label="DocuBot, assistant des archives"
          className="fixed z-40 inset-x-2 bottom-2 top-16 sm:inset-auto sm:right-5 sm:bottom-5 sm:w-[400px] sm:h-[600px] sm:max-h-[calc(100vh-6rem)] flex flex-col rounded-lg border border-slate-200 bg-slate-50 shadow-xl animate-fade-in">
          <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white rounded-t-lg">
            <span className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center flex-shrink-0"><MessageSquareText size={16} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-slate-900 leading-tight">DocuBot</h2>
              <p className="text-xs text-slate-500 leading-tight">Assistant des archives de l'AFGC</p>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={recommencer} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Nouvelle conversation" aria-label="Nouvelle conversation"><RotateCcw size={16} /></button>
            )}
            <button type="button" onClick={() => setOuvert(false)} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Fermer (Échap)" aria-label="Fermer"><X size={18} /></button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" aria-live="polite">
            {messages.length === 0 && (
              <div>
                <Texte texte={'Bonjour ! Je réponds sur les **dossiers** et les **demandes** : où se trouve un dossier, qui l\'a, où en est une demande, ce qui est en retard… et comment faire dans l\'application. Je peux aussi **agir** pour vous : transmettre un dossier, enregistrer un retour, demander ou annuler, toujours après votre clic.'} />
                <p className="mt-2 text-xs text-slate-500">Écrivez comme vous parlez, par exemple « où est le dossier Credo BTP ? », puis « il revient quand ? ».</p>
                {veille?.items?.length > 0 && <div className="mt-4"><Veille veille={veille} onLien={(vers) => agir({ vers })} /></div>}
              </div>
            )}
            {messages.map((m, i) => (m.de === 'moi' ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] rounded-lg rounded-br-sm bg-slate-800 text-white text-sm px-3 py-2 whitespace-pre-wrap break-words">{m.texte}</p>
              </div>
            ) : (
              <div key={i} className="space-y-2">
                <Texte texte={m.texte} />
                {m.source === 'ollama' && <p className="text-[11px] text-slate-400">Rédigé par le modèle de langue de l'AFGC, à partir des procédures de l'archive.</p>}
                {m.source === 'agent' && m.etapes?.length > 0 && (
                  <p className="text-[11px] text-slate-400">A consulté : {[...new Set(m.etapes)].map((e) => ETAPES[e] || e).join(', ')}.</p>
                )}
                {m.elements?.length > 0 && <div className="space-y-1.5">{m.elements.map((e, j) => <Fiche key={j} e={e} />)}</div>}
                {m.fait && <p className="text-xs font-semibold text-[#2C9C0A] inline-flex items-center gap-1"><Check size={14} /> Fait : {m.fait}</p>}
                {m.actions?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {m.actions.filter((a) => a.type !== 'appel' || (!m.fait && appelPermis(a))).map((a, j) => (
                      <button key={j} type="button" onClick={() => agir(a, m)} disabled={a.type === 'appel' && Boolean(enCours)}
                        className={`px-3 py-1.5 rounded-md text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 ${a.type === 'appel' ? (a.danger ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-slate-800 text-white hover:bg-slate-900') : a.type === 'demander' ? 'bg-[#2C9C0A] text-white hover:opacity-90' : 'border border-slate-300 bg-white text-slate-800 hover:border-slate-500'}`}>
                        {a.libelle} {a.type === 'appel' ? (enCours === a ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />) : <ArrowRight size={14} />}
                      </button>
                    ))}
                  </div>
                )}
                <Avis m={m} onAvis={donnerAvis} />
              </div>
            )))}
            {attente && (
              <div className="flex items-center gap-1 text-slate-400" aria-label="DocuBot écrit">
                {[0, 1, 2].map((k) => <span key={k} className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" style={{ animationDelay: `${k * 0.15}s` }} />)}
                {longue && <span className="ml-2 text-xs">DocuBot réfléchit et consulte les archives…</span>}
              </div>
            )}
            {!attente && (() => {
              const proposees = derniere?.de === 'bot' && derniere.suggestions?.length ? derniere.suggestions : messages.length === 0 ? accueil?.suggestions || [] : [];
              return proposees.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {proposees.map((s) => (
                    <button key={s} type="button" onClick={() => envoyer(s)}
                      className="px-2.5 py-1 rounded-full border border-slate-300 bg-white text-xs text-slate-700 hover:border-slate-500 hover:text-slate-900">
                      {s}
                    </button>
                  ))}
                </div>
              );
            })()}
            <div ref={fin} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); envoyer(saisie); }} className="flex items-end gap-2 p-3 border-t border-slate-200 bg-white rounded-b-lg">
            <textarea ref={champ} value={saisie} rows={1} maxLength={500}
              onChange={(e) => setSaisie(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); envoyer(saisie); } }}
              placeholder="Votre question…"
              className="flex-1 resize-none max-h-28 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-500"
              aria-label="Votre question à DocuBot" />
            <button type="submit" disabled={!saisie.trim() || attente}
              className="h-9 w-9 rounded-md bg-slate-800 text-white flex items-center justify-center disabled:opacity-40 hover:bg-slate-900" aria-label="Envoyer">
              <Send size={16} />
            </button>
          </form>
        </section>
      )}
    </>
  );
};

export default DocuBotAfgc;
