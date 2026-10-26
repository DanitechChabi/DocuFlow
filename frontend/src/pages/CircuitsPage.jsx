import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitBranch, Plus, Trash2, ArrowUp, ArrowDown, Loader2, Pencil, Clock } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { circuitService, quand } from '../services/circuitService';
import { useTitrePage } from '../hooks/useTitrePage';
import { toast } from '../components/Toast';

/**
 * Circuits de validation (migration 034) : les modèles d'étapes, rattachés
 * ou non à une classe de documents, et le suivi des circuits en cours.
 */
const etapeVide = () => ({ libelle: '', type_assignation: 'role', assigne_role: '', assigne_user_id: '', assigne_groupe_id: '', action: 'visa', regle: 'un', delai_jours: 3 });
const modeleVide = () => ({ nom: '', description: '', classe_id: '', par_defaut: false, demarrage_auto: false, actif: true, etapes: [etapeVide()] });

const Editeur = ({ initial, referentiel, onFermer, onEnregistre }) => {
  const [m, setM] = useState(initial);
  const [envoi, setEnvoi] = useState(false);
  const maj = (cle, v) => setM({ ...m, [cle]: v });
  const majEtape = (i, cle, v) => setM({ ...m, etapes: m.etapes.map((e, j) => (j === i ? { ...e, [cle]: v } : e)) });
  const deplacer = (i, d) => {
    const etapes = [...m.etapes];
    [etapes[i], etapes[i + d]] = [etapes[i + d], etapes[i]];
    setM({ ...m, etapes });
  };
  const enregistrer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await circuitService.enregistrer({ ...m, classe_id: m.classe_id || null });
      toast.success('Circuit enregistré');
      onEnregistre();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Enregistrement impossible');
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <form onSubmit={enregistrer} className="glass-card-premium p-5 space-y-4 mb-6">
      <div className="grid md:grid-cols-2 gap-3">
        <label className="text-xs font-bold text-slate-600 space-y-1">Nom du circuit
          <input className="input-premium text-sm" required maxLength={150} value={m.nom} onChange={(e) => maj('nom', e.target.value)} placeholder="Visa des factures fournisseurs" /></label>
        <label className="text-xs font-bold text-slate-600 space-y-1">Classe de documents
          <select className="input-premium text-sm" value={m.classe_id || ''} onChange={(e) => setM({ ...m, classe_id: e.target.value, ...(e.target.value ? {} : { par_defaut: false, demarrage_auto: false }) })}>
            <option value="">Toutes (lancement manuel)</option>
            {referentiel.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
      </div>
      <textarea className="input-premium text-sm min-h-[50px]" maxLength={2000} value={m.description || ''} onChange={(e) => maj('description', e.target.value)} placeholder="Description (facultatif)" />
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={m.par_defaut} disabled={!m.classe_id} onChange={(e) => setM({ ...m, par_defaut: e.target.checked, demarrage_auto: e.target.checked && m.demarrage_auto })} /> Circuit par défaut de la classe</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={m.demarrage_auto} disabled={!m.par_defaut} onChange={(e) => maj('demarrage_auto', e.target.checked)} /> Démarrer automatiquement (création, fin d'indexation)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={m.actif} onChange={(e) => maj('actif', e.target.checked)} /> Actif</label>
      </div>
      <div className="space-y-3">
        {m.etapes.map((e, i) => (
          <div key={i} className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-docuflow-secondary text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
              <input className="input-premium text-sm flex-1" required maxLength={150} value={e.libelle} onChange={(ev) => majEtape(i, 'libelle', ev.target.value)} placeholder="Libellé de l'étape (ex. Contrôle comptable)" />
              <button type="button" disabled={i === 0} onClick={() => deplacer(i, -1)} className="text-slate-400 disabled:opacity-30" aria-label="Monter"><ArrowUp size={15} /></button>
              <button type="button" disabled={i === m.etapes.length - 1} onClick={() => deplacer(i, 1)} className="text-slate-400 disabled:opacity-30" aria-label="Descendre"><ArrowDown size={15} /></button>
              <button type="button" disabled={m.etapes.length === 1} onClick={() => setM({ ...m, etapes: m.etapes.filter((_, j) => j !== i) })} className="text-red-400 disabled:opacity-30" aria-label="Retirer"><Trash2 size={15} /></button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <select className="input-premium text-sm" value={e.type_assignation} onChange={(ev) => majEtape(i, 'type_assignation', ev.target.value)}>
                <option value="role">Un rôle</option><option value="groupe">Un groupe</option><option value="utilisateur">Une personne</option>
              </select>
              {e.type_assignation === 'role' && (
                <select className="input-premium text-sm" required value={e.assigne_role || ''} onChange={(ev) => majEtape(i, 'assigne_role', ev.target.value)}>
                  <option value="">Rôle…</option>{referentiel.roles.map((r) => <option key={r.key} value={r.key}>{r.name} ({r.nb})</option>)}
                </select>
              )}
              {e.type_assignation === 'groupe' && (
                <select className="input-premium text-sm" required value={e.assigne_groupe_id || ''} onChange={(ev) => majEtape(i, 'assigne_groupe_id', ev.target.value)}>
                  <option value="">Groupe…</option>{referentiel.groupes.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.nb})</option>)}
                </select>
              )}
              {e.type_assignation === 'utilisateur' && (
                <select className="input-premium text-sm" required value={e.assigne_user_id || ''} onChange={(ev) => majEtape(i, 'assigne_user_id', ev.target.value)}>
                  <option value="">Personne…</option>{referentiel.utilisateurs.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                </select>
              )}
              <select className="input-premium text-sm" value={e.action} onChange={(ev) => majEtape(i, 'action', ev.target.value)}>
                <option value="visa">Visa (approuver / refuser)</option><option value="information">Pour information</option>
              </select>
              <select className="input-premium text-sm" value={e.regle} onChange={(ev) => majEtape(i, 'regle', ev.target.value)}>
                <option value="un">Une réponse suffit</option><option value="tous">Tous doivent répondre</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-600"><Clock size={13} />
                <input type="number" min={0} max={365} className="input-premium text-sm w-20" value={e.delai_jours ?? ''} onChange={(ev) => majEtape(i, 'delai_jours', ev.target.value)} /> jours</label>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setM({ ...m, etapes: [...m.etapes, etapeVide()] })} className="btn btn-secondary btn-sm"><Plus size={13} /> Ajouter une étape</button>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onFermer} className="btn btn-secondary">Annuler</button>
        <button type="submit" disabled={envoi} className="btn btn-primary">{envoi && <Loader2 size={15} className="animate-spin" />} Enregistrer</button>
      </div>
    </form>
  );
};

const CircuitsPage = () => {
  useTitrePage('Circuits de validation');
  const [modeles, setModeles] = useState(null);
  const [referentiel, setReferentiel] = useState(null);
  const [suivi, setSuivi] = useState([]);
  const [edition, setEdition] = useState(null);

  const charger = useCallback(async () => {
    try {
      const [m, r, s] = await Promise.all([circuitService.modeles(), circuitService.referentiel(), circuitService.suivi()]);
      setModeles(m); setReferentiel(r); setSuivi(s);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Chargement impossible');
      setModeles([]);
    }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const supprimer = async (m) => {
    if (!window.confirm(`Supprimer le circuit « ${m.nom} » ? Les circuits déjà lancés ne sont pas touchés.`)) return;
    try { await circuitService.supprimer(m.id); charger(); } catch (err) { toast.error(err.response?.data?.message || 'Suppression impossible'); }
  };

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1200px] mx-auto">
      <PageHeader title="Circuits de validation" subtitle="Qui vise quoi, dans quel ordre et sous quel délai"
        icon={GitBranch} breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Circuits de validation' }]}
        actions={referentiel && !edition && <button type="button" onClick={() => setEdition(modeleVide())} className="btn btn-primary"><Plus size={16} /> Nouveau circuit</button>} />
      {edition && referentiel && <Editeur initial={edition} referentiel={referentiel} onFermer={() => setEdition(null)} onEnregistre={() => { setEdition(null); charger(); }} />}
      {modeles === null ? <div className="h-32 rounded-2xl skeleton" /> : modeles.length === 0 && !edition ? (
        <div className="glass-card-premium p-12 text-center">
          <GitBranch size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="font-bold text-slate-800">Aucun circuit</p>
          <p className="text-sm text-slate-500 mt-1">Un circuit enchaîne des visas : contrôle, approbation des responsables, information de la direction.</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4 mb-8">
          {modeles.map((m) => (
            <div key={m.id} className={`glass-card-premium p-4 space-y-2 ${m.actif ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-900">{m.nom}</p>
                  <p className="text-xs text-slate-500">{m.classe_nom ? `Classe « ${m.classe_nom} »` : 'Toutes classes'}{m.par_defaut ? ' · par défaut' : ''}{m.demarrage_auto ? ' · automatique' : ''}{m.actif ? '' : ' · inactif'}</p>
                </div>
                <div className="flex gap-1 text-slate-400">
                  <button type="button" onClick={() => setEdition({ ...m, classe_id: m.classe_id || '' })} aria-label="Modifier" className="hover:text-docuflow-secondary"><Pencil size={15} /></button>
                  <button type="button" onClick={() => supprimer(m)} aria-label="Supprimer" className="hover:text-red-600"><Trash2 size={15} /></button>
                </div>
              </div>
              <ol className="text-xs text-slate-600 space-y-0.5">
                {m.etapes.map((e) => <li key={e.rang}>{e.rang}. {e.libelle} — {e.assigne_libelle}{e.regle === 'tous' ? ' (tous)' : ''}{e.action === 'information' ? ' · info' : ''}{e.delai_jours ? ` · ${e.delai_jours} j` : ''}</li>)}
              </ol>
              <p className="text-[11px] text-slate-400">{m.en_cours} en cours · {m.lances} lancé(s)</p>
            </div>
          ))}
        </div>
      )}
      {suivi.length > 0 && (
        <>
          <h2 className="text-sm font-bold text-slate-700 mb-3">Circuits en cours ({suivi.length})</h2>
          <div className="glass-card-premium overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <tr><th className="text-left p-3">Document</th><th className="text-left p-3">Circuit</th><th className="text-left p-3">Étape</th><th className="text-left p-3">En attente de</th></tr>
              </thead>
              <tbody>
                {suivi.map((i) => (
                  <tr key={i.id} className={`border-t border-slate-100 ${i.en_retard ? 'bg-red-50/40' : ''}`}>
                    <td className="p-3"><Link to={`/documents/liste?doc=${i.document_id}`} className="font-bold text-docuflow-secondary hover:underline">{i.reference_mfile}</Link><p className="text-xs text-slate-500">{i.nom_entreprise}</p></td>
                    <td className="p-3 text-xs">{i.circuit_nom}<br /><span className="text-slate-400">depuis le {quand(i.demarre_at)}</span></td>
                    <td className="p-3 text-xs">{i.etape_courante}/{i.nb_etapes} · {i.etape_libelle}</td>
                    <td className="p-3 text-xs">{i.taches.map((t) => <p key={t.id} className={t.en_retard ? 'text-red-600 font-semibold' : ''}>{t.assigne_nom}{t.en_retard ? ' (retard)' : ''}</p>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default CircuitsPage;
