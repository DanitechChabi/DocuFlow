import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Table2, Plus, Trash2, Save, Loader2, ArrowDownToLine, ClipboardPaste, CheckCircle2, AlertTriangle, BookOpenText, Tags, Package, Eraser, FileSpreadsheet } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { toast } from '../components/Toast';
import { physiqueService, COULEURS } from '../services/physiqueService';
import ImportClasseur from '../components/archives/ImportClasseur';

/**
 * Saisie en tableau des dossiers papier. Une ligne par dossier : sa cote, ses
 * dates extrêmes, les propriétés de sa classe. À l'enregistrement, chaque
 * ligne devient une fiche — nommée par la charte, rangée dans sa boîte,
 * soumise à sa règle de conservation. Le tableau de traitement de texte que
 * l'on tenait à côté n'a plus lieu d'être : on peut d'ailleurs le coller ici.
 *
 * Le serveur contrôle TOUTES les lignes avant d'en créer une seule ; ses
 * erreurs reviennent cellule par cellule.
 */
const BROUILLON = 'docuflow:saisie:brouillon';
const LIGNES_DEPART = 8;
let compteur = 0;
const ligneVide = () => ({ cle: `l${Date.now()}-${compteur++}`, boite: '', cote: '', dates: '', v: {} });
const vide = (x) => x === null || x === undefined || String(x).trim() === '';
const remplie = (l) => !vide(l.boite) || !vide(l.cote) || !vide(l.dates) || Object.values(l.v).some((x) => !vide(x));

/** Clé de comparaison d'un libellé : sans accents, sans casse, « N° » → « n ». */
const cle = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/n[°º]/g, 'n ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Même lecture que le serveur : valeur, libellé, sigle seul ou intitulé seul. */
function trouverChoix(choix, brut) {
  const texte = String(brut).trim();
  const exact = choix.find((o) => o.value === texte || o.label === texte);
  if (exact) return exact;
  const k = cle(texte);
  if (!k) return null;
  for (const critere of [(o) => cle(o.label) === k || cle(o.value) === k, (o) => cle(o.label).startsWith(`${k} `), (o) => cle(o.label).endsWith(` ${k}`)]) {
    const trouves = choix.filter(critere);
    if (trouves.length) return trouves.length === 1 ? trouves[0] : null;
  }
  return null;
}

/** Bloc copié d'un tableur ou d'un tableau : tabulations, lignes, guillemets. */
function lireCollage(texte) {
  const t = String(texte).replace(/\r\n?/g, '\n');
  const lignes = [];
  let ligne = [];
  let cellule = '';
  let guillemets = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') { cellule += '"'; i += 1; } else if (c === '"') guillemets = false; else cellule += c;
    } else if (c === '"' && cellule === '') guillemets = true;
    else if (c === '\t') { ligne.push(cellule); cellule = ''; } else if (c === '\n') { ligne.push(cellule); lignes.push(ligne); ligne = []; cellule = ''; } else cellule += c;
  }
  if (cellule !== '' || ligne.length) { ligne.push(cellule); lignes.push(ligne); }
  return lignes.map((l) => l.map((x) => x.replace(/\s*\n\s*/g, ' ').trim())).filter((l) => l.some(Boolean));
}

// En-têtes reconnus pour les trois colonnes fixes d'un bordereau.
const ENTETES_FIXES = {
  boite: ['boite', 'boites', 'n boite', 'n de boite', 'numero de boite', 'n de la boite', 'cote de la boite'],
  cote: ['cote', 'cotes', 'cote du dossier', 'n d ordre', 'n ordre'],
  dates: ['dates extremes', 'date extreme', 'dates', 'periode', 'annees', 'annee'],
};

const LARGE = /\b(objet|intitule|description|observation|pieces|analyse|resume|motif|adresse)\b/;
const largeur = (c) => {
  if (c.fixe === 'cote') return 96;
  if (c.fixe === 'dates') return 116;
  if (c.fixe === 'boite') return 170;
  if (c.type === 'number') return 136;
  if (c.type === 'date') return 124;
  if (c.type === 'boolean') return 92;
  if (c.type === 'select') return 210;
  return LARGE.test(cle(c.libelle)) ? 280 : 180;
};

const Cellule = ({ colonne, valeur, erreur, exemple, onChange, onKeyDown, onPaste, id }) => {
  const commun = {
    id, value: valeur ?? '', onKeyDown, onPaste, title: erreur || undefined, 'aria-invalid': erreur ? true : undefined,
    'aria-label': colonne.libelle, className: `cellule${erreur ? ' fautive' : ''}${colonne.type === 'number' ? ' text-right tabular-nums' : ''}`,
    onChange: (e) => onChange(e.target.value),
  };
  if (colonne.type === 'select' || colonne.type === 'boolean') {
    const choix = colonne.type === 'boolean' ? [{ value: 'Oui', label: 'Oui' }, { value: 'Non', label: 'Non' }] : colonne.choix;
    const connu = vide(valeur) || choix.some((o) => o.value === valeur);
    return (
      <select {...commun}>
        <option value="">{colonne.defaut && choix.find((o) => o.value === colonne.defaut) ? `(${choix.find((o) => o.value === colonne.defaut).label})` : ''}</option>
        {choix.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        {!connu && <option value={valeur}>⚠ {valeur}</option>}
      </select>
    );
  }
  if (colonne.fixe === 'boite') {
    return <input {...commun} list="saisie-boites" placeholder={exemple ? 'B0001' : ''} autoComplete="off" />;
  }
  // L'exemple de format ne s'affiche que sur la première ligne : répété, il passerait pour une donnée.
  const indice = !exemple ? '' : colonne.fixe === 'dates' ? '2019-2021' : colonne.type === 'date' ? 'JJ/MM/AAAA' : colonne.type === 'multiselect' ? 'A ; B' : '';
  return <input {...commun} placeholder={indice} inputMode={colonne.type === 'number' ? 'decimal' : undefined} autoComplete="off" />;
};

const SaisieTableauPage = () => {
  const [params] = useSearchParams();
  const [modele, setModele] = useState(null);
  const [classeId, setClasseId] = useState('');
  const [boite, setBoite] = useState(''); // '' | identifiant | 'plusieurs'
  const [archiver, setArchiver] = useState(false);
  const [communes, setCommunes] = useState(false);
  const [lot, setLot] = useState({}); // propriétés communes obligatoires : une valeur pour toutes les lignes
  const [lignes, setLignes] = useState(() => Array.from({ length: LIGNES_DEPART }, ligneVide));
  const [erreurs, setErreurs] = useState({}); // « cléDeLigne:colonne » → message
  const [doublons, setDoublons] = useState(null);
  const [inconnues, setInconnues] = useState([]);
  const [nouvelles, setNouvelles] = useState({ parent_id: '', fonds: '', type_boite: '', couleur_etiquette: '' });
  const [envoi, setEnvoi] = useState(false);
  const [faits, setFaits] = useState([]);
  const [reprise, setReprise] = useState(false);
  const [importOuvert, setImportOuvert] = useState(false);
  const grille = useRef(null);

  const charger = useCallback(() => physiqueService.modeleSaisie().then((m) => { setModele(m); return m; }), []);

  // Modèle, puis brouillon ou réglages de l'adresse (?classe=…&boite=…).
  useEffect(() => {
    charger().then((m) => {
      let brouillon = null;
      try { brouillon = JSON.parse(localStorage.getItem(BROUILLON) || 'null'); } catch { brouillon = null; }
      const voulue = params.get('classe');
      const boiteVoulue = params.get('boite');
      if (brouillon?.lignes?.some(remplie) && m.classes.some((c) => String(c.id) === String(brouillon.classeId)) && !boiteVoulue && !voulue) {
        setClasseId(String(brouillon.classeId));
        setBoite(brouillon.boite === 'plusieurs' || m.boites.some((b) => String(b.id) === String(brouillon.boite)) ? String(brouillon.boite) : '');
        setLignes(brouillon.lignes.map((l) => ({ ...ligneVide(), ...l, cle: ligneVide().cle })));
        setLot(brouillon.lot || {});
        setReprise(true);
        if (params.get('import') === '1') setImportOuvert(true);
        return;
      }
      // « ?import=1 » : on arrive pour importer un classeur — l'assistant s'ouvre d'emblée.
      if (params.get('import') === '1' && (m.classes.length > 0 || m.peut_creer_classe)) setImportOuvert(true);
      if (voulue && m.classes.some((c) => String(c.id) === voulue)) setClasseId(voulue);
      if (boiteVoulue && m.boites.some((b) => String(b.id) === boiteVoulue)) setBoite(boiteVoulue);
    }).catch((err) => { toast.error(err.response?.data?.message || 'Chargement impossible'); setModele({ classes: [], communes: [], boites: [], tablettes: [] }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Brouillon : quarante lignes tapées ne se perdent pas sur un rechargement.
  useEffect(() => {
    if (!modele) return undefined;
    const t = setTimeout(() => {
      try {
        if (lignes.some(remplie)) localStorage.setItem(BROUILLON, JSON.stringify({ classeId, boite, lot, lignes: lignes.filter(remplie).map(({ boite: b, cote, dates, v }) => ({ boite: b, cote, dates, v })) }));
        else localStorage.removeItem(BROUILLON);
      } catch { /* stockage indisponible : la saisie continue */ }
    }, 600);
    return () => clearTimeout(t);
  }, [modele, classeId, boite, lot, lignes]);

  const classe = useMemo(() => modele?.classes.find((c) => String(c.id) === String(classeId)) || null, [modele, classeId]);
  const colonnes = useMemo(() => {
    if (!classe) return [];
    const fixes = [
      ...(boite === 'plusieurs' ? [{ id: 'boite', fixe: 'boite', libelle: 'Boîte', type: 'text' }] : []),
      { id: 'cote', fixe: 'cote', libelle: 'Cote', type: 'text' },
      { id: 'dates', fixe: 'dates', libelle: 'Dates extrêmes', type: 'text' },
    ];
    const proprietes = [...classe.colonnes, ...(communes ? modele.communes : [])].map((c) => ({ ...c, id: `c${c.id}`, champ: c.id }));
    return [...fixes, ...proprietes];
  }, [classe, modele, boite, communes]);
  // Propriétés communes obligatoires : demandées une fois, pour tout le lot.
  const pourLeLot = useMemo(() => (modele?.communes || []).filter((c) => c.obligatoire).map((c) => ({ ...c, champ: c.id })), [modele]);

  const valeurDe = (l, c) => (c.fixe ? l[c.fixe] : l.v[c.champ]) ?? '';
  const nbRemplies = lignes.filter(remplie).length;

  const modifier = (i, c, valeur) => {
    setLignes((ls) => {
      const suite = ls.map((l, j) => (j !== i ? l : c.fixe ? { ...l, [c.fixe]: valeur } : { ...l, v: { ...l.v, [c.champ]: valeur } }));
      // La dernière ligne reçoit du contenu : une ligne libre la suit toujours.
      return i === ls.length - 1 && !vide(valeur) ? [...suite, ligneVide()] : suite;
    });
    setErreurs((e) => { const k = `${lignes[i].cle}:${c.id}`; if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; });
    setDoublons(null);
  };

  const focus = (i, j) => requestAnimationFrame(() => grille.current?.querySelector(`#s-${i}-${colonnes[j]?.id}`)?.focus());
  const clavier = (e, i, j) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.shiftKey) { if (i > 0) focus(i - 1, j); return; }
    if (i === lignes.length - 1) setLignes((ls) => [...ls, ligneVide()]);
    focus(i + 1, j);
  };

  /** Collage d'un bloc : par en-têtes s'il en porte, sinon à partir de la cellule. */
  const coller = (e, i, j) => {
    const texte = e.clipboardData?.getData('text/plain') || '';
    if (!/[\t\n]/.test(texte.trim())) return; // une seule valeur : collage ordinaire
    e.preventDefault();
    let bloc = lireCollage(texte);
    if (!bloc.length) return;
    const parCle = new Map(colonnes.map((c) => [cle(c.libelle), c]));
    const colonneBoite = { id: 'boite', fixe: 'boite', libelle: 'Boîte', type: 'text' };
    const reconnaitre = (titre) => {
      const k = cle(titre);
      if (!k) return null;
      if (parCle.has(k)) return parCle.get(k);
      const fixe = Object.keys(ENTETES_FIXES).find((f) => ENTETES_FIXES[f].includes(k));
      if (fixe === 'boite') return colonneBoite;
      return fixe ? colonnes.find((c) => c.fixe === fixe) : null;
    };
    const entetes = bloc[0].map(reconnaitre);
    const reconnus = entetes.filter(Boolean).length;
    let cibles;
    if (reconnus >= 2 && reconnus >= bloc[0].filter(Boolean).length / 2) {
      const ignorees = bloc[0].filter((titre, k) => titre && !entetes[k]);
      if (entetes.some((c) => c?.fixe === 'boite') && boite !== 'plusieurs') setBoite('plusieurs');
      if (ignorees.length) toast.info(`Colonnes ignorées : ${ignorees.join(', ')}`, 7000);
      cibles = entetes;
      bloc = bloc.slice(1);
    } else cibles = bloc[0].map((_, k) => colonnes[j + k] || null);
    const lire = (c, brut) => {
      if (vide(brut)) return '';
      if (c.type === 'select') return trouverChoix(c.choix, brut)?.value ?? brut;
      if (c.type === 'boolean') return ['oui', 'o', 'vrai', 'x', '1'].includes(cle(brut)) ? 'Oui' : ['non', 'n', 'faux', '0'].includes(cle(brut)) ? 'Non' : brut;
      return brut;
    };
    setLignes((ls) => {
      const suite = [...ls];
      bloc.forEach((cellules, r) => {
        const l = { ...(suite[i + r] || ligneVide()) };
        l.v = { ...l.v };
        cellules.forEach((brut, k) => {
          const c = cibles[k];
          if (!c) return;
          if (c.fixe) l[c.fixe] = lire(c, brut); else l.v[c.champ] = lire(c, brut);
        });
        suite[i + r] = l;
      });
      return remplie(suite[suite.length - 1]) ? [...suite, ligneVide()] : suite;
    });
    setErreurs({});
    setDoublons(null);
    toast.success(`${bloc.length} ligne${bloc.length > 1 ? 's collées' : ' collée'}`);
  };

  /** Recopie vers le bas : chaque cellule vide prend la valeur du dessus. */
  const recopier = (c) => setLignes((ls) => {
    const dernier = ls.reduce((d, l, i) => (remplie(l) ? i : d), -1);
    let dessus = '';
    return ls.map((l, i) => {
      const v = valeurDe(l, c);
      if (!vide(v)) { dessus = v; return l; }
      if (i > dernier || vide(dessus)) return l;
      return c.fixe ? { ...l, [c.fixe]: dessus } : { ...l, v: { ...l.v, [c.champ]: dessus } };
    });
  });

  const vider = () => {
    if (nbRemplies && !window.confirm('Vider le tableau ? Les lignes non enregistrées seront perdues.')) return;
    setLignes(Array.from({ length: LIGNES_DEPART }, ligneVide));
    setErreurs({}); setDoublons(null); setInconnues([]); setReprise(false);
  };

  const enregistrer = async (accepterDoublons = false) => {
    if (!classe) { toast.error('Choisissez la classe des dossiers à saisir.'); return; }
    if (!nbRemplies) { toast.error('Remplissez au moins une ligne.'); return; }
    const manquante = pourLeLot.find((c) => vide(lot[c.champ]) && vide(c.defaut) && lignes.some((l) => remplie(l) && vide(l.v[c.champ])));
    if (manquante) {
      toast.error(`Choisissez « ${manquante.libelle} » pour toutes les lignes.`);
      document.getElementById(`lot-${manquante.champ}`)?.focus();
      return;
    }
    const proprietes = [...classe.colonnes, ...modele.communes];
    const envoyees = lignes;
    const corps = {
      classe_id: classe.id, archiver, accepter_doublons: accepterDoublons,
      emplacement_id: boite && boite !== 'plusieurs' ? Number(boite) : null,
      lignes: envoyees.map((l) => (!remplie(l) ? {} : {
        cote: l.cote, dates: l.dates, ...(boite === 'plusieurs' ? { boite: l.boite } : {}),
        // Une cellule laissée vide prend la valeur du lot, sinon la valeur par défaut de sa propriété.
        valeurs: Object.fromEntries(proprietes.map((c) => [c.id, !vide(l.v[c.id]) ? l.v[c.id] : !vide(lot[c.id]) ? lot[c.id] : (c.defaut ?? '')])),
      })),
    };
    setEnvoi(true);
    try {
      const r = await physiqueService.saisir(corps);
      const cotes = new Set(r.crees.map((c) => c.ligne));
      setFaits((f) => [...r.crees.map((c) => ({ ...c, classe: r.classe.nom })), ...f]);
      setLignes(() => {
        const reste = envoyees.filter((l, i) => !cotes.has(i) && remplie(l));
        return [...reste, ...Array.from({ length: Math.max(1, LIGNES_DEPART - reste.length) }, ligneVide)];
      });
      setErreurs({}); setDoublons(null); setInconnues([]); setReprise(false);
      grille.current?.scrollTo({ left: 0, top: 0 });
      if (r.interrompu) toast.error(r.interrompu.message, 9000);
      else toast.success(`${r.crees.length} dossier${r.crees.length > 1 ? 's enregistrés' : ' enregistré'}`);
      charger().catch(() => {});
    } catch (err) {
      const d = err.response?.data || {};
      if (d.code === 'LIGNES_INVALIDES') {
        setErreurs(Object.fromEntries((d.erreurs || []).map((x) => [`${envoyees[x.ligne]?.cle}:${x.colonne}`, x.message])));
        // Une erreur sur une propriété commune : sa colonne doit se voir.
        if ((d.erreurs || []).some((x) => modele.communes.some((c) => `c${c.id}` === x.colonne))) setCommunes(true);
        setInconnues(d.boites_inconnues || []);
        setDoublons(null);
        const premiere = (d.erreurs || [])[0];
        if (premiere) focus(premiere.ligne, Math.max(0, colonnes.findIndex((c) => c.id === premiere.colonne)));
        toast.error(d.message);
      } else if (d.code === 'DOUBLONS') {
        setDoublons(d.doublons || []);
      } else toast.error(d.message || 'Enregistrement impossible');
    } finally { setEnvoi(false); }
  };

  const creerBoites = async () => {
    if (!nouvelles.parent_id) { toast.error('Choisissez la tablette où poser ces boîtes.'); return; }
    setEnvoi(true);
    try {
      for (const code of inconnues) {
        // eslint-disable-next-line no-await-in-loop
        await physiqueService.creer({
          type: 'boite', code, parent_id: Number(nouvelles.parent_id), fonds: nouvelles.fonds || undefined,
          type_boite: nouvelles.type_boite || undefined, couleur_etiquette: nouvelles.couleur_etiquette || undefined,
        });
      }
      toast.success(`${inconnues.length} boîte${inconnues.length > 1 ? 's créées' : ' créée'}`);
      setInconnues([]);
      setErreurs((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.endsWith(':boite'))));
      await charger();
    } catch (err) { toast.error(err.response?.data?.message || 'Création des boîtes impossible'); charger().catch(() => {}); } finally { setEnvoi(false); }
  };

  const listeErreurs = useMemo(() => lignes.flatMap((l, i) => colonnes.filter((c) => erreurs[`${l.cle}:${c.id}`]).map((c) => ({ i, j: colonnes.indexOf(c), colonne: c.libelle, message: erreurs[`${l.cle}:${c.id}`] }))), [lignes, colonnes, erreurs]);
  const boiteChoisie = modele?.boites.find((b) => String(b.id) === String(boite));
  const boitesFaites = useMemo(() => [...new Set(faits.map((f) => f.boite).filter(Boolean))].map((cote) => modele?.boites.find((b) => b.cote === cote)).filter(Boolean), [faits, modele]);

  return (
    <div className="px-4 sm:px-8 pt-6 pb-28 max-w-[1500px] mx-auto">
      <PageHeader title="Saisie en tableau" subtitle="Une ligne par dossier papier : la fiche est créée, nommée et rangée dans sa boîte"
        icon={Table2} breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Magasins', to: '/documents/magasins' }, { label: 'Saisie en tableau' }]}
        actions={modele && (modele.classes.length > 0 || modele.peut_creer_classe) && (
          <button type="button" onClick={() => setImportOuvert(true)} className="btn btn-secondary"><FileSpreadsheet size={16} className="text-emerald-600" /> Importer un classeur Excel</button>
        )} />
      {importOuvert && (
        <ImportClasseur modele={modele} emplacementInitial={boite && boite !== 'plusieurs' ? boite : ''} lotInitial={lot} onLot={setLot}
          onFerme={() => setImportOuvert(false)}
          onImporte={({ crees, classe: c }) => { setFaits((f) => [...crees.map((x) => ({ ...x, classe: c.nom })), ...f]); charger().catch(() => {}); }} />
      )}

      {modele === null ? <div className="h-40 skeleton rounded-2xl" /> : modele.classes.length === 0 ? (
        <div className="glass-card-premium p-10 text-center">
          <Table2 size={34} className="mx-auto text-slate-300 mb-2" />
          <p className="font-bold text-slate-800">Aucune classe de documents</p>
          <p className="text-sm text-slate-500 mt-1 max-w-xl mx-auto">Les colonnes du tableau sont les propriétés d'une classe (dossier de marché, contrat, acte…). Installez les classes dont vous avez besoin{modele.peut_creer_classe ? ', ou importez un classeur Excel : la classe sera créée d\'après ses colonnes' : ''}.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            <Link to="/documents/classes" className="btn btn-primary btn-sm">Classes et plan</Link>
            {modele.peut_creer_classe && <button type="button" onClick={() => setImportOuvert(true)} className="btn btn-secondary btn-sm"><FileSpreadsheet size={14} className="text-emerald-600" /> Importer un classeur Excel</button>}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="glass-card-premium p-4 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-start">
            <label className="block">
              <span className="text-xs font-bold text-slate-600">Classe des dossiers</span>
              <select className="input-premium mt-1" value={classeId} onChange={(e) => { setClasseId(e.target.value); setErreurs({}); setDoublons(null); }}>
                <option value="">— Choisir —</option>
                {modele.classes.map((c) => <option key={c.id} value={c.id}>{c.nom}{c.code ? ` (${c.code})` : ''}</option>)}
              </select>
              {classe && (
                <span className="block text-xs text-slate-500 mt-1">
                  {classe.modele_nom ? <>Titre calculé : <span className="font-mono">{classe.modele_nom}</span></> : 'Sans charte de nommage : le dossier porte le nom de sa classe.'}
                  {classe.conservation ? ` · conservé ${classe.conservation.dua_annees} an${classe.conservation.dua_annees > 1 ? 's' : ''}` : ''}
                </span>
              )}
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-600">Boîte</span>
              <select className="input-premium mt-1" value={boite} onChange={(e) => { setBoite(e.target.value); setErreurs({}); }}>
                <option value="">— Pas encore rangés —</option>
                <option value="plusieurs">Plusieurs boîtes : une colonne « Boîte » dans le tableau</option>
                {modele.boites.map((b) => <option key={b.id} value={b.id}>{b.cote}{b.libelle ? ` — ${b.libelle}` : ''}{b.type === 'tablette' ? ' (tablette)' : ''}</option>)}
              </select>
              <span className="block text-xs text-slate-500 mt-1">
                {boiteChoisie ? [boiteChoisie.fonds && `Fonds ${boiteChoisie.fonds}`, boiteChoisie.type_boite, `${boiteChoisie.nb_documents} dossier(s) déjà dans cette boîte`].filter(Boolean).join(' · ')
                  : boite === 'plusieurs' ? 'Écrivez le code de la boîte (B0012) ou sa cote complète sur chaque ligne.'
                    : <>Les boîtes se décrivent dans <Link to="/documents/magasins" className="text-docuflow-secondary font-bold hover:underline">Magasins</Link>.</>}
              </span>
            </label>
            <div className="space-y-2 text-sm">
              {modele.peut_archiver && (
                <label className="flex items-start gap-2 cursor-pointer max-w-xs">
                  <input type="checkbox" className="mt-0.5" checked={archiver} onChange={(e) => setArchiver(e.target.checked)} />
                  <span><span className="font-bold text-slate-700">Dossiers clos</span><span className="block text-xs text-slate-500">Archivés dès l'enregistrement (lecture seule) ; la durée de conservation court de leur clôture.</span></span>
                </label>
              )}
              {modele.communes.length > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={communes} onChange={(e) => setCommunes(e.target.checked)} />
                  <span className="text-slate-700">Propriétés communes en colonnes</span>
                </label>
              )}
            </div>
          </section>

          {classe && pourLeLot.length > 0 && (
            <section className="glass-card-premium px-4 py-3 flex flex-wrap items-end gap-3">
              <p className="text-xs font-bold text-slate-600 w-full sm:w-auto sm:pb-2.5">Pour toutes les lignes</p>
              {pourLeLot.map((c) => (
                <label key={c.id} className="block">
                  <span className="text-xs text-slate-600">{c.libelle} <span className="text-red-600">*</span></span>
                  {c.type === 'select' || c.type === 'boolean' ? (
                    <select id={`lot-${c.champ}`} className="input-premium mt-1 w-52" value={lot[c.champ] ?? ''} onChange={(e) => setLot((x) => ({ ...x, [c.champ]: e.target.value }))}>
                      <option value="">{!vide(c.defaut) && c.choix.find((o) => o.value === c.defaut) ? `(${c.choix.find((o) => o.value === c.defaut).label})` : '— Choisir —'}</option>
                      {(c.type === 'boolean' ? [{ value: 'Oui', label: 'Oui' }, { value: 'Non', label: 'Non' }] : c.choix).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input id={`lot-${c.champ}`} className="input-premium mt-1 w-52" value={lot[c.champ] ?? ''} onChange={(e) => setLot((x) => ({ ...x, [c.champ]: e.target.value }))}
                      placeholder={c.type === 'date' ? 'JJ/MM/AAAA' : ''} />
                  )}
                </label>
              ))}
              <p className="text-xs text-slate-500 sm:pb-2.5">Ces propriétés sont obligatoires pour tout document de l'organisation.</p>
            </section>
          )}

          {reprise && (
            <p className="text-sm text-slate-600 flex flex-wrap items-center gap-2 px-1">
              <ClipboardPaste size={15} className="text-docuflow-secondary" /> Saisie reprise là où vous l'aviez laissée ({nbRemplies} ligne{nbRemplies > 1 ? 's' : ''}).
              <button type="button" onClick={vider} className="text-docuflow-secondary font-bold hover:underline">Repartir d'un tableau vide</button>
            </p>
          )}

          {!classe ? (
            <div className="glass-card-premium p-10 text-center text-sm text-slate-500">Choisissez une classe : ses propriétés deviennent les colonnes du tableau.</div>
          ) : (
            <>
              <p className="text-xs text-slate-500 px-1">
                <kbd className="px-1 rounded border border-slate-300 bg-white">Entrée</kbd> descend d'une ligne. Vous pouvez <strong>coller un tableau</strong> copié depuis Excel ou Word (ou importer tout un classeur, bouton en haut) : avec sa ligne de titres, les colonnes sont reconnues par leur nom ; sans titres, le collage part de la cellule active. <ArrowDownToLine size={12} className="inline" /> recopie une valeur vers le bas.
              </p>
              <div className="glass-card-premium overflow-auto max-h-[62vh]" ref={grille}>
                <table className="grille-saisie">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }} className="text-center">N°</th>
                      {colonnes.map((c) => (
                        <th key={c.id} style={{ minWidth: largeur(c), width: largeur(c) }}>
                          <span className="flex items-center gap-1">
                            <span className="truncate" title={c.libelle}>{c.libelle}{c.obligatoire && <span className="text-red-600" aria-label="obligatoire"> *</span>}</span>
                            <button type="button" onClick={() => recopier(c)} className="ml-auto text-slate-400 hover:text-docuflow-secondary flex-shrink-0" title={`Recopier « ${c.libelle} » vers le bas`} aria-label={`Recopier ${c.libelle} vers le bas`}><ArrowDownToLine size={13} /></button>
                          </span>
                        </th>
                      ))}
                      <th style={{ width: 40 }} aria-label="Retirer la ligne" />
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((l, i) => (
                      <tr key={l.cle} className={doublons?.some((d) => d.ligne === i) ? 'doublon' : undefined}>
                        <td className="text-center text-xs text-slate-400 tabular-nums select-none">{i + 1}</td>
                        {colonnes.map((c, j) => (
                          <td key={c.id}>
                            <Cellule id={`s-${i}-${c.id}`} colonne={c} valeur={valeurDe(l, c)} erreur={erreurs[`${l.cle}:${c.id}`]} exemple={i === 0}
                              onChange={(v) => modifier(i, c, v)} onKeyDown={(e) => clavier(e, i, j)} onPaste={(e) => coller(e, i, j)} />
                          </td>
                        ))}
                        <td className="text-center">
                          {remplie(l) && <button type="button" onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((x) => x.cle !== l.cle) : [ligneVide()]))} className="text-slate-400 hover:text-red-600 p-1" aria-label={`Retirer la ligne ${i + 1}`} title="Retirer la ligne"><Trash2 size={13} /></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id="saisie-boites">{modele.boites.map((b) => <option key={b.id} value={b.cote}>{b.libelle || ''}</option>)}</datalist>
              </div>

              {listeErreurs.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm" role="alert">
                  <p className="font-bold text-red-800 flex items-center gap-2"><AlertTriangle size={15} /> {listeErreurs.length} cellule{listeErreurs.length > 1 ? 's' : ''} à corriger — rien n'a été enregistré</p>
                  <ul className="mt-1.5 space-y-0.5 max-h-40 overflow-auto">
                    {listeErreurs.map((e) => (
                      <li key={`${e.i}-${e.j}`}><button type="button" onClick={() => focus(e.i, e.j)} className="text-left text-red-800 hover:underline"><strong>Ligne {e.i + 1}, {e.colonne}</strong> : {e.message}</button></li>
                    ))}
                  </ul>
                </div>
              )}

              {inconnues.length > 0 && modele.peut_creer_boites && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm space-y-2">
                  <p className="font-bold text-amber-900 flex items-center gap-2"><Package size={15} /> {inconnues.length > 1 ? `${inconnues.length} boîtes n'existent pas encore` : "Une boîte n'existe pas encore"} : <span className="font-mono">{inconnues.join(', ')}</span></p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block"><span className="text-xs font-bold text-amber-900">Sur la tablette</span>
                      <select className="input-premium mt-1 w-56" value={nouvelles.parent_id} onChange={(e) => setNouvelles((n) => ({ ...n, parent_id: e.target.value }))}>
                        <option value="">— Choisir —</option>
                        {modele.tablettes.map((t) => <option key={t.id} value={t.id}>{t.cote}{t.libelle ? ` — ${t.libelle}` : ''}</option>)}
                      </select>
                    </label>
                    <label className="block"><span className="text-xs font-bold text-amber-900">Fonds</span>
                      <input className="input-premium mt-1 w-40" value={nouvelles.fonds} onChange={(e) => setNouvelles((n) => ({ ...n, fonds: e.target.value }))} placeholder="PRMP" />
                    </label>
                    <label className="block"><span className="text-xs font-bold text-amber-900">Étiquette</span>
                      <select className="input-premium mt-1 w-32" value={nouvelles.couleur_etiquette} onChange={(e) => setNouvelles((n) => ({ ...n, couleur_etiquette: e.target.value }))}>
                        <option value="">—</option>
                        {Object.entries(COULEURS).map(([k, [nom]]) => <option key={k} value={k}>{nom}</option>)}
                      </select>
                    </label>
                    <button type="button" disabled={envoi} onClick={creerBoites} className="btn btn-secondary btn-sm"><Plus size={14} /> Créer {inconnues.length > 1 ? 'ces boîtes' : 'cette boîte'}</button>
                  </div>
                  {modele.tablettes.length === 0 && <p className="text-xs text-amber-900">Aucune tablette n'est décrite : commencez par <Link to="/documents/magasins" className="font-bold underline">Magasins</Link>.</p>}
                </div>
              )}

              {doublons && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm" role="alert">
                  <p className="font-bold text-amber-900 flex items-center gap-2"><AlertTriangle size={15} /> {doublons.length} ligne{doublons.length > 1 ? 's ressemblent' : ' ressemble'} à un dossier déjà saisi — rien n'a été enregistré</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {doublons.map((d) => (
                      <li key={d.ligne} className="text-amber-900"><strong>Ligne {d.ligne + 1}</strong> : {d.motif} {d.document_id && <Link to={`/documents/liste?doc=${d.document_id}`} target="_blank" className="underline">Voir {d.reference}</Link>}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    <button type="button" disabled={envoi} onClick={() => enregistrer(true)} className="btn btn-secondary btn-sm">Enregistrer quand même</button>
                    <button type="button" onClick={() => setDoublons(null)} className="btn btn-ghost btn-sm">Corriger le tableau</button>
                  </div>
                </div>
              )}

              {/* L'action principale à gauche : à droite, les boutons flottants la recouvriraient. */}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={envoi || !nbRemplies} onClick={() => enregistrer(false)} className="btn btn-primary">
                  {envoi ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Enregistrer {nbRemplies > 0 ? `${nbRemplies} dossier${nbRemplies > 1 ? 's' : ''}` : ''}
                </button>
                <span className="text-sm text-slate-500">{nbRemplies} ligne{nbRemplies > 1 ? 's' : ''} remplie{nbRemplies > 1 ? 's' : ''}{modele.limite && nbRemplies > modele.limite ? ` — ${modele.limite} au plus par enregistrement` : ''}</span>
                <span className="flex flex-wrap gap-2 sm:ml-6">
                  <button type="button" onClick={() => setLignes((ls) => [...ls, ...Array.from({ length: 10 }, ligneVide)])} className="btn btn-secondary btn-sm"><Plus size={14} /> 10 lignes</button>
                  <button type="button" onClick={vider} disabled={!nbRemplies} className="btn btn-ghost btn-sm"><Eraser size={14} /> Vider</button>
                </span>
              </div>
            </>
          )}

          {faits.length > 0 && (
            <section className="glass-card-premium p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h2 className="font-bold text-slate-800 flex items-center gap-2"><CheckCircle2 size={17} className="text-emerald-600" /> {faits.length} dossier{faits.length > 1 ? 's enregistrés' : ' enregistré'} pendant cette saisie</h2>
                <span className="ml-auto flex flex-wrap gap-2">
                  {boitesFaites.slice(0, 4).map((b) => (
                    <React.Fragment key={b.id}>
                      <Link to={`/documents/magasins/${b.id}/repertoire`} className="btn btn-secondary btn-sm"><BookOpenText size={14} /> Répertoire {b.code}</Link>
                      <Link to={`/documents/magasins/${b.id}/etiquettes`} className="btn btn-secondary btn-sm"><Tags size={14} /> Étiquette {b.code}</Link>
                    </React.Fragment>
                  ))}
                </span>
              </div>
              <ul className="divide-y divide-slate-100 text-sm max-h-72 overflow-auto">
                {faits.slice(0, 200).map((f) => (
                  <li key={f.id} className="py-1.5 flex flex-wrap items-baseline gap-x-3">
                    <Link to={`/documents/liste?doc=${f.id}`} className="font-bold text-docuflow-secondary hover:underline">{f.titre || f.classe}</Link>
                    <span className="text-xs text-slate-400 font-mono">{f.reference}</span>
                    <span className="text-xs text-slate-500 ml-auto">{f.boite ? <>Boîte <span className="font-mono">{f.boite}</span>{f.cote ? ` · cote ${f.cote}` : ''}</> : 'Pas encore rangé'}</span>
                  </li>
                ))}
                {faits.length > 200 && <li className="py-1.5 text-xs text-slate-500">… et {(faits.length - 200).toLocaleString('fr-FR')} autres, à retrouver dans <Link to="/documents/liste" className="font-bold text-docuflow-secondary hover:underline">Documents</Link>.</li>}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default SaisieTableauPage;
