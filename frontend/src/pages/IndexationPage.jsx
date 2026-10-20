import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Wand2, Sparkles, Check, CheckCheck, SkipForward, Save, ArrowLeft, Download, Loader2, FileQuestion, PartyPopper, RefreshCw,
} from 'lucide-react';
import { documentService } from '../services/documentService';
import { metadataApi } from '../services/metadataApi';
import { toast } from '../components/Toast';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Poste d'indexation — la file « À indexer », document par document.
 *
 * Disposition familière aux utilisateurs de M-Files ou d'Alfresco : l'aperçu
 * du document à gauche, sa FICHE DE MÉTADONNÉES à droite. Sous chaque champ,
 * la valeur proposée par l'indexation assistée (texte du document ou OCR),
 * avec l'extrait où elle a été trouvée — rien n'est rempli d'office.
 *
 * « Valider et suivant » (Ctrl+Entrée) enregistre la fiche, passe le document
 * à « Disponible » et ouvre le suivant : on indexe un lot sans revenir à la
 * liste. « Passer » le laisse pour plus tard.
 */

const TYPES_DE_BASE = ['Acte', 'Contrat', 'Rapport', 'PV', 'Lettre', 'Dossier', 'Autre'];
const REPLI = 'À indexer'; // valeur posée par le versement en masse : vaut « vide »
const vide = (v) => v === null || v === undefined || String(v).trim() === '' || String(v).trim() === REPLI;

const CHAMPS_FICHE = [
  { cle: 'description', libelle: 'Titre / description', type: 'text', requis: true, large: true },
  { cle: 'type_document', libelle: 'Type de document', type: 'type' },
  { cle: 'date_document', libelle: 'Date du document', type: 'date' },
  { cle: 'annee', libelle: 'Année', type: 'number' },
  { cle: 'nom_entreprise', libelle: 'Entreprise / sujet', type: 'text' },
  { cle: 'num_dossier', libelle: 'N° de dossier', type: 'text' },
  { cle: 'num_acte', libelle: 'N° d\'acte', type: 'text' },
];

const ficheDepuis = (doc) => Object.fromEntries(CHAMPS_FICHE.map(({ cle }) => {
  const v = doc?.[cle];
  if (cle === 'date_document') return [cle, v ? String(v).slice(0, 10) : ''];
  return [cle, vide(v) ? '' : String(v)];
}));

const IndexationPage = () => {
  useTitrePage('Poste d\'indexation');
  const navigate = useNavigate();
  const [file, setFile] = useState(null);          // ids « à indexer »
  const [position, setPosition] = useState(0);
  const [doc, setDoc] = useState(null);
  const [fiche, setFiche] = useState({});
  const [dossierId, setDossierId] = useState('');
  const [meta, setMeta] = useState({});            // fieldId → valeur
  const [communes, setCommunes] = useState([]);    // propriétés communes
  const [classes, setClasses] = useState([]);      // classes de documents
  const [classeId, setClasseId] = useState('');
  const [titreCalcule, setTitreCalcule] = useState('');
  const [dossiers, setDossiers] = useState([]);
  const [props, setProps] = useState({ texte: null, propositions: [] });
  const [acceptes, setAcceptes] = useState(new Set());
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [erreurs, setErreurs] = useState({});
  const formRef = useRef(null);

  // File et référentiels, une fois.
  useEffect(() => {
    (async () => {
      try {
        const r = await documentService.getDocuments({ statut: 'à indexer', page_size: 100 });
        setFile((r.documents || []).map((d) => d.id));
      } catch {
        setFile([]);
      }
      metadataApi.getSchemas().then((s) => {
        // Choix normalisés { value, label } : on affiche le libellé, on
        // enregistre la valeur (c'est elle que le serveur valide).
        const prepare = (fields) => (fields || []).map((f) => ({
          ...f,
          choix: (Array.isArray(f.options_json) && f.options_json.length ? f.options_json : (f.options || []))
            .map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value ?? o.label, label: o.label ?? o.value })),
        }));
        const liste = s || [];
        const defaut = liste.find((x) => x.is_default) || (liste.some((x) => x.code) ? null : liste[0]);
        setCommunes(prepare(defaut?.fields));
        setClasses(liste.filter((x) => x !== defaut).map((c) => ({ ...c, fields: prepare(c.fields) })));
      }).catch(() => { setCommunes([]); setClasses([]); });
      documentService.getFolders().then((f) => setDossiers(f.folders || f || [])).catch(() => setDossiers([]));
    })();
  }, []);

  const idCourant = file?.[position];

  const chargerPropositions = useCallback(async (id) => {
    try {
      setProps(await documentService.getSuggestions(id));
    } catch {
      setProps({ texte: 'aucun', propositions: [] });
    }
  }, []);

  // Document courant : fiche, métadonnées, propositions.
  useEffect(() => {
    if (!idCourant) { setChargement(false); return; }
    let annule = false;
    setChargement(true);
    setErreurs({});
    setAcceptes(new Set());
    (async () => {
      try {
        const [d, valeurs] = await Promise.all([
          documentService.getDocument(idCourant),
          metadataApi.getDocumentMetadata(idCourant).catch(() => []),
        ]);
        if (annule) return;
        setDoc(d);
        setFiche(ficheDepuis(d));
        setDossierId(d.dossier_id ? String(d.dossier_id) : '');
        setClasseId(d.classe_id ? String(d.classe_id) : '');
        setMeta(Object.fromEntries((valeurs || []).map((v) => [v.field_id, v.value ?? ''])));
        await chargerPropositions(idCourant);
      } catch (err) {
        if (!annule) toast.error(err.response?.data?.message || 'Document illisible');
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, [idCourant, chargerPropositions]);

  // Classe choisie : ses propriétés s'ajoutent aux propriétés communes.
  const avecClasses = classes.length > 0;
  const classe = classes.find((c) => String(c.id) === String(classeId)) || null;
  // L'ancienne propriété commune « Type de document » fait doublon avec la
  // classe (M-Files : la classe EST le type) : masquée dès qu'il y a des classes.
  const champsMeta = useMemo(
    () => [...communes.filter((c) => !(avecClasses && c.name === 'document_type')), ...(classe?.fields || [])],
    [communes, classe, avecClasses],
  );
  const titreAuto = Boolean(classe?.modele_nom);
  const champsFiche = useMemo(() => CHAMPS_FICHE.filter((c) => !(avecClasses && c.cle === 'type_document')), [avecClasses]);
  const visible = (champ) => {
    if (champ === 'classe_id') return avecClasses;
    if (champ.startsWith('meta:')) return champsMeta.some((c) => String(c.id) === champ.slice(5));
    if (champ === 'description') return !titreAuto;
    return champsFiche.some((c) => c.cle === champ);
  };

  const proposition = (champ) => props.propositions.find((p) => p.champ === champ);
  const valeurDe = (champ) => {
    if (champ === 'classe_id') return classeId;
    return champ.startsWith('meta:') ? meta[champ.slice(5)] : fiche[champ];
  };
  const enAttente = useMemo(
    () => props.propositions.filter((p) => visible(p.champ) && String(valeurDe(p.champ) ?? '') !== String(p.valeur)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props, fiche, meta, classeId, champsMeta, titreAuto],
  );

  // Titre calculé par la charte de nommage de la classe, en direct.
  useEffect(() => {
    if (!titreAuto) { setTitreCalcule(''); return undefined; }
    const t = setTimeout(async () => {
      try {
        setTitreCalcule(await metadataApi.apercuNom({
          modele: classe.modele_nom,
          classe_id: classe.id,
          valeurs: Object.fromEntries(champsMeta.filter((c) => !vide(meta[c.id])).map((c) => [c.id, meta[c.id]])),
          fiche: { ...fiche, reference_mfile: doc?.reference_mfile },
        }));
      } catch { setTitreCalcule(''); }
    }, 300);
    return () => clearTimeout(t);
  }, [titreAuto, classe, champsMeta, meta, fiche, doc]);

  const appliquer = (p) => {
    if (p.champ === 'classe_id') setClasseId(String(p.valeur));
    else if (p.champ.startsWith('meta:')) setMeta((m) => ({ ...m, [p.champ.slice(5)]: p.valeur }));
    else setFiche((f) => ({ ...f, [p.champ]: String(p.valeur) }));
    setAcceptes((s) => new Set(s).add(p.champ));
    setErreurs((e) => ({ ...e, [p.champ]: undefined }));
  };
  const toutAccepter = () => {
    // La classe d'abord : ses propriétés n'apparaissent qu'avec elle.
    const pc = proposition('classe_id');
    const cls = pc && String(classeId) !== String(pc.valeur) ? classes.find((c) => c.id === pc.valeur) : classe;
    const ids = new Set([...communes, ...(cls?.fields || [])].map((c) => String(c.id)));
    props.propositions
      .filter((p) => (p.champ === 'classe_id' ? avecClasses : p.champ.startsWith('meta:') ? ids.has(p.champ.slice(5)) : visible(p.champ)))
      .filter((p) => String(valeurDe(p.champ) ?? '') !== String(p.valeur))
      .forEach(appliquer);
  };

  const types = useMemo(() => {
    // Les types de l'organisation (servis avec les propositions) d'abord.
    const t = new Set([...(props.types || []), ...TYPES_DE_BASE]);
    if (fiche.type_document) t.add(fiche.type_document);
    const p = proposition('type_document');
    if (p) t.add(p.valeur);
    return [...t];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiche.type_document, props]);

  // « Passer » : le document reste dans la file ; après le dernier, on
  // revient au premier encore à indexer.
  const suivant = () => {
    if (!file?.length) return;
    setPosition((p) => (p + 1 < file.length ? p + 1 : 0));
  };

  const valider = async ({ indexer }) => {
    const manquants = {};
    if (indexer) {
      if (avecClasses && !classeId) manquants.classe_id = 'Choisissez la classe du document.';
      if (!titreAuto && vide(fiche.description)) manquants.description = 'Obligatoire pour retrouver le document.';
      champsMeta.filter((c) => c.required && vide(meta[c.id])).forEach((c) => { manquants[`meta:${c.id}`] = 'Champ obligatoire.'; });
    }
    setErreurs(manquants);
    if (Object.keys(manquants).length) {
      toast.error('Complétez les champs obligatoires avant de valider.');
      // Amener le premier champ manquant sous les yeux, curseur dedans.
      const premier = document.getElementById(`idx-${Object.keys(manquants)[0]}`);
      premier?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      premier?.focus({ preventScroll: true });
      return;
    }
    setEnvoi(true);
    try {
      // Propriétés d'abord : la fiche, enregistrée ensuite avec la classe,
      // déclenche côté serveur le titre (charte), le numéro et le rangement.
      const metadata = champsMeta.filter((c) => !vide(meta[c.id])).map((c) => ({ fieldId: c.id, value: c.type === 'number' ? Number(meta[c.id]) : meta[c.id] }));
      if (metadata.length) await documentService.setDocumentMetadata(idCourant, metadata);
      const corps = {};
      for (const { cle } of champsFiche) if (!vide(fiche[cle]) && !(cle === 'description' && titreAuto)) corps[cle] = fiche[cle];
      if (dossierId !== String(doc?.dossier_id || '')) corps.dossier_id = dossierId ? Number(dossierId) : null;
      if (classeId !== String(doc?.classe_id || '')) corps.classe_id = classeId ? Number(classeId) : null;
      let classement = null;
      if (Object.keys(corps).length) classement = (await documentService.updateDocument(idCourant, corps))?.classement;
      if (indexer && doc?.statut === 'à indexer') await documentService.setStatus(idCourant, 'disponible', 'Indexé depuis le poste d\'indexation');
      toast.success(`${indexer ? 'Document indexé' : 'Fiche enregistrée'}${classement?.nom ? ` : ${classement.nom}` : ''}`);
      if (indexer) {
        // Le document quitte la file : le suivant prend sa place.
        setFile((f) => f.filter((id) => id !== idCourant));
        setPosition((p) => Math.min(p, Math.max(0, (file?.length || 1) - 2)));
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Enregistrement impossible');
    } finally {
      setEnvoi(false);
    }
  };

  // Raccourcis : Ctrl+Entrée valide et passe au suivant (le geste le plus
  // fréquent du poste) ; Ctrl+→ passe.
  useEffect(() => {
    const surTouche = (e) => {
      if (!(e.ctrlKey || e.metaKey) || envoi || chargement || !idCourant) return;
      if (e.key === 'Enter') { e.preventDefault(); valider({ indexer: true }); }
      if (e.key === 'ArrowRight') { e.preventDefault(); suivant(); }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  });

  const fichier = doc?.files?.[0];
  const mime = fichier?.mime_type || '';

  // --- Rendu ---------------------------------------------------------------
  if (file && !file.length) {
    return (
      <div className="px-4 sm:px-8 py-16 max-w-xl mx-auto text-center">
        <PartyPopper size={44} className="mx-auto text-emerald-500 mb-4" />
        <h1 className="text-2xl font-black text-slate-900">Rien à indexer</h1>
        <p className="text-slate-500 mt-2">Tous les documents versés ont leur fiche. Les prochains scans arriveront ici.</p>
        <Link to="/documents/liste" className="btn btn-primary mt-6 inline-flex">Voir les documents</Link>
      </div>
    );
  }

  const Proposition = ({ champ }) => {
    const p = proposition(champ);
    if (!p || String(valeurDe(champ) ?? '') === String(p.valeur)) {
      return acceptes.has(champ) ? <p className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1"><Check size={12} /> Proposition acceptée</p> : null;
    }
    return (
      <div className="mt-1.5 flex items-start gap-2 text-[12px]">
        <button type="button" onClick={() => appliquer(p)}
          className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 font-semibold"
          title={`Trouvé : ${p.extrait}`}>
          <Sparkles size={12} /> {(() => { const t = String(p.affichage ?? p.valeur); return t.length > 40 ? `${t.slice(0, 40)}…` : t; })()}
        </button>
        <span className="text-slate-400 leading-snug pt-1 truncate" title={p.extrait}>
          {p.confiance === 'haute' ? 'trouvé' : 'déduit'} : « {p.extrait} »
        </span>
      </div>
    );
  };

  const champClasse = (cle) => `input-premium ${erreurs[cle] ? '!border-red-400' : ''} ${acceptes.has(cle) ? '!border-emerald-300 !bg-emerald-50/40' : ''}`;

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 h-full">
      <div className="max-w-[1500px] mx-auto">
        {/* Barre du poste */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => navigate('/documents/a-indexer')} className="btn btn-secondary btn-icon" title="Retour à la liste"><ArrowLeft size={16} /></button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-black text-slate-900 flex items-center gap-2"><Wand2 size={20} /> Poste d'indexation</h1>
              <p className="text-xs text-slate-500">
                {file ? `Document ${Math.min(position + 1, file.length)} sur ${file.length} à indexer` : 'Chargement de la file…'}
                {doc?.reference_mfile ? ` · ${doc.reference_mfile}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={suivant} disabled={!idCourant || envoi} className="btn btn-secondary" title="Laisser pour plus tard (Ctrl+→)">
              <SkipForward size={16} /> <span className="hidden sm:inline">Passer</span>
            </button>
            <button onClick={() => valider({ indexer: false })} disabled={!idCourant || envoi} className="btn btn-secondary" title="Enregistrer sans sortir de la file">
              <Save size={16} /> <span className="hidden sm:inline">Enregistrer</span>
            </button>
            <button onClick={() => valider({ indexer: true })} disabled={!idCourant || envoi} className="btn btn-primary" data-tour="valider-suivant" title="Ctrl+Entrée">
              {envoi ? <Loader2 size={16} className="animate-spin" /> : <CheckCheck size={16} />} Valider et suivant
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(380px,1fr)] gap-4 lg:h-[calc(100dvh-11rem)]">
          {/* Aperçu */}
          <section className="bg-slate-100 rounded-2xl border border-slate-200 overflow-hidden min-h-[50vh] flex flex-col" aria-label="Aperçu du document">
            <div className="px-4 py-2 bg-white border-b border-slate-200 flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-700 truncate">{fichier?.original_name || 'Aucun fichier'}</span>
              {fichier?.url && <a href={fichier.url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-xs"><Download size={14} /> Ouvrir</a>}
            </div>
            <div className="flex-1 min-h-0">
              {chargement ? (
                <div className="h-full skeleton" />
              ) : !fichier ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2"><FileQuestion size={36} /> Ce document n'a pas de fichier.</div>
              ) : mime === 'application/pdf' || mime.startsWith('text/') ? (
                <iframe src={fichier.url} title="Aperçu du document" className="w-full h-full min-h-[60vh] bg-white" />
              ) : mime.startsWith('image/') ? (
                <img src={fichier.url} alt="Aperçu du document" className="w-full h-full object-contain bg-white" />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3 p-6 text-center">
                  <FileQuestion size={36} /> Aperçu indisponible pour ce format.
                  <a href={fichier.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary"><Download size={16} /> Ouvrir le fichier</a>
                </div>
              )}
            </div>
          </section>

          {/* Fiche de métadonnées */}
          <section ref={formRef} className="bg-white rounded-2xl border border-slate-200 overflow-y-auto" aria-label="Fiche de métadonnées">
            <div className="px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Fiche de métadonnées</h2>
              {props.texte === 'en_attente' ? (
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  Lecture du scan en cours (OCR) — les propositions arriveront dans un instant.
                  <button onClick={() => chargerPropositions(idCourant)} className="flex items-center gap-1 font-bold"><RefreshCw size={12} /> Actualiser</button>
                </p>
              ) : enAttente.length > 0 ? (
                <div className="mt-2 text-xs text-violet-800 bg-violet-50 border border-violet-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <span><Sparkles size={13} className="inline mr-1" /> {enAttente.length} proposition{enAttente.length > 1 ? 's' : ''} tirée{enAttente.length > 1 ? 's' : ''} du document</span>
                  <button onClick={toutAccepter} className="font-bold flex items-center gap-1 hover:underline" data-tour="tout-accepter"><CheckCheck size={13} /> Tout accepter</button>
                </div>
              ) : props.texte === 'aucun' && !chargement ? (
                <p className="mt-2 text-xs text-slate-500">Aucun texte lisible dans ce document : saisissez la fiche à partir de l'aperçu.</p>
              ) : null}
            </div>

            <form className="p-5 grid grid-cols-2 gap-x-4 gap-y-4" onSubmit={(e) => { e.preventDefault(); valider({ indexer: true }); }}>
              {avecClasses && (
                <div className="col-span-2">
                  <label htmlFor="idx-classe_id" className="block text-xs font-bold text-slate-500 mb-1">Classe<span className="text-red-400"> *</span></label>
                  <select id="idx-classe_id" className={`${champClasse('classe_id')} font-semibold`} value={classeId}
                    onChange={(e) => { setClasseId(e.target.value); setErreurs((er) => ({ ...er, classe_id: undefined })); }}>
                    <option value="">— Choisir la classe du document —</option>
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>)}
                  </select>
                  {erreurs.classe_id && <p className="text-[11px] text-red-500 mt-1">{erreurs.classe_id}</p>}
                  <Proposition champ="classe_id" />
                </div>
              )}
              {champsFiche.map((c) => (c.cle === 'description' && titreAuto ? (
                <div key={c.cle} className="col-span-2">
                  <span className="block text-xs font-bold text-slate-500 mb-1">Titre <span className="font-normal text-slate-400">— calculé par la charte de nommage</span></span>
                  <p className="input-premium bg-slate-50 text-slate-800 font-semibold min-h-[2.6rem]" data-testid="titre-calcule">{titreCalcule || '…'}</p>
                </div>
              ) : (
                <div key={c.cle} className={c.large ? 'col-span-2' : 'col-span-2 sm:col-span-1'}>
                  <label htmlFor={`idx-${c.cle}`} className="block text-xs font-bold text-slate-500 mb-1">
                    {c.libelle}{c.requis && <span className="text-red-400"> *</span>}
                  </label>
                  {c.type === 'type' ? (
                    <select id={`idx-${c.cle}`} className={champClasse(c.cle)} value={fiche[c.cle] || ''} onChange={(e) => setFiche({ ...fiche, [c.cle]: e.target.value })}>
                      <option value="">—</option>
                      {types.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  ) : (
                    <input id={`idx-${c.cle}`} type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                      className={champClasse(c.cle)} value={fiche[c.cle] || ''} onChange={(e) => setFiche({ ...fiche, [c.cle]: e.target.value })} />
                  )}
                  {erreurs[c.cle] && <p className="text-[11px] text-red-500 mt-1">{erreurs[c.cle]}</p>}
                  <Proposition champ={c.cle} />
                </div>
              )))}

              <div className="col-span-2">
                <label htmlFor="idx-dossier" className="block text-xs font-bold text-slate-500 mb-1">Classer dans le dossier</label>
                <select id="idx-dossier" className="input-premium" value={dossierId} onChange={(e) => setDossierId(e.target.value)}>
                  <option value="">
                    {classe?.dossier_defaut_id
                      ? `Automatique : ${(dossiers.find((f) => f.id === classe.dossier_defaut_id)?.path || dossiers.find((f) => f.id === classe.dossier_defaut_id)?.name || 'dossier de la classe')}${classe.sous_dossier_annee ? ' / année' : ''}`
                      : 'Non classé'}
                  </option>
                  {dossiers.map((f) => <option key={f.id} value={f.id}>{f.path || f.name}</option>)}
                </select>
              </div>

              {champsMeta.map((c, i) => {
                const cle = `meta:${c.id}`;
                const v = meta[c.id] ?? '';
                const nbCommunes = champsMeta.length - (classe?.fields?.length || 0);
                const entete = i === 0 || (classe && i === nbCommunes)
                  ? (classe && i >= nbCommunes ? `Propriétés — ${classe.name}` : 'Propriétés communes') : null;
                return (
                  <React.Fragment key={c.id}>
                  {entete && <h3 className="col-span-2 text-xs font-bold text-slate-500 uppercase tracking-widest pt-2 border-t border-slate-100">{entete}</h3>}
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor={`idx-${cle}`} className="block text-xs font-bold text-slate-500 mb-1">
                      {c.label}{c.required && <span className="text-red-400"> *</span>}
                    </label>
                    {c.type === 'select' ? (
                      <select id={`idx-${cle}`} className={champClasse(cle)} value={v} onChange={(e) => setMeta({ ...meta, [c.id]: e.target.value })}>
                        <option value="">—</option>
                        {c.choix.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : c.type === 'boolean' ? (
                      <select id={`idx-${cle}`} className={champClasse(cle)} value={v === true ? 'true' : v === false ? 'false' : ''} onChange={(e) => setMeta({ ...meta, [c.id]: e.target.value === '' ? '' : e.target.value === 'true' })}>
                        <option value="">—</option><option value="true">Oui</option><option value="false">Non</option>
                      </select>
                    ) : (
                      <input id={`idx-${cle}`} type={c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text'}
                        className={champClasse(cle)} value={v} onChange={(e) => setMeta({ ...meta, [c.id]: e.target.value })} />
                    )}
                    {erreurs[cle] && <p className="text-[11px] text-red-500 mt-1">{erreurs[cle]}</p>}
                    <Proposition champ={cle} />
                  </div>
                  </React.Fragment>
                );
              })}
              <p className="col-span-2 text-[11px] text-slate-400 pt-2">Ctrl+Entrée : valider et passer au suivant · Ctrl+→ : passer</p>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};

export default IndexationPage;
