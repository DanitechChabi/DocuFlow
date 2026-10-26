import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Loader2, Save, Bell, BellOff, Trash2, Share2, Package, X, Gavel, ShieldAlert, SlidersHorizontal,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { rechercheService, messageBlob } from '../services/rechercheService';
import { usePermissions } from '../hooks/usePermissions';
import { useTitrePage } from '../hooks/useTitrePage';
import { toast } from '../components/Toast';

/**
 * Recherche avancée (migration 035) : critères combinés (texte du contenu et
 * de la fiche, classe et ses propriétés, dossier et sous-dossiers, dates,
 * statut, gel, intégrité), résultats surlignés, facettes, recherches
 * enregistrées avec alerte, export de la sélection en paquet d'archive.
 */
const VIDE = { texte: '', phrase: '', entreprise: '', reference: '', classe_id: '', dossier_id: '', sous_dossiers: true, statuts: [], annee_min: '', annee_max: '', date_document_du: '', date_document_au: '', gel: '', integrite: '', type_fichier: '', champs: {} };
const LIBELLES_TRI = { pertinence: 'Pertinence', date_desc: 'Plus récents', date_asc: 'Plus anciens', creation_desc: 'Derniers versés', reference: 'Référence', entreprise: 'Entreprise' };
const INTEGRITE = { anomalie: 'Anomalie (altérée ou introuvable)', alteree: 'Altérée', introuvable: 'Introuvable', non_verifiee: 'Non vérifiée', intacte: 'Intacte' };
const TYPES = { pdf: 'PDF', image: 'Image', bureautique: 'Bureautique', texte: 'Texte', aucun: 'Sans fichier' };

/** Critères du formulaire → critères de l'API (vides retirés). */
function versApi(f) {
  const c = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === 'champs') continue;
    if (v === '' || v === null || (Array.isArray(v) && !v.length)) continue;
    c[k] = v;
  }
  if (!c.dossier_id) delete c.sous_dossiers;
  if (c.gel !== undefined) c.gel = c.gel === 'oui';
  const champs = Object.entries(f.champs || {}).map(([id, x]) => ({ id: Number(id), ...x })).filter((x) => x.valeur || x.min || x.max);
  if (champs.length) c.champs = champs;
  return c;
}
/** Critères enregistrés → formulaire. */
function versFormulaire(c = {}) {
  const f = { ...VIDE, ...c, champs: {} };
  if (c.gel !== undefined) f.gel = c.gel ? 'oui' : 'non';
  for (const x of c.champs || []) f.champs[x.id] = { op: x.op, valeur: x.valeur || '', min: x.min || '', max: x.max || '' };
  return f;
}

const Extrait = ({ segments }) => (
  <p className="text-xs text-slate-600 mt-1 line-clamp-3">
    {segments.map((s, i) => (s.s ? <mark key={i} className="bg-amber-100 text-slate-900 rounded px-0.5">{s.t}</mark> : <React.Fragment key={i}>{s.t}</React.Fragment>))}
  </p>
);

const RecherchePage = () => {
  useTitrePage('Recherche avancée');
  const { can } = usePermissions();
  const [ref, setRef] = useState(null);
  const [f, setF] = useState(VIDE);
  const [tri, setTri] = useState('pertinence');
  const [res, setRes] = useState(null);
  const [page, setPage] = useState(1);
  const [chargement, setChargement] = useState(false);
  const [enregistrees, setEnregistrees] = useState([]);
  const [courante, setCourante] = useState(null);
  const [selection, setSelection] = useState(new Set());
  const [filtresOuverts, setFiltresOuverts] = useState(false);

  const chargerEnregistrees = useCallback(() => rechercheService.recherches().then(setEnregistrees).catch(() => {}), []);
  useEffect(() => {
    rechercheService.referentiel().then(setRef).catch((err) => toast.error(err.response?.data?.message || 'Critères indisponibles'));
    chargerEnregistrees();
  }, [chargerEnregistrees]);

  const lancer = useCallback(async (form = f, p = 1, t = tri) => {
    setChargement(true);
    try {
      setRes(await rechercheService.rechercher(versApi(form), { page: p, tri: t }));
      setPage(p);
      setSelection(new Set());
    } catch (err) {
      toast.error(err.response?.data?.message || 'Recherche impossible');
    } finally {
      setChargement(false);
    }
  }, [f, tri]);

  const maj = (cle, v) => setF((x) => ({ ...x, [cle]: v }));
  const majChamp = (id, cle, v) => setF((x) => ({ ...x, champs: { ...x.champs, [id]: { op: 'contient', ...(x.champs[id] || {}), [cle]: v } } }));
  const classe = useMemo(() => ref?.classes.find((c) => String(c.id) === String(f.classe_id)), [ref, f.classe_id]);

  const ouvrir = (r) => {
    const form = versFormulaire(r.criteres);
    setF(form);
    setCourante(r);
    lancer(form, 1);
  };
  const enregistrer = async () => {
    const nom = window.prompt('Nom de la recherche :', courante?.proprietaire ? courante.nom : '');
    if (!nom) return;
    try {
      const r = await rechercheService.enregistrer({ ...(courante?.proprietaire && courante.nom === nom ? { id: courante.id } : {}), nom, criteres: versApi(f) });
      setCourante(r);
      toast.success('Recherche enregistrée');
      chargerEnregistrees();
    } catch (err) { toast.error(err.response?.data?.message || 'Enregistrement impossible'); }
  };
  const basculer = async (r, cle) => {
    try {
      await rechercheService.enregistrer({ id: r.id, [cle]: !r[cle] });
      if (cle === 'alerte') toast.success(!r.alerte ? 'Alerte activée : vous serez prévenu des nouveaux documents' : 'Alerte désactivée');
      chargerEnregistrees();
    } catch (err) { toast.error(err.response?.data?.message || 'Action impossible'); }
  };
  const supprimer = async (r) => {
    if (!window.confirm(`Supprimer la recherche « ${r.nom} » ?`)) return;
    try { await rechercheService.supprimer(r.id); if (courante?.id === r.id) setCourante(null); chargerEnregistrees(); } catch (err) { toast.error(err.response?.data?.message || 'Suppression impossible'); }
  };
  const exporter = async () => {
    try {
      toast.info('Préparation du paquet d\'archive…');
      await rechercheService.paquet([...selection]);
    } catch (err) { toast.error(await messageBlob(err, 'Export impossible')); }
  };
  const facette = (cle, valeur) => {
    const form = cle === 'annee' ? { ...f, annee_min: valeur, annee_max: valeur } : cle === 'statut' ? { ...f, statuts: [valeur] } : { ...f, [`${cle}_id`]: valeur };
    setF(form);
    lancer(form, 1);
  };

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1400px] mx-auto">
      <PageHeader title="Recherche avancée" subtitle="Contenu des fichiers, fiche, propriétés de classe, classement, dates, intégrité"
        icon={Search} breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Recherche avancée' }]} />
      <div className="grid lg:grid-cols-[260px_1fr] gap-5">
        <aside className="space-y-4">
          <div className="glass-card-premium p-4">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Mes recherches</p>
            {enregistrees.length === 0 ? <p className="text-xs text-slate-400">Lancez une recherche puis enregistrez-la pour la retrouver ici.</p> : (
              <ul className="space-y-1">
                {enregistrees.map((r) => (
                  <li key={r.id} className={`flex items-center gap-1 rounded-lg px-2 py-1 ${courante?.id === r.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                    <button type="button" onClick={() => ouvrir(r)} className="flex-1 min-w-0 text-left text-sm truncate" title={r.description || r.nom}>
                      {r.nom}{!r.proprietaire && <span className="text-[10px] text-slate-400"> · {r.auteur || 'partagée'}</span>}
                    </button>
                    {r.proprietaire && (
                      <>
                        <button type="button" onClick={() => basculer(r, 'alerte')} title={r.alerte ? 'Alerte active' : 'Me prévenir des nouveaux documents'} className={r.alerte ? 'text-docuflow-secondary' : 'text-slate-300 hover:text-slate-500'}>{r.alerte ? <Bell size={13} /> : <BellOff size={13} />}</button>
                        <button type="button" onClick={() => basculer(r, 'partagee')} title={r.partagee ? 'Partagée avec l\'organisation' : 'Partager avec l\'organisation'} className={r.partagee ? 'text-emerald-600' : 'text-slate-300 hover:text-slate-500'}><Share2 size={13} /></button>
                        <button type="button" onClick={() => supprimer(r)} title="Supprimer" className="text-slate-300 hover:text-red-600"><Trash2 size={13} /></button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {res?.facettes && (
            <div className="glass-card-premium p-4 space-y-3 text-sm">
              {[['classe', 'Classe'], ['annee', 'Année'], ['statut', 'Statut'], ['dossier', 'Classement']].map(([cle, titre]) => res.facettes[cle]?.length > 0 && (
                <div key={cle}>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{titre}</p>
                  {res.facettes[cle].slice(0, 8).map((x) => (
                    <button key={String(x.valeur)} type="button" onClick={() => facette(cle, x.valeur)} className="w-full flex justify-between text-left text-xs py-0.5 hover:text-docuflow-secondary">
                      <span className="truncate">{x.libelle}</span><span className="text-slate-400">{x.n}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </aside>

        <div className="space-y-4 min-w-0">
          <form onSubmit={(e) => { e.preventDefault(); lancer(f, 1); }} className="glass-card-premium p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input className="input-premium flex-1" value={f.texte} onChange={(e) => maj('texte', e.target.value)} placeholder="Mots à chercher dans le contenu et la fiche…" autoFocus />
              <div className="flex gap-2">
                <button type="button" onClick={() => setFiltresOuverts((x) => !x)} className="btn btn-secondary"><SlidersHorizontal size={16} /> Critères</button>
                <button type="submit" disabled={chargement} className="btn btn-primary">{chargement ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Rechercher</button>
              </div>
            </div>
            {filtresOuverts && ref && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                <input className="input-premium" value={f.phrase} onChange={(e) => maj('phrase', e.target.value)} placeholder="Expression exacte" />
                <input className="input-premium" value={f.entreprise} onChange={(e) => maj('entreprise', e.target.value)} placeholder="Entreprise" />
                <input className="input-premium" value={f.reference} onChange={(e) => maj('reference', e.target.value)} placeholder="Référence" />
                <select className="input-premium" value={f.classe_id} onChange={(e) => setF({ ...f, classe_id: e.target.value, champs: {} })}>
                  <option value="">Toutes les classes</option><option value="aucune">Sans classe</option>
                  {ref.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className="input-premium" value={f.dossier_id} onChange={(e) => maj('dossier_id', e.target.value)}>
                  <option value="">Tous les dossiers</option>
                  {ref.dossiers.map((d) => <option key={d.id} value={d.id}>{d.chemin}</option>)}
                </select>
                <select className="input-premium" value={f.statuts[0] || ''} onChange={(e) => maj('statuts', e.target.value ? [e.target.value] : [])}>
                  <option value="">Tous les statuts</option>
                  {ref.statuts.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="flex gap-2">
                  <input type="number" className="input-premium" value={f.annee_min} onChange={(e) => maj('annee_min', e.target.value)} placeholder="Année de" />
                  <input type="number" className="input-premium" value={f.annee_max} onChange={(e) => maj('annee_max', e.target.value)} placeholder="à" />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500">Daté du<input type="date" className="input-premium" value={f.date_document_du} onChange={(e) => maj('date_document_du', e.target.value)} /></label>
                <label className="flex items-center gap-2 text-xs text-slate-500">au<input type="date" className="input-premium" value={f.date_document_au} onChange={(e) => maj('date_document_au', e.target.value)} /></label>
                <select className="input-premium" value={f.gel} onChange={(e) => maj('gel', e.target.value)}>
                  <option value="">Gel juridique : indifférent</option><option value="oui">Sous gel juridique</option><option value="non">Sans gel</option>
                </select>
                <select className="input-premium" value={f.integrite} onChange={(e) => maj('integrite', e.target.value)}>
                  <option value="">Intégrité : indifférente</option>
                  {ref.integrites.map((i) => <option key={i} value={i}>{INTEGRITE[i] || i}</option>)}
                </select>
                <select className="input-premium" value={f.type_fichier} onChange={(e) => maj('type_fichier', e.target.value)}>
                  <option value="">Tous types de fichier</option>
                  {ref.types_fichier.map((t) => <option key={t} value={t}>{TYPES[t] || t}</option>)}
                </select>
                {classe?.champs.map((c) => (
                  <label key={c.id} className="text-xs text-slate-500 space-y-1">
                    <span className="font-semibold">{c.label}</span>
                    {c.type === 'date' || c.type === 'number' ? (
                      <div className="flex gap-1">
                        <input type={c.type === 'date' ? 'date' : 'number'} className="input-premium" value={f.champs[c.id]?.min || ''} onChange={(e) => { majChamp(c.id, 'op', 'entre'); majChamp(c.id, 'min', e.target.value); }} />
                        <input type={c.type === 'date' ? 'date' : 'number'} className="input-premium" value={f.champs[c.id]?.max || ''} onChange={(e) => { majChamp(c.id, 'op', 'entre'); majChamp(c.id, 'max', e.target.value); }} />
                      </div>
                    ) : (
                      <input className="input-premium" value={f.champs[c.id]?.valeur || ''} onChange={(e) => majChamp(c.id, 'valeur', e.target.value)} placeholder="contient…" />
                    )}
                  </label>
                ))}
              </div>
            )}
          </form>

          {res && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-slate-700 mr-auto">{res.total} document(s)</span>
              <select className="input-premium w-auto py-1.5 text-sm" value={tri} onChange={(e) => { setTri(e.target.value); lancer(f, 1, e.target.value); }} aria-label="Tri">
                {Object.entries(LIBELLES_TRI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {can('search.documents') && <button type="button" onClick={enregistrer} className="btn btn-secondary btn-sm"><Save size={14} /> Enregistrer</button>}
              {selection.size > 0 && can('documents.download') && <button type="button" onClick={exporter} className="btn btn-primary btn-sm"><Package size={14} /> Paquet d'archive ({selection.size})</button>}
              {(courante || f !== VIDE) && <button type="button" onClick={() => { setF(VIDE); setCourante(null); setRes(null); }} className="text-xs text-slate-500 flex items-center gap-1"><X size={12} /> Effacer</button>}
            </div>
          )}

          {res && (res.resultats.length === 0 ? (
            <div className="glass-card-premium p-12 text-center"><Search size={32} className="mx-auto text-slate-300 mb-2" /><p className="font-bold text-slate-800">Aucun document ne correspond</p></div>
          ) : (
            <ul className="space-y-2">
              {res.resultats.map((d) => (
                <li key={d.id} className="glass-card-premium p-4 flex gap-3">
                  <input type="checkbox" className="mt-1" checked={selection.has(d.id)} aria-label="Sélectionner"
                    onChange={() => setSelection((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/documents/liste?doc=${d.id}`} className="font-bold text-docuflow-secondary hover:underline">{d.reference_mfile}</Link>
                      <span className="text-sm text-slate-700 truncate">{d.nom_entreprise}</span>
                      {d.gele && <span className="text-[10px] font-bold text-red-700 bg-red-50 px-1.5 py-0.5 rounded flex items-center gap-1"><Gavel size={10} /> Gel</span>}
                      {d.anomalie && <span className="text-[10px] font-bold text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded flex items-center gap-1"><ShieldAlert size={10} /> Intégrité</span>}
                    </div>
                    <p className="text-xs text-slate-500">{d.classe_nom || d.type_document || 'Document'} · {d.annee} · {d.statut}{d.dossier_nom ? ` · ${d.dossier_nom}` : ''} · {d.nb_fichiers} fichier(s)</p>
                    {d.extrait && <Extrait segments={d.extrait} />}
                  </div>
                </li>
              ))}
            </ul>
          ))}
          {res?.pages > 1 && (
            <div className="flex justify-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => lancer(f, page - 1)} className="btn btn-secondary btn-sm">Précédent</button>
              <span className="text-sm text-slate-500 self-center">Page {page} / {res.pages}</span>
              <button type="button" disabled={page >= res.pages} onClick={() => lancer(f, page + 1)} className="btn btn-secondary btn-sm">Suivant</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RecherchePage;
