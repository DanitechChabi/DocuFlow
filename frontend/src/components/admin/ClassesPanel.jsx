import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Layers, Plus, Library, Trash2, Save, Loader2, FolderTree, Wand2, Check, X, Hash, Info,
} from 'lucide-react';
import { metadataApi } from '../../services/metadataApi';
import { documentService } from '../../services/documentService';
import { toast } from '../Toast';
import ConfirmDialog from '../ConfirmDialog';
import MetadataSchemaEditor from './MetadataSchemaEditor';

/**
 * Classes et propriétés — la configuration documentaire, sur le modèle de
 * M-Files :
 *
 *   PROPRIÉTÉS COMMUNES  affichées pour tout document (schéma par défaut) ;
 *   CLASSES              un type de pièce (Facture, Contrat, Prorogation…)
 *                        avec ses propres propriétés. Au poste d'indexation,
 *                        choisir la classe affiche ses propriétés.
 *
 * Chaque classe porte aussi sa CHARTE DE NOMMAGE (titre calculé) et sa place
 * dans le PLAN DE CLASSEMENT (rangement automatique). Les « Modèles DocuFlow »
 * installent des classes et des plans prêts à l'emploi, que l'organisation
 * adapte ensuite librement.
 */

const JETONS_FIXES = [
  { jeton: '{code}', aide: 'Code de la classe' },
  { jeton: '{année}', aide: 'Année du document' },
  { jeton: '{compteur}', aide: 'Numéro chronologique (0001, 0002…) par année' },
  { jeton: '{date}', aide: 'Date du document' },
  { jeton: '{entreprise}', aide: 'Entreprise / sujet de la fiche' },
];

// Valeurs d'exemple pour l'aperçu de la charte.
const exemple = (f) => {
  if (f.type === 'number') return 1250000;
  if (f.type === 'date') return new Date().toISOString().slice(0, 10);
  if (f.type === 'boolean') return true;
  if (f.type === 'select') {
    const o = (f.options_json || [])[0];
    return o ? (typeof o === 'string' ? o : o.value) : '';
  }
  return `[${f.label}]`;
};

const FicheClasse = ({ classe, communes, dossiers, onEnregistree, onSupprimer }) => {
  const [form, setForm] = useState({});
  const [apercu, setApercu] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    setForm({
      name: classe.name || '',
      code: classe.code || '',
      mots_cles: classe.mots_cles || '',
      modele_nom: classe.modele_nom || '',
      dossier_defaut_id: classe.dossier_defaut_id || '',
      sous_dossier_annee: Boolean(classe.sous_dossier_annee),
    });
  }, [classe]);

  const champs = useMemo(() => [...(classe.fields || []), ...(communes?.fields || [])], [classe, communes]);

  // Aperçu de la charte, calculé par le serveur (une seule implémentation).
  useEffect(() => {
    if (!form.modele_nom) { setApercu(''); return undefined; }
    const t = setTimeout(async () => {
      try {
        setApercu(await metadataApi.apercuNom({
          modele: form.modele_nom,
          classe_id: classe.id,
          valeurs: Object.fromEntries(champs.map((f) => [f.id, exemple(f)])),
          fiche: { nom_entreprise: '[Entreprise]', code: form.code, classe: form.name },
        }));
      } catch { setApercu(''); }
    }, 300);
    return () => clearTimeout(t);
  }, [form.modele_nom, form.code, form.name, classe.id, champs]);

  const inserer = (jeton) => setForm((f) => ({ ...f, modele_nom: `${f.modele_nom || ''}${jeton}` }));

  const enregistrer = async () => {
    if (!form.name.trim()) { toast.error('Le nom de la classe est obligatoire.'); return; }
    setEnvoi(true);
    try {
      await metadataApi.updateSchema(classe.id, {
        ...form,
        dossier_defaut_id: form.dossier_defaut_id ? Number(form.dossier_defaut_id) : null,
      });
      toast.success('Classe enregistrée');
      onEnregistree();
    } catch (err) {
      toast.error(err.response?.data?.error || err.response?.data?.message || 'Enregistrement impossible');
    } finally {
      setEnvoi(false);
    }
  };

  const champ = (cle, libelle, aide, props = {}) => (
    <label className="block">
      <span className="block text-xs font-bold text-slate-500 mb-1">{libelle}</span>
      <input className="input-premium" value={form[cle] ?? ''} onChange={(e) => setForm({ ...form, [cle]: e.target.value })} {...props} />
      {aide && <span className="block text-[11px] text-slate-400 mt-1">{aide}</span>}
    </label>
  );

  return (
    <div className="space-y-5">
      <div className="glass-card-premium p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-900">{classe.name}</h3>
            <p className="text-sm text-slate-500">
              {classe.nb_documents ? `${classe.nb_documents} document${classe.nb_documents > 1 ? 's' : ''} de cette classe` : 'Aucun document de cette classe pour l\'instant'}
            </p>
          </div>
          <button type="button" onClick={onSupprimer} className="btn btn-secondary text-red-600" title="Supprimer la classe">
            <Trash2 size={15} /> <span className="hidden sm:inline">Supprimer</span>
          </button>
        </div>
        <div className="grid sm:grid-cols-[1fr_140px] gap-4">
          {champ('name', 'Nom de la classe', null)}
          {champ('code', 'Code', 'Ex. FAC, CTR', { maxLength: 12, style: { textTransform: 'uppercase' } })}
        </div>
        {champ('mots_cles', 'Mots de reconnaissance', 'Séparés par des virgules. Trouvés dans le texte d\'un scan, ils font proposer cette classe à l\'indexation.')}
      </div>

      <div className="glass-card-premium p-5 space-y-3">
        <h4 className="font-bold text-slate-800 flex items-center gap-2"><Hash size={16} /> Charte de nommage</h4>
        <p className="text-sm text-slate-500">Le titre des documents de cette classe est calculé à partir de leurs propriétés. Laissez vide pour saisir le titre à la main.</p>
        <input className="input-premium font-mono text-sm" placeholder="Ex. {code}-{année}-{compteur} — {Fournisseur}"
          value={form.modele_nom ?? ''} onChange={(e) => setForm({ ...form, modele_nom: e.target.value })} />
        <div className="flex flex-wrap gap-1.5">
          {JETONS_FIXES.map((j) => (
            <button key={j.jeton} type="button" onClick={() => inserer(j.jeton)} title={j.aide}
              className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-mono">{j.jeton}</button>
          ))}
          {champs.map((f) => (
            <button key={f.id} type="button" onClick={() => inserer(`{${f.label}}`)} title="Propriété"
              className="px-2 py-1 rounded-md bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs">{`{${f.label}}`}</button>
          ))}
        </div>
        {form.modele_nom && (
          <p className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-slate-400">Exemple : </span><span className="font-semibold text-slate-800">{apercu || '…'}</span>
          </p>
        )}
      </div>

      <div className="glass-card-premium p-5 space-y-3">
        <h4 className="font-bold text-slate-800 flex items-center gap-2"><FolderTree size={16} /> Rangement dans le plan de classement</h4>
        <p className="text-sm text-slate-500">À l'indexation, un document de cette classe encore non classé est rangé ici automatiquement.</p>
        <select className="input-premium" value={form.dossier_defaut_id ?? ''} onChange={(e) => setForm({ ...form, dossier_defaut_id: e.target.value })}>
          <option value="">Pas de rangement automatique</option>
          {dossiers.map((d) => <option key={d.id} value={d.id}>{d.path || d.name}</option>)}
        </select>
        {form.dossier_defaut_id && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4" checked={Boolean(form.sous_dossier_annee)} onChange={(e) => setForm({ ...form, sous_dossier_annee: e.target.checked })} />
            Un sous-dossier par année (créé automatiquement)
          </label>
        )}
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={enregistrer} disabled={envoi} className="btn btn-primary">
          {envoi ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Enregistrer la classe
        </button>
      </div>
    </div>
  );
};

const Modeles = ({ onFermer, onInstalle }) => {
  const [catalogue, setCatalogue] = useState(null);
  const [choix, setChoix] = useState(new Set());
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => metadataApi.getModeles().then(setCatalogue).catch(() => setCatalogue({ classes: [], plans: [] })), []);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => {
    const surTouche = (e) => { if (e.key === 'Escape') onFermer(); };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onFermer]);

  const parCategorie = useMemo(() => {
    const m = new Map();
    for (const c of catalogue?.classes || []) m.set(c.categorie, [...(m.get(c.categorie) || []), c]);
    return [...m.entries()];
  }, [catalogue]);

  const basculer = (code) => setChoix((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });

  const installerClasses = async () => {
    setEnvoi(true);
    try {
      const r = await metadataApi.installerClasses([...choix]);
      toast.success(`${r.installees.length} classe${r.installees.length > 1 ? 's' : ''} installée${r.installees.length > 1 ? 's' : ''}`);
      setChoix(new Set());
      await charger();
      onInstalle();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Installation impossible');
    } finally {
      setEnvoi(false);
    }
  };

  const installerPlan = async (code) => {
    setEnvoi(true);
    try {
      const r = await metadataApi.installerPlan(code);
      toast.success(`Plan installé : ${r.crees} dossier${r.crees > 1 ? 's' : ''} créé${r.crees > 1 ? 's' : ''}${r.classesRattachees ? `, ${r.classesRattachees} classe(s) rangée(s)` : ''}`);
      await charger();
      onInstalle();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Installation impossible');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-3" onClick={onFermer}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90dvh] flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="titre-modeles">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 id="titre-modeles" className="text-lg font-black text-slate-900 flex items-center gap-2"><Library size={20} /> Modèles DocuFlow</h3>
            <p className="text-sm text-slate-500">Installez des classes et un plan de classement prêts à l'emploi, puis adaptez-les à votre organisation.</p>
          </div>
          <button onClick={onFermer} className="p-2 rounded-full hover:bg-slate-100 text-slate-400" aria-label="Fermer"><X size={20} /></button>
        </div>
        <div className="overflow-y-auto p-6 space-y-8">
          {!catalogue ? <div className="h-40 skeleton rounded-2xl" /> : (
            <>
              <section>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">1. Plan de classement</h4>
                <p className="text-sm text-slate-500 mb-3">L'arborescence codée de vos dossiers. Les dossiers existants sont conservés ; seuls les manquants sont créés.</p>
                <div className="grid md:grid-cols-2 gap-3">
                  {catalogue.plans.map((p) => (
                    <div key={p.code} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-bold text-slate-800">{p.nom}</span>
                        {p.installe ? <span className="text-xs text-emerald-600 font-bold flex items-center gap-1"><Check size={14} /> Installé</span> : (
                          <button type="button" disabled={envoi} onClick={() => installerPlan(p.code)} className="btn btn-secondary text-sm">Installer ce plan</button>
                        )}
                      </div>
                      <ul className="text-xs text-slate-600 space-y-1">
                        {p.arbre.map(([racine, enfants]) => (
                          <li key={racine}><span className="font-semibold">{racine}</span>{enfants.length > 0 && <span className="text-slate-400"> — {enfants.map((e) => e.replace(/^\d+\s*/, '')).join(', ')}</span>}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">2. Classes de documents</h4>
                <p className="text-sm text-slate-500 mb-3">Cochez les types de pièces que vous traitez. Chacun arrive avec ses propriétés, sa charte de nommage et son rangement.</p>
                {parCategorie.map(([categorie, classes]) => (
                  <div key={categorie} className="mb-5">
                    <h5 className="font-bold text-slate-700 mb-2">{categorie}</h5>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {classes.map((c) => (
                        <label key={c.code} className={`rounded-xl border p-3 flex gap-3 ${c.installee ? 'bg-slate-50 border-slate-100 opacity-70' : choix.has(c.code) ? 'border-violet-400 bg-violet-50/50 cursor-pointer' : 'border-slate-200 hover:border-slate-300 cursor-pointer'}`}>
                          <input type="checkbox" className="h-4 w-4 mt-0.5" disabled={c.installee} checked={c.installee || choix.has(c.code)} onChange={() => basculer(c.code)} />
                          <span className="min-w-0">
                            <span className="font-semibold text-slate-800 text-sm">{c.nom}</span>
                            <span className="ml-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{c.code}</span>
                            {c.installee && <span className="ml-1.5 text-[11px] text-emerald-600 font-bold">installée</span>}
                            <span className="block text-[11px] text-slate-500 mt-1 leading-snug">{c.champs.map((f) => f.label).join(' · ')}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <span className="text-sm text-slate-500">{choix.size ? `${choix.size} classe${choix.size > 1 ? 's' : ''} sélectionnée${choix.size > 1 ? 's' : ''}` : 'Rien n\'est modifié tant que vous n\'installez pas.'}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onFermer} className="btn btn-secondary">Fermer</button>
            <button type="button" disabled={!choix.size || envoi} onClick={installerClasses} className="btn btn-primary">
              {envoi ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Installer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ClassesPanel = () => {
  const [schemas, setSchemas] = useState(null);
  const [dossiers, setDossiers] = useState([]);
  const [selection, setSelection] = useState('communes');
  const [modeles, setModeles] = useState(false);
  const [aSupprimer, setASupprimer] = useState(null);

  const charger = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([metadataApi.getSchemas(), documentService.getFolders().catch(() => [])]);
      setSchemas(s || []);
      setDossiers(d?.folders || d || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Chargement des classes impossible');
      setSchemas([]);
    }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const communes = schemas?.find((s) => s.is_default) || null;
  const classes = (schemas || []).filter((s) => !s.is_default);
  const courant = selection === 'communes' ? communes : classes.find((c) => c.id === selection);

  // Saisie en ligne (pas de window.prompt : indisponible dans l'application de bureau).
  const [nouveauNom, setNouveauNom] = useState(null);
  const creerClasse = async (e) => {
    e.preventDefault();
    if (!nouveauNom || !nouveauNom.trim()) return;
    try {
      const c = await metadataApi.createSchema({ name: nouveauNom.trim() });
      setNouveauNom(null);
      await charger();
      setSelection(c.id);
      toast.success('Classe créée : ajoutez-lui ses propriétés');
    } catch (err) {
      toast.error(err.response?.data?.error || err.response?.data?.message || 'Création impossible');
    }
  };

  const supprimer = async () => {
    try {
      await metadataApi.deleteSchema(aSupprimer.id);
      toast.success('Classe supprimée');
      setSelection('communes');
      await charger();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Suppression impossible');
    } finally {
      setASupprimer(null);
    }
  };

  const enregistrerProprietes = async (fields) => {
    const res = await metadataApi.syncSchema(courant.id, fields);
    // Repartir des champs du serveur : voir MetadataSchemaPanel (ids temporaires).
    setSchemas((prev) => prev.map((s) => (s.id === courant.id ? { ...s, fields: res?.fields || fields } : s)));
  };

  if (!schemas) return <div className="grid gap-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-2xl skeleton" />)}</div>;

  return (
    <div className="space-y-5" data-tour="classes">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2"><Layers size={22} /> Classes et propriétés</h2>
          <p className="text-sm text-slate-500 max-w-2xl">
            Une classe est un type de pièce : Facture, Contrat, Prorogation… Au moment d'indexer, choisir la classe affiche ses propriétés,
            en plus des propriétés communes à tous les documents.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setModeles(true)} className="btn btn-secondary"><Library size={16} /> Modèles DocuFlow</button>
          <button type="button" onClick={() => setNouveauNom('')} className="btn btn-primary"><Plus size={16} /> Nouvelle classe</button>
        </div>
      </div>

      {nouveauNom !== null && (
        <form onSubmit={creerClasse} className="glass-card-premium p-4 flex flex-wrap items-center gap-3">
          <label htmlFor="nouvelle-classe" className="text-sm font-bold text-slate-600">Nom de la classe</label>
          <input id="nouvelle-classe" autoFocus className="input-premium flex-1 min-w-[200px]" placeholder="Ex. Facture, Contrat, Prorogation"
            value={nouveauNom} onChange={(e) => setNouveauNom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNouveauNom(null); }} />
          <button type="submit" className="btn btn-primary" disabled={!nouveauNom.trim()}><Check size={16} /> Créer</button>
          <button type="button" className="btn btn-secondary" onClick={() => setNouveauNom(null)}>Annuler</button>
        </form>
      )}

      {classes.length === 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900 flex items-start gap-3">
          <Wand2 size={18} className="flex-shrink-0 mt-0.5" />
          <span>
            Pour démarrer vite, ouvrez les <button type="button" onClick={() => setModeles(true)} className="font-bold underline">Modèles DocuFlow</button> :
            plan de classement et classes courantes (factures, contrats, courrier, RH, attestations…), prêts à adapter.
          </span>
        </div>
      )}

      <div className="grid lg:grid-cols-[280px_1fr] gap-5 items-start">
        <nav className="glass-card-premium p-2 space-y-0.5" aria-label="Classes">
          <button type="button" onClick={() => setSelection('communes')}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm ${selection === 'communes' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>
            <span className="font-bold">Propriétés communes</span>
            <span className={`block text-[11px] ${selection === 'communes' ? 'text-white/70' : 'text-slate-400'}`}>Pour tous les documents · {communes?.fields?.length || 0} propriété(s)</span>
          </button>
          <div className="px-3 pt-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Classes ({classes.length})</div>
          {classes.map((c) => (
            <button key={c.id} type="button" onClick={() => setSelection(c.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selection === c.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>
              <span className="font-semibold">{c.name}</span>
              {c.code && <span className={`ml-1.5 text-[10px] font-mono px-1 rounded ${selection === c.id ? 'bg-white/15' : 'bg-slate-100 text-slate-500'}`}>{c.code}</span>}
              <span className={`block text-[11px] ${selection === c.id ? 'text-white/70' : 'text-slate-400'}`}>
                {c.fields?.length || 0} propriété(s){c.nb_documents ? ` · ${c.nb_documents} doc.` : ''}
              </span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          {!courant ? (
            <div className="glass-card-premium p-8 text-center text-slate-500">Aucune propriété commune : utilisez « Provisionner » dans l'onglet Configuration.</div>
          ) : selection === 'communes' ? (
            <>
              <p className="text-sm text-slate-600 flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <Info size={16} className="flex-shrink-0 mt-0.5" />
                Ces propriétés apparaissent sur la fiche de TOUS les documents, quelle que soit leur classe (confidentialité, service propriétaire…).
              </p>
              <MetadataSchemaEditor key={`communes-${courant.id}`} initialSchema={courant.fields} onSave={enregistrerProprietes}
                titre="Propriétés communes" sousTitre="Affichées pour toutes les classes." libelleEnregistrer="Enregistrer les propriétés" />
            </>
          ) : (
            <>
              <FicheClasse classe={courant} communes={communes} dossiers={dossiers} onEnregistree={charger} onSupprimer={() => setASupprimer(courant)} />
              <MetadataSchemaEditor key={`classe-${courant.id}`} initialSchema={courant.fields} onSave={enregistrerProprietes}
                titre={`Propriétés de la classe « ${courant.name} »`} sousTitre="Affichées quand on indexe un document de cette classe."
                libelleEnregistrer="Enregistrer les propriétés" />
            </>
          )}
        </div>
      </div>

      {modeles && <Modeles onFermer={() => setModeles(false)} onInstalle={charger} />}
      <ConfirmDialog
        isOpen={Boolean(aSupprimer)}
        title="Supprimer la classe ?"
        message={`La classe « ${aSupprimer?.name} » et ses propriétés seront supprimées. C'est refusé si des documents l'utilisent.`}
        confirmLabel="Supprimer"
        onConfirm={supprimer}
        onClose={() => setASupprimer(null)}
      />
    </div>
  );
};

export default ClassesPanel;
