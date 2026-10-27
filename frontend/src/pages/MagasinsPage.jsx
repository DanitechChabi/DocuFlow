import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Warehouse, Plus, Trash2, ChevronRight, ChevronDown, Package, ClipboardCheck, Loader2, Printer, Check,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { physiqueService, TYPES_EMPLACEMENT, ENFANT_DE, RESULTATS } from '../services/physiqueService';
import { usePermissions } from '../hooks/usePermissions';
import { useTitrePage } from '../hooks/useTitrePage';
import { toast } from '../components/Toast';

/**
 * Magasins — archives papier (migration 038) : où sont les originaux.
 *   Emplacements : dépôt → magasin → travée → tablette → boîte, cotes
 *   topographiques, contenu des boîtes.
 *   Récolements : vérifier qu'un magasin contient bien ce qu'il doit contenir,
 *   boîte par boîte, document par document ; PV figé à la clôture.
 */
const dateFr = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : '—');

const NouvelEmplacement = ({ parent, onCree, onAnnuler }) => {
  const type = parent ? ENFANT_DE[parent.type] : 'depot';
  const [f, setF] = useState({ code: '', libelle: '', capacite_ml: '' });
  const [envoi, setEnvoi] = useState(false);
  const envoyer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const r = await physiqueService.creer({ ...f, type, parent_id: parent?.id || null });
      toast.success(`${TYPES_EMPLACEMENT[type]} ${r.cote} créé(e)`);
      onCree();
    } catch (err) { toast.error(err.response?.data?.message || 'Création impossible'); } finally { setEnvoi(false); }
  };
  return (
    <form onSubmit={envoyer} className="flex flex-wrap items-end gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 my-1">
      <span className="text-xs font-bold text-slate-600 self-center">{TYPES_EMPLACEMENT[type]}{parent ? ` dans ${parent.cote}` : ''}</span>
      <input className="input-premium text-sm w-28" required maxLength={20} placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
      <input className="input-premium text-sm flex-1 min-w-[160px]" maxLength={150} placeholder="Libellé (facultatif)" value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} />
      {['magasin', 'travee'].includes(type) && <input type="number" min={0} step="0.1" className="input-premium text-sm w-32" placeholder="Capacité (ml)" value={f.capacite_ml} onChange={(e) => setF({ ...f, capacite_ml: e.target.value })} />}
      <button type="button" onClick={onAnnuler} className="btn btn-secondary btn-sm">Annuler</button>
      <button type="submit" disabled={envoi} className="btn btn-primary btn-sm">{envoi && <Loader2 size={13} className="animate-spin" />} Créer</button>
    </form>
  );
};

const Contenu = ({ id, profondeur = 0 }) => {
  const [c, setC] = useState(null);
  useEffect(() => { physiqueService.contenu(id).then(setC).catch(() => setC({ documents: [] })); }, [id]);
  const retrait = { marginLeft: `${48 + profondeur * 20}px` };
  if (!c) return <div className="h-8 skeleton rounded-lg my-1" style={retrait} />;
  if (!c.documents.length) return <p className="text-xs text-slate-400 my-1" style={retrait}>Boîte vide{c.masques ? ` (${c.masques} document(s) hors de votre périmètre)` : ''}.</p>;
  return (
    <ul className="my-1 space-y-0.5" style={retrait}>
      {c.documents.map((d) => (
        <li key={d.id} className="text-xs text-slate-600 flex items-center gap-2">
          <Link to={`/documents/liste?doc=${d.id}`} className="font-bold text-docuflow-secondary hover:underline">{d.reference_mfile}</Link>
          <span className="truncate">{d.description || d.nom_entreprise}</span>
          {d.cote_physique && <span className="text-slate-400">· {d.cote_physique}</span>}
          {d.en_pret && <span className="px-1.5 rounded-full bg-blue-50 text-blue-700 font-bold">en prêt</span>}
        </li>
      ))}
      {c.masques > 0 && <li className="text-xs text-slate-400">… et {c.masques} document(s) hors de votre périmètre</li>}
    </ul>
  );
};

const Emplacements = () => {
  const { can } = usePermissions();
  const gerer = can('archives.manage');
  const [liste, setListe] = useState(null);
  const [ouverts, setOuverts] = useState(new Set());
  const [ajout, setAjout] = useState(null); // emplacement parent | 'racine'
  const charger = useCallback(() => physiqueService.emplacements().then(setListe).catch(() => setListe([])), []);
  useEffect(() => { charger(); }, [charger]);
  const enfants = useMemo(() => {
    const m = new Map();
    for (const e of liste || []) m.set(e.parent_id || 0, [...(m.get(e.parent_id || 0) || []), e]);
    return m;
  }, [liste]);
  const basculer = (id) => setOuverts((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const supprimer = async (e) => {
    if (!window.confirm(`Supprimer ${TYPES_EMPLACEMENT[e.type].toLowerCase()} ${e.cote} ?`)) return;
    try { await physiqueService.supprimer(e.id); toast.success('Emplacement supprimé'); charger(); } catch (err) { toast.error(err.response?.data?.message || 'Suppression impossible'); }
  };
  const noeud = (e) => (
    <li key={e.id}>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-50 group" style={{ paddingLeft: `${8 + e.profondeur * 20}px` }}>
        <button type="button" onClick={() => basculer(e.id)} className="text-slate-400" aria-label={ouverts.has(e.id) ? 'Replier' : 'Déplier'}>
          {ouverts.has(e.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {e.type === 'boite' ? <Package size={14} className="text-amber-600" /> : <Warehouse size={14} className="text-slate-500" />}
        <span className="font-mono text-xs font-bold text-slate-800">{e.cote}</span>
        <span className="text-sm text-slate-600 truncate">{TYPES_EMPLACEMENT[e.type]}{e.libelle ? ` — ${e.libelle}` : ''}</span>
        {e.capacite_ml !== null && <span className="text-[11px] text-slate-400">{e.capacite_ml} ml</span>}
        {e.nb_documents > 0 && <span className="text-[11px] px-1.5 rounded-full bg-slate-100 text-slate-600 font-bold">{e.nb_documents} doc.</span>}
        <span className="ml-auto flex gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          {gerer && ENFANT_DE[e.type] && <button type="button" onClick={() => { setAjout(e); setOuverts((s) => new Set(s).add(e.id)); }} className="text-xs font-bold text-docuflow-secondary flex items-center gap-1"><Plus size={12} /> {TYPES_EMPLACEMENT[ENFANT_DE[e.type]]}</button>}
          {gerer && !e.nb_enfants && !e.nb_documents && <button type="button" onClick={() => supprimer(e)} className="text-slate-400 hover:text-red-600" aria-label="Supprimer"><Trash2 size={13} /></button>}
        </span>
      </div>
      {ouverts.has(e.id) && (
        <>
          {ajout?.id === e.id && <div style={{ marginLeft: `${28 + e.profondeur * 20}px` }}><NouvelEmplacement parent={e} onCree={() => { setAjout(null); charger(); }} onAnnuler={() => setAjout(null)} /></div>}
          {['boite', 'tablette'].includes(e.type) && e.nb_documents > 0 && <Contenu id={e.id} profondeur={e.profondeur} />}
          <ul>{(enfants.get(e.id) || []).map(noeud)}</ul>
        </>
      )}
    </li>
  );
  if (liste === null) return <div className="h-32 skeleton rounded-2xl" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600 max-w-3xl">Chaque original papier a sa place : dépôt, magasin, travée, tablette, boîte. La cote topographique (D1-M2-T03-E4-B0127) se lit de gauche à droite, du dépôt à la boîte. Rangez un document depuis sa fiche, carte « Localisation ».</p>
        {gerer && <button type="button" onClick={() => setAjout('racine')} className="btn btn-primary btn-sm"><Plus size={14} /> Nouveau dépôt</button>}
      </div>
      {ajout === 'racine' && <NouvelEmplacement parent={null} onCree={() => { setAjout(null); charger(); }} onAnnuler={() => setAjout(null)} />}
      {liste.length === 0 ? (
        <div className="glass-card-premium p-12 text-center"><Warehouse size={34} className="mx-auto text-slate-300 mb-2" /><p className="font-bold text-slate-800">Aucun emplacement</p><p className="text-sm text-slate-500 mt-1">Décrivez vos locaux d'archives : un dépôt, ses magasins, leurs travées…</p></div>
      ) : <ul className="glass-card-premium p-2">{(enfants.get(0) || []).map(noeud)}</ul>}
    </div>
  );
};

const DetailRecolement = ({ id, onRetour }) => {
  const { can } = usePermissions();
  const [r, setR] = useState(null);
  const [obs, setObs] = useState({});
  const charger = useCallback(() => physiqueService.recolement(id).then(setR).catch((err) => toast.error(err.response?.data?.message || 'Chargement impossible')), [id]);
  useEffect(() => { charger(); }, [charger]);
  const constater = async (lignes, resultat) => {
    try {
      setR(await physiqueService.constater(id, lignes.map((l) => ({ ligne_id: l.id, resultat, observation: obs[l.id] || '' }))));
    } catch (err) { toast.error(err.response?.data?.message || 'Constat impossible'); }
  };
  const clore = async () => {
    const o = window.prompt('Observations générales (facultatif) :', '');
    if (o === null) return;
    try { await physiqueService.clore(id, o); toast.success('Récolement clos : procès-verbal disponible'); charger(); } catch (err) { toast.error(err.response?.data?.message || 'Clôture impossible'); }
  };
  if (!r) return <div className="h-32 skeleton rounded-2xl" />;
  const modifiable = r.statut === 'en_cours' && can('archives.manage');
  return (
    <div className="space-y-4">
      <button type="button" onClick={onRetour} className="text-sm text-slate-500 hover:text-slate-800">← Tous les récolements</button>
      <div className="glass-card-premium p-5 space-y-2">
        <h3 className="font-black text-lg text-slate-900">{r.intitule}</h3>
        <p className="text-xs text-slate-500">Périmètre {r.perimetre_libelle} · ouvert le {dateFr(r.ouvert_at)} par {r.ouvert_par_nom}{r.clos_at ? ` · clos le ${dateFr(r.clos_at)} par ${r.clos_par_nom}` : ''}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-0.5 rounded-full bg-slate-100 font-bold">{r.bilan.total} ligne(s)</span>
          {r.bilan.a_constater > 0 && <span className="px-2 py-0.5 rounded-full bg-slate-800 text-white font-bold">{r.bilan.a_constater} à constater</span>}
          {Object.entries(RESULTATS).map(([k, [l, c]]) => (r.bilan[k] ? <span key={k} className={`px-2 py-0.5 rounded-full font-bold ${c}`}>{r.bilan[k]} {l.toLowerCase()}</span> : null))}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {modifiable && <button type="button" disabled={r.bilan.a_constater > 0} onClick={clore} className="btn btn-primary btn-sm"><ClipboardCheck size={14} /> Clore le récolement</button>}
          {r.statut === 'clos' && <Link to={`/documents/magasins/recolements/${r.id}/pv`} target="_blank" className="btn btn-secondary btn-sm"><Printer size={14} /> Procès-verbal</Link>}
        </div>
      </div>
      <div className="glass-card-premium overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {r.lignes.map((l) => (
              <tr key={l.id} className={`border-t border-slate-100 first:border-t-0 ${l.document_id ? '' : 'bg-slate-50'}`}>
                <td className="p-3">
                  <span className={`font-mono text-xs ${l.document_id ? 'text-slate-500 pl-4' : 'font-bold text-slate-800'}`}>{l.cote}</span>
                  <p className={`text-sm ${l.document_id ? 'pl-4 text-slate-700' : 'font-semibold text-slate-800'}`}>{l.libelle}</p>
                  {l.observation && <p className="text-xs text-slate-500 pl-4">« {l.observation} »</p>}
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  {l.resultat && <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${RESULTATS[l.resultat][1]}`}>{RESULTATS[l.resultat][0]}</span>}
                  {modifiable && (
                    <span className="inline-flex flex-wrap gap-1 ml-2 items-center">
                      {!l.document_id && <button type="button" onClick={() => constater([l, ...r.lignes.filter((x) => x.document_id && x.emplacement_id === l.emplacement_id && !x.resultat)], 'present')} className="btn btn-secondary btn-sm"><Check size={12} /> Boîte complète</button>}
                      {Object.entries(RESULTATS).filter(([k]) => k !== 'en_pret').map(([k, [lib]]) => (
                        <button key={k} type="button" onClick={() => constater([l], k)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">{lib}</button>
                      ))}
                      <input className="input-premium text-xs w-40 py-1" placeholder="Observation" value={obs[l.id] || ''} onChange={(e) => setObs({ ...obs, [l.id]: e.target.value })} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Recolements = ({ ouvert, setOuvert }) => {
  const { can } = usePermissions();
  const [liste, setListe] = useState(null);
  const [emplacements, setEmplacements] = useState([]);
  const [perimetre, setPerimetre] = useState('');
  useEffect(() => {
    if (ouvert) return;
    physiqueService.recolements().then(setListe).catch(() => setListe([]));
    physiqueService.emplacements().then((l) => setEmplacements(l.filter((e) => e.type !== 'boite'))).catch(() => {});
  }, [ouvert]);
  const ouvrir = async () => {
    try { const r = await physiqueService.ouvrir({ emplacement_id: Number(perimetre) }); toast.success('Récolement ouvert'); setOuvert(r.id); } catch (err) { toast.error(err.response?.data?.message || 'Ouverture impossible'); }
  };
  if (ouvert) return <DetailRecolement id={ouvert} onRetour={() => setOuvert(null)} />;
  if (liste === null) return <div className="h-32 skeleton rounded-2xl" />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 max-w-3xl">Le récolement vérifie que les boîtes et les documents attendus sont bien à leur place. Choisissez un magasin ou une travée : la liste de ce qui doit s'y trouver est figée, puis chaque ligne est constatée. Les documents en prêt sont déjà notés.</p>
      {can('archives.manage') && (
        <div className="flex flex-wrap gap-2 items-center">
          <select className="input-premium w-auto text-sm" value={perimetre} onChange={(e) => setPerimetre(e.target.value)}>
            <option value="">— Périmètre à récoler —</option>
            {emplacements.map((e) => <option key={e.id} value={e.id}>{e.cote} — {TYPES_EMPLACEMENT[e.type]}{e.libelle ? ` ${e.libelle}` : ''}</option>)}
          </select>
          <button type="button" disabled={!perimetre} onClick={ouvrir} className="btn btn-primary btn-sm"><ClipboardCheck size={14} /> Ouvrir un récolement</button>
        </div>
      )}
      {liste.length > 0 && (
        <div className="glass-card-premium overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {liste.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 first:border-t-0 hover:bg-slate-50 cursor-pointer" onClick={() => setOuvert(r.id)}>
                  <td className="p-3"><strong>{r.intitule}</strong><p className="text-xs text-slate-500">Ouvert le {dateFr(r.ouvert_at)}</p></td>
                  <td className="p-3 text-xs">{r.statut === 'clos' ? 'Clos' : `${r.a_constater} à constater`}</td>
                  <td className="p-3 text-xs">{r.anomalies ? <span className="text-red-700 font-bold">{r.anomalies} anomalie(s)</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const MagasinsPage = () => {
  useTitrePage('Magasins');
  const [params, setParams] = useSearchParams();
  const vue = params.get('vue') === 'recolements' ? 'recolements' : 'emplacements';
  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1100px] mx-auto">
      <PageHeader title="Magasins" subtitle="Les originaux papier : où ils sont, et la preuve qu'ils y sont"
        icon={Warehouse} breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Magasins' }]} />
      <div className="segmented mb-5">
        <button type="button" aria-pressed={vue === 'emplacements'} onClick={() => setParams({}, { replace: true })}>Emplacements</button>
        <button type="button" aria-pressed={vue === 'recolements'} onClick={() => setParams({ vue: 'recolements' }, { replace: true })}>Récolements</button>
      </div>
      {vue === 'emplacements' ? <Emplacements /> : (
        <Recolements ouvert={Number(params.get('recolement')) || null}
          setOuvert={(id) => setParams(id ? { vue: 'recolements', recolement: id } : { vue: 'recolements' })} />
      )}
    </div>
  );
};

export default MagasinsPage;
