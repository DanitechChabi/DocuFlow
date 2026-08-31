import React, { useState, useEffect } from 'react';
import { ShieldCheck, Lock, X, Trash2, AlertTriangle, Plus, Crown, Users, User } from 'lucide-react';
import { documentService } from '../services/documentService';
import { roleService } from '../services/roleService';
import { groupService } from '../services/groupService';
import { userService } from '../services/userService';

// ============================================================================
// FolderAclPanel — périmètre d'accès d'un dossier (jalon J5).
//
// LA QUESTION À LAQUELLE CE PANNEAU RÉPOND : « qui peut consulter ou modifier
// CE dossier ? » — la permission RBAC dit ce qu'on peut faire, l'ACL dit sur
// quoi. Poser la PREMIÈRE ACL d'un dossier restreint tout son sous-arbre :
// le panneau l'annonce AVANT le geste (le serveur le redit après).
//
// Les sujets viennent des référentiels du tenant : rôles (système et
// personnalisés), groupes, utilisateurs. Le niveau : consulter (read),
// modifier (write) — inclut consulter —, administrer (manage) — inclut
// modifier et gérer les ACL du sous-arbre.
// ============================================================================

const NIVEAUX = [
  { value: 'read', label: 'Consulter', texte: 'voir les documents du dossier' },
  { value: 'write', label: 'Modifier', texte: 'consulter, verser et déplacer dedans' },
  { value: 'manage', label: 'Administrer', texte: 'modifier, et gérer les accès du sous-arbre' },
];

const libelleNiveau = (n) => NIVEAUX.find((x) => x.value === n)?.label || n;

// Le glyphe porte le canal par lequel l'accès arrive : le rôle couronne
// l'organisation, le groupe rassemble, l'utilisateur est nommé.
const ICONE_TYPE = { role: Crown, group: Users, user: User };

const FolderAclPanel = ({ dossier, onFinish, onChange }) => {
  const [acls, setAcls] = useState(null);
  const [restreint, setRestreint] = useState(false);
  const [erreur, setErreur] = useState('');
  const [occupation, setOccupation] = useState(false);
  const [avertissement, setAvertissement] = useState('');

  // Sujets disponibles pour une nouvelle ACL.
  const [roles, setRoles] = useState([]);
  const [groupes, setGroupes] = useState([]);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [type, setType] = useState('role');
  const [sujet, setSujet] = useState('');
  const [niveau, setNiveau] = useState('read');

  const recharger = async () => {
    try {
      const data = await documentService.getFolderAcls(dossier.id);
      setAcls(data.acls || []);
      setRestreint(Boolean(data.restreint));
    } catch (err) {
      setErreur(err.response?.data?.message || 'Impossible de charger les accès du dossier.');
      setAcls([]);
    }
  };

  useEffect(() => {
    recharger();
    // Les référentiels de sujets ne dépendent pas du dossier : un seul chargement.
    Promise.all([
      roleService.getRoles().catch(() => []),
      groupService.getGroups().catch(() => []),
      userService.getAllUsers().catch(() => []),
    ]).then(([r, g, u]) => {
      // Les réponses peuvent être le tableau lui-même ou un objet { roles }.
      setRoles(Array.isArray(r) ? r : (r?.roles || []));
      setGroupes(Array.isArray(g) ? g : (g?.groups || []));
      setUtilisateurs(Array.isArray(u) ? u : (u?.users || []));
    });
  }, [dossier.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const poser = async () => {
    if (!sujet) return;
    setOccupation(true);
    setErreur('');
    try {
      const rep = await documentService.setFolderAcl(dossier.id, {
        subject_type: type,
        subject_id: sujet,
        level: niveau,
      });
      // La première ACL est le geste qui ferme : le dire APRÈS coup ne rend
      // rien — mais le redire ici couvre le cas où l'utilisateur n'a pas lu
      // l'avertissement préalable.
      if (rep.premiere_acl) setAvertissement(rep.message);
      else setAvertissement('');
      setSujet('');
      await recharger();
      onChange?.(); // le parent recharge l'arbre (badges « restreint »)
    } catch (err) {
      setErreur(err.response?.data?.message || 'Impossible de poser cet accès.');
    } finally {
      setOccupation(false);
    }
  };

  const retirer = async (acl) => {
    setOccupation(true);
    setErreur('');
    try {
      await documentService.deleteFolderAcl(dossier.id, acl.subject_type, acl.subject_id);
      await recharger();
      onChange?.(); // le parent recharge l'arbre (badges « restreint »)
    } catch (err) {
      setErreur(err.response?.data?.message || 'Impossible de retirer cet accès.');
    } finally {
      setOccupation(false);
    }
  };

  const sujetsSelonType = type === 'role'
    ? roles.map((r) => ({ id: r.key, nom: `${r.embleme ? r.embleme + ' ' : ''}${r.name || r.key}` }))
    : type === 'group'
      ? groupes.map((g) => ({ id: g.id, nom: g.name }))
      : utilisateurs.map((u) => ({ id: u.id, nom: `${u.full_name || u.username}${u.username && u.full_name ? ` (${u.username})` : ''}` }));

  return (
    <div data-testid="panneau-perimetres" className="surface-sunken rounded-lg p-3 space-y-3 border border-[var(--df-border)]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck size={15} className="text-docuflow-secondary shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-700 truncate">
              Périmètre de « {dossier.name} »
            </p>
            <p className="text-[11px] text-slate-500">
              {restreint
                ? 'Restreint : seuls les sujets ci-dessous (et leurs gestionnaires) y accèdent — sous-arbre compris.'
                : 'Ouvert : tous les porteurs des permissions GED y accèdent.'}
            </p>
          </div>
        </div>
        {restreint && <span className="badge-warn shrink-0"><Lock size={11} /> Restreint</span>}
      </div>

      {/* Liste des ACL posées */}
      {acls === null ? (
        <p className="text-xs text-slate-400">Chargement…</p>
      ) : acls.length === 0 ? (
        <p className="text-xs text-slate-400">
          Aucun accès restreint posé.
        </p>
      ) : (
        <ul className="space-y-1">
          {acls.map((acl) => (
            <li key={`${acl.subject_type}:${acl.subject_id}`}
              className="flex items-center gap-2 text-xs bg-white/70 rounded-lg px-2 py-1.5 border border-[var(--df-border)]">
              {(() => {
                const Icone = ICONE_TYPE[acl.subject_type];
                return Icone
                  ? <Icone size={12} className="text-slate-400 shrink-0" aria-hidden />
                  : null;
              })()}
              <span className="font-semibold text-slate-700 truncate flex-1">
                {acl.subject_name || acl.subject_id}
              </span>
              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-[var(--df-accent-10)] text-docuflow-secondary font-semibold">
                {libelleNiveau(acl.level)}
              </span>
              <button
                type="button"
                onClick={() => retirer(acl)}
                disabled={occupation}
                className="btn-icon btn-sm btn-ghost text-slate-400 hover:text-[var(--df-danger)]"
                title="Retirer cet accès"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Poser un accès */}
      <div className="space-y-2 pt-2 border-t border-[var(--df-border)]">
        {acls && acls.length === 0 && (
          <p className="text-[11px] text-[var(--df-warn)] flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            Poser le premier accès RESTREINT ce dossier et tout son sous-arbre :
            les autres utilisateurs ne le verront plus. Retirer le dernier accès le rouvre.
          </p>
        )}
        {avertissement && (
          <p className="text-[11px] text-[var(--df-warn)] flex items-start gap-1.5">
            <Lock size={13} className="shrink-0 mt-0.5" /> {avertissement}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            className="input-premium !h-8 text-xs"
            value={type}
            onChange={(e) => { setType(e.target.value); setSujet(''); }}
            aria-label="Type de sujet"
            disabled={occupation}
          >
            <option value="role">Rôle</option>
            <option value="group">Groupe</option>
            <option value="user">Utilisateur</option>
          </select>
          <select
            className="input-premium flex-1 min-w-[9rem] !h-8 text-xs"
            value={sujet}
            onChange={(e) => setSujet(e.target.value)}
            aria-label="Sujet"
            disabled={occupation || sujetsSelonType.length === 0}
          >
            <option value="">
              {sujetsSelonType.length === 0 ? '— aucun disponible —' : 'Choisir…'}
            </option>
            {sujetsSelonType.map((s) => (
              <option key={s.id} value={s.id}>{s.nom}</option>
            ))}
          </select>
          <select
            className="input-premium !h-8 text-xs"
            value={niveau}
            onChange={(e) => setNiveau(e.target.value)}
            aria-label="Niveau d'accès"
            disabled={occupation}
          >
            {NIVEAUX.map((n) => (
              <option key={n.value} value={n.value} title={n.texte}>{n.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={poser}
            disabled={occupation || !sujet}
            className="btn btn-sm btn-primary"
            title="Poser cet accès"
          >
            <Plus size={13} />
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          {NIVEAUX.find((n) => n.value === niveau)?.texte}
        </p>
      </div>

      {erreur && <p className="text-[11px] text-[var(--df-danger)]">{erreur}</p>}

      <div className="flex justify-end">
        <button type="button" onClick={onFinish} className="btn btn-sm btn-ghost">
          <X size={13} /> Fermer
        </button>
      </div>
    </div>
  );
};

export default FolderAclPanel;
