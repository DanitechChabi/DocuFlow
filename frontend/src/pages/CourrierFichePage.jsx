import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Mail, Loader2, UserPlus, Play, Reply, CheckCircle2, Send, FileDown, FileText, Lock, Zap, MessageSquarePlus, ArrowRight, PenLine,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import PastilleStatut from '../components/courrier/PastilleStatut';
import ChoixDocument from '../components/archives/ChoixDocument';
import {
  courrierService, SENS, CANAUX, NATURES, EVENEMENTS, INSTRUCTIONS, MOTIFS, dateFr,
} from '../services/courrierService';
import { useTitrePage } from '../hooks/useTitrePage';
import { toast } from '../components/Toast';

/**
 * Fiche d'un courrier : ce qu'il est, où il en est, ce que je peux faire.
 * Les actions proposées sont celles que le serveur autorise (c.actions).
 */
const Info = ({ libelle, children }) => (
  <div><dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{libelle}</dt><dd className="text-sm text-slate-800 mt-0.5">{children || '—'}</dd></div>
);

const CourrierFichePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [c, setC] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [agents, setAgents] = useState([]);
  const [panneau, setPanneau] = useState(null); // affecter | clore | expedier | document
  const [form, setForm] = useState({});
  const [note, setNote] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [lettre, setLettre] = useState({ lettre: '', signataire: '', qualite: '', lieu: '' });
  useTitrePage(c ? `Courrier ${c.numero}` : 'Courrier');

  const charger = useCallback(() => {
    courrierService.lire(id).then((r) => {
      setC(r); setErreur(null);
      setLettre({ lettre: r.lettre || '', signataire: r.lettre_signataire || '', qualite: r.lettre_qualite || '', lieu: r.lettre_lieu || '' });
    }).catch((e) => setErreur(e.response?.data?.message || 'Courrier indisponible'));
  }, [id]);
  useEffect(() => { setC(null); charger(); }, [charger]);

  const faire = async (fn, succes) => {
    setEnvoi(true);
    try {
      const r = await fn();
      if (succes) toast.success(succes);
      setPanneau(null);
      if (r?.hors_vue) { navigate('/courrier'); return; }
      charger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action impossible');
    } finally { setEnvoi(false); }
  };
  const ouvrirAffectation = async () => {
    if (!agents.length) setAgents(await courrierService.agents().catch(() => []));
    setForm({ assigne_a: c.assigne_a || '', instruction: c.instruction || '', echeance: c.echeance || '', copies: c.copies || [] });
    setPanneau('affecter');
  };
  const repondre = async () => {
    setEnvoi(true);
    try {
      const r = await courrierService.repondre(c.id);
      toast.success(`Réponse préparée : courrier départ ${r.numero}`);
      navigate(`/courrier/${r.id}`);
    } catch (err) { toast.error(err.response?.data?.message || 'Réponse impossible'); } finally { setEnvoi(false); }
  };

  if (erreur) return <div className="px-4 sm:px-8 py-10 max-w-[900px] mx-auto"><div className="glass-card-premium p-10 text-center text-sm font-semibold text-slate-600">{erreur} <Link to="/courrier" className="text-docuflow-secondary underline ml-1">Retour au registre</Link></div></div>;
  if (!c) return <div className="p-20 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto" /></div>;
  const a = c.actions;
  const depart = c.sens === 'depart';

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1200px] mx-auto">
      <PageHeader title={c.objet} subtitle={`${SENS[c.sens]} · ${c.numero} · enregistré le ${new Date(c.created_at).toLocaleDateString('fr-FR')} par ${c.created_by_nom || '—'}`} icon={Mail}
        breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Courrier', to: '/courrier' }, { label: c.numero }]} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <section className="glass-card-premium p-5">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <PastilleStatut c={c} />
              {c.urgent && <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600"><Zap size={13} /> Urgent</span>}
              {c.confidentiel && <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500"><Lock size={13} /> Confidentiel</span>}
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Info libelle={depart ? 'Destinataire' : 'Expéditeur'}>{c.correspondant}{c.organisme && <span className="text-slate-500"> — {c.organisme}</span>}</Info>
              <Info libelle="Nature · canal">{NATURES[c.nature]} · {CANAUX[c.canal]}</Info>
              <Info libelle="Date du courrier">{c.date_courrier && dateFr(c.date_courrier)}</Info>
              <Info libelle={depart ? 'Référence rappelée' : 'Référence de la lettre'}>{c.reference_externe}</Info>
              {!depart && <Info libelle="Agent chargé">{c.assigne_nom}{c.assigne_at && <span className="text-slate-400"> · depuis le {new Date(c.assigne_at).toLocaleDateString('fr-FR')}</span>}</Info>}
              {!depart && <Info libelle="Échéance"><span className={c.en_retard ? 'text-red-600 font-bold' : ''}>{c.echeance && dateFr(c.echeance)}</span>{c.reponse_attendue && !c.echeance && 'Réponse attendue'}</Info>}
              {c.instruction && <div className="sm:col-span-2 p-3 rounded-xl bg-amber-50 border border-amber-100"><dt className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Instruction</dt><dd className="text-sm text-slate-800 mt-0.5">{c.instruction}</dd></div>}
              {c.copies_noms?.length > 0 && <Info libelle="En copie">{c.copies_noms.map((x) => x.full_name).join(', ')}</Info>}
              {depart && c.expedie_at && <Info libelle="Expédié">le {new Date(c.expedie_at).toLocaleDateString('fr-FR')}{c.mode_expedition && ` · ${c.mode_expedition}`}</Info>}
              {c.statut === 'clos' && <Info libelle="Clôture">{MOTIFS[c.clos_motif]} · le {new Date(c.clos_at).toLocaleDateString('fr-FR')}</Info>}
            </dl>
          </section>

          <section className="glass-card-premium p-5 space-y-3">
            <h2 className="text-sm font-black text-slate-900">Document et courriers liés</h2>
            {c.document_id ? (
              <Link to={`/documents/liste?doc=${c.document_id}`} className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100 text-sm hover:bg-slate-100">
                <FileText size={16} className="text-docuflow-secondary" /> <span className="font-semibold">{c.document_reference || 'Document'}</span>
                <span className="text-slate-400">dans la GED</span> <ArrowRight size={14} className="ml-auto text-slate-400" />
              </Link>
            ) : panneau === 'document' ? (
              <div className="flex gap-2">
                <div className="flex-1"><ChoixDocument valeur={form.doc || null} onChange={(d) => setForm({ doc: d })} /></div>
                <button type="button" disabled={!form.doc || envoi} onClick={() => faire(() => courrierService.modifier(c.id, { document_id: form.doc.id }), 'Document lié')} className="btn-primary">Lier</button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Aucun document lié.{a.modifier && <button type="button" onClick={() => { setForm({}); setPanneau('document'); }} className="ml-2 font-bold text-docuflow-secondary hover:underline">Lier un document de la GED</button>}</p>
            )}
            {c.origine && <Link to={`/courrier/${c.origine.id}`} className="flex items-center gap-2 text-sm text-docuflow-secondary font-semibold hover:underline"><Reply size={14} /> Répond au courrier {c.origine.numero} — {c.origine.objet}</Link>}
            {c.reponses.map((r) => (
              <Link key={r.id} to={`/courrier/${r.id}`} className="flex items-center gap-2 text-sm text-docuflow-secondary font-semibold hover:underline">
                <Send size={14} /> Réponse {r.numero} — {r.statut === 'expedie' ? `expédiée le ${new Date(r.expedie_at).toLocaleDateString('fr-FR')}` : 'à expédier'}
              </Link>
            ))}
          </section>

          {a.rediger && (
            <form className="glass-card-premium p-5 space-y-3" data-tour="courrier-lettre"
              onSubmit={(e) => { e.preventDefault(); faire(() => courrierService.rediger(c.id, lettre), c.lettre ? 'Lettre mise à jour : nouvelle version dans la GED' : 'Lettre enregistrée dans la GED'); }}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-black text-slate-900 flex items-center gap-2"><PenLine size={15} /> Rédiger la lettre</h2>
                <span className="text-[11px] text-slate-400">En-tête, numéro, date et objet sont ajoutés automatiquement</span>
              </div>
              <textarea className="input-premium min-h-[220px] leading-relaxed" required minLength={10} placeholder={'Madame, Monsieur,\n\nEn réponse à votre courrier…\n\nVeuillez agréer…'}
                value={lettre.lettre} onChange={(e) => setLettre({ ...lettre, lettre: e.target.value })} aria-label="Texte de la lettre" />
              <div className="grid gap-3 sm:grid-cols-3">
                <input className="input-premium" placeholder="Qualité (Le Maire…)" value={lettre.qualite} onChange={(e) => setLettre({ ...lettre, qualite: e.target.value })} aria-label="Qualité du signataire" />
                <input className="input-premium" placeholder="Nom du signataire" value={lettre.signataire} onChange={(e) => setLettre({ ...lettre, signataire: e.target.value })} aria-label="Nom du signataire" />
                <input className="input-premium" placeholder="Fait à (ville)" value={lettre.lieu} onChange={(e) => setLettre({ ...lettre, lieu: e.target.value })} aria-label="Lieu" />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={envoi} className="btn-primary flex items-center gap-2"><PenLine size={15} /> {c.lettre ? 'Mettre à jour la lettre' : 'Produire la lettre (PDF)'}</button>
                <p className="text-[11px] text-slate-500">Le PDF est versé dans la GED. Ouvrez-le pour le relire, le soumettre à un circuit de validation ou l'imprimer.</p>
              </div>
            </form>
          )}

          <section className="glass-card-premium p-5">
            <h2 className="text-sm font-black text-slate-900 mb-4">Historique</h2>
            <ol className="space-y-3">
              {c.evenements.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${e.action === 'NOTE' ? 'bg-amber-400' : e.action === 'CLOS' || e.action === 'EXPEDIE' ? 'bg-emerald-500' : 'bg-docuflow-secondary'}`} />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800"><span className="font-bold">{EVENEMENTS[e.action] || e.action}</span>{e.par_nom && <span className="text-slate-500"> · {e.par_nom}</span>}</p>
                    {e.note && <p className="text-sm text-slate-600 whitespace-pre-line">{e.note}</p>}
                    <p className="text-[11px] text-slate-400">{new Date(e.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>
                  </div>
                </li>
              ))}
            </ol>
            <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) faire(async () => { await courrierService.annoter(c.id, note); setNote(''); }); }}>
              <input className="input-premium flex-1" placeholder="Ajouter une note pour les personnes concernées…" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
              <button type="submit" disabled={!note.trim() || envoi} className="btn-secondary flex items-center gap-1.5"><MessageSquarePlus size={15} /> Noter</button>
            </form>
          </section>
        </div>

        <aside className="space-y-3">
          <section className="glass-card-premium p-5 space-y-2" data-tour="courrier-actions">
            <h2 className="text-sm font-black text-slate-900 mb-1">Actions</h2>
            {a.prendre_en_charge && <button type="button" disabled={envoi} onClick={() => faire(() => courrierService.prendreEnCharge(c.id), 'Courrier pris en charge')} className="btn-primary w-full flex items-center justify-center gap-2"><Play size={15} /> Prendre en charge</button>}
            {a.expedier && <button type="button" onClick={() => { setForm({ mode: CANAUX[c.canal] }); setPanneau('expedier'); }} className="btn-primary w-full flex items-center justify-center gap-2"><Send size={15} /> Constater l'expédition</button>}
            {a.repondre && <button type="button" disabled={envoi} onClick={repondre} className={`${a.prendre_en_charge ? 'btn-secondary' : 'btn-primary'} w-full flex items-center justify-center gap-2`}><Reply size={15} /> Préparer la réponse</button>}
            {a.affecter && <button type="button" onClick={ouvrirAffectation} className="btn-secondary w-full flex items-center justify-center gap-2"><UserPlus size={15} /> {c.assigne_a ? 'Réaffecter' : 'Affecter'}</button>}
            {a.clore && <button type="button" onClick={() => { setForm({ motif: 'information', note: '' }); setPanneau('clore'); }} className="btn-secondary w-full flex items-center justify-center gap-2"><CheckCircle2 size={15} /> Clore</button>}
            {a.accuse_reception && <button type="button" onClick={() => courrierService.accuseReception(c.id, c.numero).then(charger).catch(() => toast.error('Accusé de réception indisponible'))} className="btn-secondary w-full flex items-center justify-center gap-2"><FileDown size={15} /> Accusé de réception</button>}
            {!Object.values(a).some(Boolean) && <p className="text-xs text-slate-400">Aucune action : vous consultez ce courrier.</p>}
            {c.accuse_reception_at && <p className="text-[11px] text-slate-400">Accusé de réception délivré le {new Date(c.accuse_reception_at).toLocaleDateString('fr-FR')}.</p>}
          </section>

          {panneau === 'affecter' && (
            <form className="glass-card-premium p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); faire(() => courrierService.affecter(c.id, { ...form, echeance: form.echeance || null }), 'Courrier affecté'); }}>
              <h2 className="text-sm font-black text-slate-900">Affecter le courrier</h2>
              <select className="input-premium" required value={form.assigne_a} onChange={(e) => setForm({ ...form, assigne_a: e.target.value })} aria-label="Agent chargé">
                <option value="">Choisir un agent…</option>
                {agents.map((x) => <option key={x.id} value={x.id}>{x.full_name}{x.section ? ` — ${x.section}` : ''}</option>)}
              </select>
              <input className="input-premium" list="instructions-fiche" placeholder="Instruction (pour étude et avis…)" value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} aria-label="Instruction" />
              <datalist id="instructions-fiche">{INSTRUCTIONS.map((i) => <option key={i} value={i} />)}</datalist>
              <label className="block text-xs font-bold text-slate-600">Échéance<input type="date" className="input-premium mt-1" value={form.echeance || ''} onChange={(e) => setForm({ ...form, echeance: e.target.value })} /></label>
              <div>
                <p className="text-xs font-bold text-slate-600 mb-1">En copie</p>
                <div className="flex flex-wrap gap-1.5">
                  {agents.filter((x) => String(x.id) !== String(form.assigne_a)).map((x) => {
                    const actif = form.copies.includes(x.id);
                    return <button key={x.id} type="button" aria-pressed={actif} onClick={() => setForm({ ...form, copies: actif ? form.copies.filter((y) => y !== x.id) : [...form.copies, x.id] })}
                      className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${actif ? 'bg-blue-50 border-blue-200 text-docuflow-secondary' : 'border-slate-200 text-slate-500'}`}>{x.full_name}</button>;
                  })}
                </div>
              </div>
              <div className="flex gap-2"><button type="submit" disabled={envoi} className="btn-primary flex-1">Affecter</button><button type="button" onClick={() => setPanneau(null)} className="btn-secondary">Annuler</button></div>
            </form>
          )}
          {panneau === 'clore' && (
            <form className="glass-card-premium p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); faire(() => courrierService.clore(c.id, form), 'Courrier clos'); }}>
              <h2 className="text-sm font-black text-slate-900">Clore le courrier</h2>
              {[['repondu', 'Répondu', 'Une réponse a été donnée (hors registre, par téléphone…)'], ['information', 'Pour information', 'Lu, aucune suite à donner'], ['sans_suite', 'Sans suite', 'Classé sans réponse : à expliquer']].map(([k, l, d]) => (
                <label key={k} className={`flex gap-2 p-2.5 rounded-xl border cursor-pointer ${form.motif === k ? 'border-docuflow-secondary bg-blue-50/40' : 'border-slate-200'}`}>
                  <input type="radio" name="motif" checked={form.motif === k} onChange={() => setForm({ ...form, motif: k })} className="mt-1" />
                  <span><span className="block text-sm font-bold text-slate-800">{l}</span><span className="block text-[11px] text-slate-500">{d}</span></span>
                </label>
              ))}
              <textarea className="input-premium min-h-[70px]" placeholder={form.motif === 'sans_suite' ? 'Pourquoi ? (obligatoire)' : 'Commentaire (facultatif)'} required={form.motif === 'sans_suite'} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              <div className="flex gap-2"><button type="submit" disabled={envoi} className="btn-primary flex-1">Clore</button><button type="button" onClick={() => setPanneau(null)} className="btn-secondary">Annuler</button></div>
            </form>
          )}
          {panneau === 'expedier' && (
            <form className="glass-card-premium p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); faire(() => courrierService.expedier(c.id, form), 'Expédition enregistrée'); }}>
              <h2 className="text-sm font-black text-slate-900">Constater l'expédition</h2>
              <input className="input-premium" placeholder="Mode d'envoi (porteur, poste, e-mail…)" value={form.mode || ''} onChange={(e) => setForm({ ...form, mode: e.target.value })} aria-label="Mode d'envoi" />
              {c.origine && <p className="text-xs text-slate-500">Le courrier {c.origine.numero} auquel il répond sera clos « répondu ».</p>}
              <div className="flex gap-2"><button type="submit" disabled={envoi} className="btn-primary flex-1">Expédié</button><button type="button" onClick={() => setPanneau(null)} className="btn-secondary">Annuler</button></div>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
};

export default CourrierFichePage;
