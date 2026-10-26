import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Loader2, Reply, Pencil, Trash2, Send } from 'lucide-react';
import { collaborationService } from '../../services/collaborationService';
import { toast } from '../Toast';

/**
 * Carte « Commentaires » de la fiche (migration 033) : fil avec réponses sur
 * un niveau, @mentions (proposées parmi les personnes qui peuvent lire le
 * document), modification et suppression de ses propres commentaires.
 */
const quand = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');

/** Texte d'un commentaire, @mentions mises en valeur (sans HTML injecté). */
const Texte = ({ contenu }) => (
  <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
    {String(contenu).split(/(@[\p{L}\p{N}._+-]{2,50})/u).map((morceau, i) => (morceau.startsWith('@')
      ? <span key={i} className="font-semibold text-docuflow-secondary">{morceau}</span>
      : <React.Fragment key={i}>{morceau}</React.Fragment>))}
  </p>
);

/** Zone de saisie avec proposition de mentions sur « @ ». */
const Saisie = ({ documentId, valeurInitiale = '', placeholder, onEnvoyer, onAnnuler, libelle = 'Publier' }) => {
  const [texte, setTexte] = useState(valeurInitiale);
  const [envoi, setEnvoi] = useState(false);
  const [propositions, setPropositions] = useState([]);
  const zone = useRef(null);

  const motCourant = () => {
    const el = zone.current;
    const avant = texte.slice(0, el ? el.selectionStart : texte.length);
    const m = avant.match(/@([\p{L}\p{N}._+-]{0,50})$/u);
    return m ? m[1] : null;
  };

  useEffect(() => {
    const q = motCourant();
    if (q === null) { setPropositions([]); return undefined; }
    const minuteur = setTimeout(() => {
      collaborationService.mentionnables(documentId, q).then((l) => setPropositions(l.slice(0, 6))).catch(() => setPropositions([]));
    }, 200);
    return () => clearTimeout(minuteur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texte, documentId]);

  const choisir = (u) => {
    const el = zone.current;
    const curseur = el ? el.selectionStart : texte.length;
    const avant = texte.slice(0, curseur).replace(/@([\p{L}\p{N}._+-]{0,50})$/u, `@${u.username} `);
    setTexte(avant + texte.slice(curseur));
    setPropositions([]);
    setTimeout(() => el?.focus(), 0);
  };

  const envoyer = async (e) => {
    e.preventDefault();
    if (!texte.trim()) return;
    setEnvoi(true);
    try {
      await onEnvoyer(texte.trim());
      setTexte('');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <form onSubmit={envoyer} className="relative space-y-2">
      <textarea ref={zone} value={texte} onChange={(e) => setTexte(e.target.value)} maxLength={5000}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) envoyer(e); }}
        className="input-premium text-sm min-h-[60px]" placeholder={placeholder} />
      {propositions.length > 0 && (
        <ul className="absolute z-10 left-0 right-0 top-full -mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {propositions.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => choisir(u)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                <span className="font-semibold">{u.nom}</span> <span className="text-slate-400">@{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        {onAnnuler && <button type="button" onClick={onAnnuler} className="btn btn-secondary btn-sm">Annuler</button>}
        <button type="submit" disabled={envoi || !texte.trim()} className="btn btn-primary btn-sm">
          {envoi ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {libelle}
        </button>
      </div>
    </form>
  );
};

const Commentaire = ({ c, documentId, onChange, onRepondre }) => {
  const [edition, setEdition] = useState(false);
  if (c.supprime) {
    return <p className="text-xs italic text-slate-400 py-1">Commentaire supprimé{c.supprime_at ? ` le ${quand(c.supprime_at)}` : ''}.</p>;
  }
  const supprimer = async () => {
    if (!window.confirm('Supprimer ce commentaire ?')) return;
    try {
      await collaborationService.supprimerCommentaire(documentId, c.id);
      onChange();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Suppression impossible');
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs"><span className="font-bold text-slate-800">{c.auteur.nom}</span> <span className="text-slate-400">{quand(c.created_at)}{c.modifie_at ? ' · modifié' : ''}</span></p>
        <div className="flex items-center gap-1 text-slate-400">
          {onRepondre && <button type="button" onClick={onRepondre} className="hover:text-docuflow-secondary" title="Répondre" aria-label="Répondre"><Reply size={13} /></button>}
          {c.est_auteur && <button type="button" onClick={() => setEdition(true)} className="hover:text-docuflow-secondary" title="Modifier" aria-label="Modifier"><Pencil size={12} /></button>}
          {c.est_auteur && <button type="button" onClick={supprimer} className="hover:text-red-600" title="Supprimer" aria-label="Supprimer"><Trash2 size={12} /></button>}
        </div>
      </div>
      {edition ? (
        <Saisie documentId={documentId} valeurInitiale={c.contenu} libelle="Enregistrer" onAnnuler={() => setEdition(false)}
          onEnvoyer={async (texte) => {
            try {
              await collaborationService.modifierCommentaire(documentId, c.id, texte);
              setEdition(false);
              onChange();
            } catch (err) { toast.error(err.response?.data?.message || 'Modification impossible'); }
          }} />
      ) : <Texte contenu={c.contenu} />}
    </div>
  );
};

const CommentairesDocument = ({ documentId }) => {
  const [fil, setFil] = useState(null);
  const [reponseA, setReponseA] = useState(null);

  const charger = useCallback(() => {
    collaborationService.commentaires(documentId).then(setFil).catch(() => setFil({ commentaires: [], total: 0, indisponible: true }));
  }, [documentId]);
  useEffect(() => { charger(); }, [charger]);

  const publier = async (texte, parentId = null) => {
    try {
      await collaborationService.commenter(documentId, texte, parentId);
      setReponseA(null);
      charger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Publication impossible');
      throw err;
    }
  };

  if (fil?.indisponible) return null;
  return (
    <div className="glass-card-premium p-5 space-y-3" data-tour="commentaires-document">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
        <MessageSquare size={14} /> Commentaires{fil ? ` (${fil.total})` : ''}
      </h3>
      {!fil ? <div className="h-14 skeleton rounded-xl" /> : (
        <>
          {fil.commentaires.length === 0 && <p className="text-xs text-slate-500">Aucun commentaire. Mentionnez un collègue avec @ pour le prévenir.</p>}
          <div className="space-y-3">
            {fil.commentaires.map((c) => (
              <div key={c.id} className="space-y-2">
                <Commentaire c={c} documentId={documentId} onChange={charger} onRepondre={c.supprime ? null : () => setReponseA(c.id)} />
                {(c.reponses.length > 0 || reponseA === c.id) && (
                  <div className="pl-4 border-l-2 border-slate-100 space-y-2">
                    {c.reponses.map((r) => <Commentaire key={r.id} c={r} documentId={documentId} onChange={charger} />)}
                    {reponseA === c.id && (
                      <Saisie documentId={documentId} placeholder="Votre réponse…" libelle="Répondre" onAnnuler={() => setReponseA(null)}
                        onEnvoyer={(texte) => publier(texte, c.id)} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Saisie documentId={documentId} placeholder="Ajouter un commentaire… (@ pour mentionner, Ctrl + Entrée pour publier)" onEnvoyer={(texte) => publier(texte)} />
        </>
      )}
    </div>
  );
};

export default CommentairesDocument;
