import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, Search, UserPlus, KeyRound, UserX, UserCheck, Loader2, Copy, X, AlertTriangle, Pencil, Check } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { comptesService } from '../../../services/comptesService';
import { userService } from '../../../services/userService';
import { sectionService } from '../../../services/sectionService';
import { authService } from '../../../services/authService';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, Chargement } from './elements';
import { dateCourte } from './vocabulaire';

// ============================================================================
// Comptes : la liste des agents et les gestes de l'administrateur, sans
// jargon. Rôle et département se changent dans la ligne ; un agent qui part
// est DÉSACTIVÉ (son historique reste) ; un oubli de mot de passe se règle
// par un mot de passe provisoire, montré une seule fois.
// ============================================================================

const ROLE_AIDE = {
  demandeur: 'demande des dossiers',
  archiviste: 'traite les demandes, gère les entrées et les armoires',
  admin: 'tout, y compris les comptes et les réglages',
};

const ComptesAfgc = () => {
  useTitrePage('Comptes');
  const moi = authService.getCurrentUser();
  const [donnees, setDonnees] = useState(null);
  const [sections, setSections] = useState([]);
  const [q, setQ] = useState('');
  const [filtre, setFiltre] = useState('actifs');
  const [geste, setGeste] = useState(null);
  const [mdp, setMdp] = useState(null); // { nom, mot_de_passe }
  const [confirmer, setConfirmer] = useState(null); // compte à désactiver
  const [ajout, setAjout] = useState(false);
  const [edite, setEdite] = useState(null); // { id, full_name, email }

  const charger = useCallback(() => comptesService.lister().then(setDonnees).catch((e) => { setDonnees({ comptes: [], roles: [] }); toast.error(e.response?.data?.message || 'Comptes illisibles.'); }), []);
  useEffect(() => {
    charger();
    sectionService.getSections().then((l) => setSections((Array.isArray(l) ? l : []).map((x) => x.name || x))).catch(() => setSections([]));
  }, [charger]);

  const libelleRole = useCallback((cle) => donnees?.roles.find((r) => r.cle === cle)?.libelle || cle, [donnees]);
  const vus = useMemo(() => (donnees?.comptes || []).filter((c) => {
    if (filtre === 'actifs' && c.desactive_le) return false;
    if (filtre === 'desactives' && !c.desactive_le) return false;
    if (filtre !== 'actifs' && filtre !== 'desactives' && filtre !== 'tous' && c.role !== filtre) return false;
    const s = q.trim().toLowerCase();
    return !s || [c.full_name, c.username, c.email, c.section].some((x) => x && x.toLowerCase().includes(s));
  }), [donnees, q, filtre]);

  const faire = async (cle, fn, succes) => {
    setGeste(cle);
    try { const r = await fn(); if (succes) toast.success(typeof succes === 'function' ? succes(r) : succes); await charger(); return r; } catch (e) { toast.error(e.response?.data?.message || 'Le changement n\'a pas pu être enregistré.'); return null; } finally { setGeste(null); }
  };

  const actifs = (donnees?.comptes || []).filter((c) => !c.desactive_le).length;
  const desactives = (donnees?.comptes || []).length - actifs;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <EnTete titre="Comptes" icone={Users} aide="Les agents qui utilisent l'application : leur rôle, leur département, et les gestes de l'administrateur.">
        <button type="button" onClick={() => setAjout(true)} className="px-4 py-2.5 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-2">
          <UserPlus size={16} /> Ajouter un agent
        </button>
      </EnTete>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, identifiant, adresse, département…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-semibold focus:outline-none focus:border-docuflow-secondary" />
        </div>
        <div className="inline-flex flex-wrap p-1 rounded-2xl bg-slate-100">
          {[['actifs', `Actifs (${actifs})`], ...(donnees?.roles || []).map((r) => [r.cle, r.libelle]), ['desactives', `Désactivés (${desactives})`], ['tous', 'Tous']].map(([cle, libelle]) => (
            <button key={cle} type="button" onClick={() => setFiltre(cle)}
              className={`px-3 py-1.5 rounded-xl text-sm font-bold ${filtre === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{libelle}</button>
          ))}
        </div>
      </div>

      {donnees === null ? <Chargement /> : (
        <div className="glass-card-premium rounded-3xl overflow-hidden">
          {vus.length ? (
            <ul className="divide-y divide-slate-100">
              {vus.map((c) => {
                const moiMeme = c.id === moi?.id;
                return (
                  <li key={c.id} className={`px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-3 ${c.desactive_le ? 'bg-slate-50' : ''}`}>
                    <span className={`w-11 h-11 rounded-full flex items-center justify-center font-black text-white flex-shrink-0 ${c.desactive_le ? 'bg-slate-400' : 'bg-docuflow-secondary'}`}>
                      {(c.full_name || c.username || '?').trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1 basis-56">
                      {edite?.id === c.id ? (
                        <div className="flex flex-wrap gap-2">
                          <input value={edite.full_name} onChange={(e) => setEdite((x) => ({ ...x, full_name: e.target.value }))} className="px-2.5 py-1.5 rounded-lg border-2 border-slate-200 text-sm font-bold" aria-label="Nom complet" />
                          <input value={edite.email} onChange={(e) => setEdite((x) => ({ ...x, email: e.target.value }))} className="px-2.5 py-1.5 rounded-lg border-2 border-slate-200 text-sm flex-1 min-w-[180px]" aria-label="Adresse" />
                          <button type="button" onClick={async () => { if (await faire(`e-${c.id}`, () => comptesService.modifier(c.id, { full_name: edite.full_name, email: edite.email }), 'Compte mis à jour.')) setEdite(null); }}
                            className="p-2 rounded-lg bg-docuflow-secondary text-white" aria-label="Enregistrer"><Check size={15} /></button>
                          <button type="button" onClick={() => setEdite(null)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Annuler"><X size={15} /></button>
                        </div>
                      ) : (
                        <>
                          <div className="font-black text-slate-900 flex items-center gap-2">
                            {c.full_name}{moiMeme && <span className="text-xs font-bold text-slate-500">(vous)</span>}
                            <button type="button" onClick={() => setEdite({ id: c.id, full_name: c.full_name || '', email: c.email || '' })} className="p-1 rounded text-slate-400 hover:text-slate-700" aria-label={`Modifier le nom ou l'adresse de ${c.full_name}`}><Pencil size={13} /></button>
                          </div>
                          <div className="text-sm text-slate-600 truncate">{c.username}{c.email ? ` · ${c.email}` : ''}</div>
                        </>
                      )}
                      <div className="text-xs font-semibold text-slate-500 mt-0.5">
                        {c.desactive_le ? <span className="text-red-700">Désactivé le {dateCourte(c.desactive_le)}{c.desactive_par ? ` par ${c.desactive_par}` : ''}</span>
                          : c.derniere_connexion ? `Dernière connexion le ${dateCourte(c.derniere_connexion)}` : 'Jamais connecté'}
                        {c.dossiers_chez_lui > 0 && <span className="ml-2 text-amber-700 font-bold">· {c.dossiers_chez_lui} dossier{c.dossiers_chez_lui > 1 ? 's' : ''} chez lui</span>}
                      </div>
                    </div>
                    <label className="text-xs font-bold text-slate-600">Département
                      <select value={c.section || ''} disabled={Boolean(c.desactive_le) || Boolean(geste)}
                        onChange={(e) => faire(`s-${c.id}`, () => comptesService.modifier(c.id, { section: e.target.value }), 'Département changé.')}
                        className="mt-0.5 block w-56 px-2.5 py-2 rounded-xl border-2 border-slate-200 bg-white text-sm font-semibold text-slate-800">
                        <option value="">—</option>
                        {[...new Set([...sections, c.section].filter(Boolean))].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-bold text-slate-600">Rôle
                      <select value={c.role} disabled={moiMeme || c.role === 'superadmin' || Boolean(c.desactive_le) || Boolean(geste)} title={ROLE_AIDE[c.role] || ''}
                        onChange={(e) => faire(`r-${c.id}`, () => comptesService.modifier(c.id, { role: e.target.value }), `${c.full_name} : ${libelleRole(e.target.value)}.`)}
                        className="mt-0.5 block w-44 px-2.5 py-2 rounded-xl border-2 border-slate-200 bg-white text-sm font-semibold text-slate-800">
                        {c.role === 'superadmin' && <option value="superadmin">Super administrateur</option>}
                        {(donnees.roles || []).map((r) => <option key={r.cle} value={r.cle}>{r.libelle}</option>)}
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-1.5 ml-auto">
                      {!c.desactive_le && (
                        <button type="button" onClick={async () => { const r = await faire(`m-${c.id}`, () => comptesService.motDePasse(c.id)); if (r) setMdp({ nom: c.full_name, mot_de_passe: r.mot_de_passe }); }}
                          disabled={Boolean(geste) || c.role === 'superadmin'} title="Mot de passe oublié : en créer un provisoire"
                          className="px-3 py-2 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-700 hover:border-docuflow-secondary inline-flex items-center gap-1.5 disabled:opacity-40">
                          {geste === `m-${c.id}` ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Mot de passe
                        </button>
                      )}
                      {c.desactive_le ? (
                        <button type="button" onClick={() => faire(`a-${c.id}`, () => comptesService.reactiver(c.id), `${c.full_name} peut de nouveau se connecter.`)} disabled={Boolean(geste)}
                          className="px-3 py-2 rounded-xl bg-green-50 border-2 border-green-200 text-sm font-bold text-green-800 inline-flex items-center gap-1.5">
                          {geste === `a-${c.id}` ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />} Réactiver
                        </button>
                      ) : (
                        <button type="button" onClick={() => setConfirmer(c)} disabled={Boolean(geste) || moiMeme || c.role === 'superadmin'}
                          className="px-3 py-2 rounded-xl border-2 border-red-200 text-sm font-bold text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5 disabled:opacity-40">
                          <UserX size={14} /> Désactiver
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="p-6 text-base text-slate-600">Aucun compte ne correspond.</p>}
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-3 text-sm">
        {Object.entries(ROLE_AIDE).map(([cle, aide]) => (
          <div key={cle} className="rounded-xl bg-white border border-slate-200 px-3 py-2"><strong className="text-slate-900">{libelleRole(cle)}</strong> <span className="text-slate-600">— {aide}</span></div>
        ))}
      </div>

      {/* Désactivation : confirmation, avec les dossiers encore chez l'agent. */}
      <Modal open={Boolean(confirmer)} onClose={() => setConfirmer(null)} panelClassName="w-full max-w-md mx-4">
        {confirmer && (
          <div className="bg-white rounded-3xl shadow-2xl p-6">
            <h3 className="text-lg font-black text-slate-900">Désactiver {confirmer.full_name} ?</h3>
            <p className="text-sm text-slate-700 mt-1">Il ne pourra plus se connecter. Ses demandes, prêts et traces restent. Vous pourrez le réactiver.</p>
            {confirmer.dossiers_chez_lui > 0 && (
              <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-bold text-amber-900 flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /> {confirmer.dossiers_chez_lui} dossier{confirmer.dossiers_chez_lui > 1 ? 's sont' : ' est'} encore chez lui : pensez à les récupérer.
              </div>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setConfirmer(null)} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100">Garder</button>
              <button type="button" onClick={async () => { await faire(`d-${confirmer.id}`, () => comptesService.desactiver(confirmer.id), `${confirmer.full_name} est désactivé.`); setConfirmer(null); }}
                className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold inline-flex items-center gap-2">
                {geste?.startsWith('d-') ? <Loader2 size={15} className="animate-spin" /> : <UserX size={15} />} Désactiver
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Mot de passe provisoire : montré une fois. */}
      <Modal open={Boolean(mdp)} onClose={() => setMdp(null)} panelClassName="w-full max-w-md mx-4">
        {mdp && (
          <div className="bg-white rounded-3xl shadow-2xl p-6">
            <h3 className="text-lg font-black text-slate-900">Mot de passe provisoire de {mdp.nom}</h3>
            <p className="text-sm text-slate-700 mt-1">Remettez-le à l'agent : il ne sera plus affiché. Il pourra le changer dans son profil.</p>
            <div className="mt-4 flex items-center gap-2">
              <code className="flex-1 text-center text-2xl font-black tracking-widest bg-slate-100 rounded-xl py-3 select-all">{mdp.mot_de_passe}</code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(mdp.mot_de_passe).then(() => toast.success('Copié.')).catch(() => {})}
                className="p-3 rounded-xl border-2 border-slate-200 text-slate-700" aria-label="Copier"><Copy size={18} /></button>
            </div>
            <div className="flex justify-end mt-5"><button type="button" onClick={() => setMdp(null)} className="px-5 py-2.5 rounded-xl bg-docuflow-secondary text-white text-sm font-bold">C'est noté</button></div>
          </div>
        )}
      </Modal>

      {ajout && <AjoutAgent roles={donnees?.roles || []} sections={sections} onClose={() => setAjout(false)} onFait={(nom, motDePasse) => { setAjout(false); setMdp({ nom, mot_de_passe: motDePasse }); charger(); }} />}
    </div>
  );
};

/** Nouvel agent : un mot de passe provisoire est créé et montré une fois. */
const AjoutAgent = ({ roles, sections, onClose, onFait }) => {
  const [f, setF] = useState({ full_name: '', username: '', email: '', section: '', role: 'demandeur' });
  const [envoi, setEnvoi] = useState(false);
  const champ = 'mt-1 w-full px-3 py-2.5 rounded-xl border-2 border-slate-200 text-sm focus:outline-none focus:border-docuflow-secondary';
  const envoyer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const mdp = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => alphabet[b % alphabet.length]).join('');
    try {
      await userService.createUser({ ...f, password: mdp });
      toast.success(`${f.full_name} est ajouté.`);
      onFait(f.full_name, mdp);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Le compte n\'a pas pu être créé.');
    } finally { setEnvoi(false); }
  };
  return (
    <Modal open onClose={envoi ? undefined : onClose} panelClassName="w-full max-w-lg mx-4">
      <form onSubmit={envoyer} className="bg-white rounded-3xl shadow-2xl p-6 space-y-3">
        <h3 className="text-lg font-black text-slate-900">Ajouter un agent</h3>
        <label className="block text-sm font-bold text-slate-700">Nom complet<input required value={f.full_name} onChange={(e) => setF((x) => ({ ...x, full_name: e.target.value }))} className={champ} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold text-slate-700">Identifiant<input required value={f.username} onChange={(e) => setF((x) => ({ ...x, username: e.target.value.trim() }))} placeholder="ex. n.zinsou" className={champ} /></label>
          <label className="block text-sm font-bold text-slate-700">Adresse Outlook<input required type="email" value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value.trim() }))} placeholder="prenom.nom@afgcsa.com" className={champ} /></label>
          <label className="block text-sm font-bold text-slate-700">Département
            <select value={f.section} onChange={(e) => setF((x) => ({ ...x, section: e.target.value }))} className={champ}>
              <option value="">—</option>{sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-700">Rôle
            <select value={f.role} onChange={(e) => setF((x) => ({ ...x, role: e.target.value }))} className={champ}>
              {roles.map((r) => <option key={r.cle} value={r.cle}>{r.libelle}</option>)}
            </select>
          </label>
        </div>
        <p className="text-sm text-slate-600">Un mot de passe provisoire sera créé et affiché une seule fois, à remettre à l'agent.</p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" disabled={envoi} className="px-5 py-2.5 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60">
            {envoi ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Ajouter
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ComptesAfgc;
