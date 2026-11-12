import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, UploadCloud, Loader2, X, ArrowRight, ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import { physiqueService } from '../../services/physiqueService';
import { lireClasseur, trouverTitres, decrireColonnes, afficher, cle, LIGNES_MAX_AFFICHEES } from '../../utils/classeur';

/**
 * Import d'un classeur quelconque, en trois temps :
 *   1. choisir le classeur (Excel .xlsx ou .xls, LibreOffice, CSV) ;
 *   2. vérifier ce que devient chaque colonne — reconnue par son titre quand
 *      une classe l'attend ; sinon, une classe est créée d'après les colonnes ;
 *   3. importer : toutes les lignes sont contrôlées d'abord, puis créées par
 *      paquets, avec leur avancement.
 * Le fichier est lu dans le navigateur : il ne quitte pas le poste.
 */
const PAQUET = 50;
const FIXES = {
  boite: ['Boîte', ['boite', 'boites', 'n boite', 'n de boite', 'numero de boite', 'n de la boite', 'cote de la boite']],
  cote: ['Cote du dossier', ['cote', 'cotes', 'cote du dossier', 'n d ordre', 'n ordre']],
  dates: ['Dates extrêmes', ['dates extremes', 'date extreme', 'periode', 'annees', 'annee']],
};
const TYPES = { text: 'Texte', number: 'Nombre', date: 'Date', boolean: 'Oui / Non' };
const TIERS = /\b(attributaire|titulaire|soumissionnaire|fournisseur|prestataire|entreprise|societe|raison sociale|denomination|etablissement|structure|promoteur|beneficiaire|demandeur|client)\b/;
const pluriel = (n, un, plusieurs) => `${n.toLocaleString('fr-FR')} ${n > 1 ? plusieurs : un}`;
const vide = (v) => v === '' || v === null || v === undefined;

/** Ce que devient chaque colonne, proposé d'après son titre. */
function proposer(colonnes, classe, communes) {
  const pris = new Set();
  const cibles = {};
  for (const col of colonnes) {
    const k = cle(col.titre);
    const fixe = !col.sansTitre && Object.keys(FIXES).find((f) => FIXES[f][1].includes(k) && !pris.has(f));
    const propriete = classe && !col.sansTitre && [...classe.colonnes, ...communes].find((p) => cle(p.libelle) === k && !pris.has(`c${p.id}`));
    const cible = fixe || (propriete ? `c${propriete.id}` : classe || col.sansTitre ? 'ignorer' : `n:${col.type}`);
    cibles[col.index] = cible;
    if (cible !== 'ignorer' && !cible.startsWith('n:')) pris.add(cible);
  }
  return cibles;
}

const Etapes = ({ etape }) => (
  <ol className="flex items-center gap-2 text-xs font-bold">
    {[['choix', '1. Le classeur'], ['colonnes', '2. Les colonnes'], ['import', '3. L\'import']].map(([k, nom], i, tous) => (
      <li key={k} className={`flex items-center gap-2 ${etape === k ? 'text-docuflow-secondary' : 'text-slate-400'}`}>
        <span className={`px-2.5 py-1 rounded-full ${etape === k ? 'bg-blue-50' : ''}`}>{nom}</span>
        {i < tous.length - 1 && <span className="text-slate-300" aria-hidden="true">›</span>}
      </li>
    ))}
  </ol>
);

const ImportClasseur = ({ modele, emplacementInitial = '', lotInitial = {}, onLot, onFerme, onImporte }) => {
  const [etape, setEtape] = useState('choix');
  const [classeur, setClasseur] = useState(null);
  const [iFeuille, setIFeuille] = useState(0);
  const [iTitres, setITitres] = useState(0);
  const [mode, setMode] = useState('existante');
  const [classeId, setClasseId] = useState('');
  const [nomClasse, setNomClasse] = useState('');
  const [colTitre, setColTitre] = useState('');
  const [cibles, setCibles] = useState({});
  const [lot, setLot] = useState(lotInitial);
  const [emplacement, setEmplacement] = useState(emplacementInitial);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null);
  const [verif, setVerif] = useState(null);
  const [avecDoublons, setAvecDoublons] = useState(false);
  const [progression, setProgression] = useState(null);
  const [survol, setSurvol] = useState(false);
  const [creees, setCreees] = useState([]); // classes créées pendant cet import
  const [referentiel, setReferentiel] = useState(true); // ces fiches aident-elles à indexer ?
  const champFichier = useRef(null);
  const classes = useMemo(() => [...modele.classes, ...creees.filter((c) => !modele.classes.some((x) => x.id === c.id))], [modele, creees]);

  const feuille = classeur?.feuilles[iFeuille] || null;
  const colonnes = useMemo(() => (feuille ? decrireColonnes(feuille.lignes, iTitres) : []), [feuille, iTitres]);
  const donnees = useMemo(() => (feuille ? feuille.lignes.slice(iTitres + 1) : []), [feuille, iTitres]);
  const classe = mode === 'existante' ? classes.find((c) => String(c.id) === String(classeId)) || null : null;
  const requises = useMemo(() => modele.communes.filter((c) => c.obligatoire), [modele]);

  // Les propriétés choisies « pour toutes les lignes » valent aussi pour la page, et pour le prochain import.
  useEffect(() => { onLot?.(lot); }, [lot]); // eslint-disable-line react-hooks/exhaustive-deps

  // Échap ferme l'assistant, sauf pendant un import.
  useEffect(() => {
    const touche = (e) => { if (e.key === 'Escape' && !occupe) onFerme(); };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [occupe, onFerme]);

  /** Feuille choisie : ligne des titres, classe la plus proche, correspondance des colonnes. */
  const preparer = (c, numero) => {
    const f = c.feuilles[numero];
    const titres = trouverTitres(f.lignes);
    const cols = decrireColonnes(f.lignes, titres);
    const cles = new Set(cols.filter((x) => !x.sansTitre).map((x) => cle(x.titre)));
    const notes = classes.map((cl) => [cl, cl.colonnes.filter((p) => cles.has(cle(p.libelle))).length]).sort((a, b) => b[1] - a[1]);
    const meilleure = notes[0] && notes[0][1] >= Math.min(2, cols.length) ? notes[0][0] : null;
    const nouvelle = !meilleure && modele.peut_creer_classe;
    const retenue = meilleure || (nouvelle ? null : classes[0] || null);
    setIFeuille(numero); setITitres(titres);
    setMode(nouvelle ? 'nouvelle' : 'existante');
    setClasseId(retenue ? String(retenue.id) : '');
    setNomClasse((c.feuilles.length > 1 ? f.nom : c.nom.replace(/\.[^.]+$/, '')).replace(/[_-]+/g, ' ').trim().slice(0, 100));
    setCibles(proposer(cols, retenue, modele.communes));
    setReferentiel(retenue ? Boolean(retenue.referentiel) : true);
    const titre = cols.find((x) => !x.sansTitre && x.type === 'text' && TIERS.test(cle(x.titre))) || cols.find((x) => !x.sansTitre && x.type === 'text');
    setColTitre(titre ? String(titre.index) : '');
    setMessage(null); setVerif(null);
  };

  const ouvrir = async (fichier) => {
    if (!fichier) return;
    setOccupe(true); setMessage(null);
    try {
      const c = await lireClasseur(fichier);
      if (!c.feuilles.length) { setMessage('Ce classeur est vide.'); return; }
      setClasseur(c);
      preparer(c, 0);
      setEtape('colonnes');
    } catch {
      setMessage("Ce fichier ne se lit pas comme un classeur. Enregistrez-le au format Excel (.xlsx) et réessayez.");
    } finally { setOccupe(false); }
  };

  const changerTitres = (i) => { setITitres(i); setCibles(proposer(decrireColonnes(feuille.lignes, i), classe, modele.communes)); setVerif(null); };
  const changerClasse = (m, id) => {
    const cl = m === 'existante' ? classes.find((c) => String(c.id) === String(id)) || null : null;
    setMode(m); setClasseId(id); setCibles(proposer(colonnes, cl, modele.communes)); setVerif(null); setMessage(null);
    setReferentiel(cl ? Boolean(cl.referentiel) : true);
  };

  /** Ce qui empêche d'importer, en clair — ou null. */
  const obstacle = () => {
    if (!donnees.length) return 'Ce classeur ne contient aucune ligne sous ses titres. Vérifiez la ligne des titres.';
    if (donnees.length > modele.limite_import) return `Ce classeur compte ${pluriel(donnees.length, 'ligne', 'lignes')} : ${modele.limite_import.toLocaleString('fr-FR')} au plus par import. Partagez-le en plusieurs fichiers.`;
    const retenues = colonnes.filter((c) => cibles[c.index] && cibles[c.index] !== 'ignorer');
    if (!retenues.length) return 'Aucune colonne n\'est importée : dites ce que devient au moins une colonne.';
    const vues = new Set();
    for (const c of retenues) {
      const cible = cibles[c.index];
      if (cible.startsWith('n:')) continue;
      if (vues.has(cible)) return `Deux colonnes vont au même endroit (« ${c.titre} ») : n'en gardez qu'une.`;
      vues.add(cible);
    }
    if (mode === 'existante') {
      if (!classe) return 'Choisissez la classe où ranger ces lignes.';
      const manque = classe.colonnes.find((p) => p.obligatoire && !vues.has(`c${p.id}`));
      if (manque) return `« ${manque.libelle} » est obligatoire dans cette classe : reliez-lui une colonne du classeur.`;
    } else {
      if (!nomClasse.trim()) return 'Donnez un nom à la nouvelle classe.';
      if (!retenues.some((c) => cibles[c.index].startsWith('n:'))) return 'La nouvelle classe doit recevoir au moins une colonne.';
    }
    const commune = requises.find((p) => vide(lot[p.id]) && vide(p.defaut) && !vues.has(`c${p.id}`));
    if (commune) return `Choisissez « ${commune.libelle} » pour toutes les lignes.`;
    return null;
  };

  const verifier = async () => {
    const o = obstacle();
    if (o) { setMessage(o); return; }
    setOccupe(true); setMessage(null);
    try {
      let cible = classe;
      if (mode === 'nouvelle') {
        const nouvelles = colonnes.filter((c) => (cibles[c.index] || '').startsWith('n:'));
        const titre = nouvelles.find((c) => String(c.index) === String(colTitre));
        cible = await physiqueService.creerClasseSaisie({
          nom: nomClasse.trim(), titre: titre?.titre, referentiel, colonnes: nouvelles.map((c) => ({ libelle: c.titre, type: cibles[c.index].slice(2) })),
        });
        // La classe existe désormais : la suite se fait comme pour une classe déjà là.
        const nouvelleClasse = cible;
        setCreees((l) => [...l, nouvelleClasse]);
        setMode('existante'); setClasseId(String(cible.id));
        setCibles((actuelles) => Object.fromEntries(colonnes.map((c) => {
          const p = (actuelles[c.index] || '').startsWith('n:') && cible.colonnes.find((x) => cle(x.libelle) === cle(c.titre));
          return [c.index, p ? `c${p.id}` : actuelles[c.index]];
        })));
      }
      if (mode === 'existante' && modele.peut_creer_classe && Boolean(cible.referentiel) !== referentiel) {
        await physiqueService.definirReferentiel(cible.id, referentiel);
        cible.referentiel = referentiel;
      }
      const champDe = (c) => {
        const voulu = cibles[c.index] || 'ignorer';
        if (voulu.startsWith('n:')) { const p = cible.colonnes.find((x) => cle(x.libelle) === cle(c.titre)); return p ? `c${p.id}` : 'ignorer'; }
        return voulu;
      };
      const types = new Map([...cible.colonnes, ...modele.communes].map((p) => [`c${p.id}`, p.type]));
      const plan = colonnes.map((c) => [c, champDe(c)]).filter(([, v]) => v !== 'ignorer');
      const titre = colonnes.find((c) => String(c.index) === String(colTitre));
      const tiers = plan.find(([c]) => TIERS.test(cle(c.titre)));
      const reperes = !tiers && titre && champDe(titre).startsWith('c') ? { entreprise: Number(champDe(titre).slice(1)) } : {};
      const envoyees = donnees.map((l) => {
        const corps = { valeurs: {} };
        for (const [c, v] of plan) {
          const x = l.cellules[c.index];
          if (vide(x)) continue;
          if (v === 'dates') corps.dates = /^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? String(x).slice(0, 4) : String(x);
          else if (v === 'cote' || v === 'boite') corps[v] = String(x);
          else corps.valeurs[v.slice(1)] = types.get(v) === 'text' && typeof x !== 'number' ? afficher(x) : x;
        }
        for (const p of requises) if (vide(corps.valeurs[p.id])) corps.valeurs[p.id] = !vide(lot[p.id]) ? lot[p.id] : (p.defaut ?? '');
        return { rang: l.rang, corps };
      });
      const base = { classe_id: cible.id, emplacement_id: emplacement ? Number(emplacement) : null, reperes };
      const r = await physiqueService.verifierSaisie({ ...base, lignes: envoyees.map((e) => e.corps) });
      const libelles = new Map([...cible.colonnes, ...modele.communes].map((p) => [`c${p.id}`, p.libelle]));
      setVerif({ ...r, base, envoyees, classe: cible, libelle: (colonne) => libelles.get(colonne) || FIXES[colonne]?.[0] || colonne });
      setAvecDoublons(false);
      setEtape('import');
    } catch (err) {
      setMessage(err.response?.data?.message || 'Vérification impossible. Réessayez.');
    } finally { setOccupe(false); }
  };

  const fautives = useMemo(() => new Set((verif?.erreurs || []).map((e) => e.ligne)), [verif]);
  const doubles = useMemo(() => new Set((verif?.doublons || []).map((d) => d.ligne)), [verif]);
  const aImporter = useMemo(() => (verif ? verif.envoyees.filter((_, i) => !fautives.has(i) && (avecDoublons || !doubles.has(i))) : []), [verif, fautives, doubles, avecDoublons]);

  const importer = async () => {
    setOccupe(true);
    const crees = [];
    let erreur = null;
    setProgression({ fait: 0, total: aImporter.length });
    try {
      for (let i = 0; i < aImporter.length && !erreur; i += PAQUET) {
        const paquet = aImporter.slice(i, i + PAQUET);
        // eslint-disable-next-line no-await-in-loop
        const r = await physiqueService.saisir({ ...verif.base, accepter_doublons: true, lignes: paquet.map((e) => e.corps) });
        crees.push(...r.crees);
        if (r.interrompu) erreur = `L'import s'est arrêté à la ligne ${paquet[r.interrompu.ligne]?.rang ?? '?'} du classeur.`;
        setProgression({ fait: crees.length, total: aImporter.length });
      }
    } catch (err) {
      erreur = err.response?.data?.message || "L'import a été interrompu (connexion perdue ?).";
    }
    setProgression({ fait: crees.length, total: aImporter.length, termine: true, erreur });
    setOccupe(false);
    onImporte({ crees, classe: verif.classe });
  };

  const options = (
    <>
      <option value="ignorer">Ne pas importer</option>
      {mode === 'nouvelle' && <optgroup label="Devient une propriété de la classe">{Object.entries(TYPES).map(([k, nom]) => <option key={k} value={`n:${k}`}>{nom}</option>)}</optgroup>}
      {classe && <optgroup label={`Propriétés de « ${classe.nom} »`}>{classe.colonnes.map((p) => <option key={p.id} value={`c${p.id}`}>{p.libelle}{p.obligatoire ? ' *' : ''}</option>)}</optgroup>}
      {classe && modele.communes.length > 0 && <optgroup label="Propriétés communes">{modele.communes.map((p) => <option key={p.id} value={`c${p.id}`}>{p.libelle}</option>)}</optgroup>}
      <optgroup label="Rangement du dossier papier">{Object.entries(FIXES).map(([k, [nom]]) => <option key={k} value={k}>{nom}</option>)}</optgroup>
    </>
  );

  // Rendu dans <body> : la page est animée, ce qui bornerait un élément « fixed » à son cadre.
  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-stretch sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label="Importer un classeur">
      <div className="bg-white w-full max-w-4xl sm:rounded-2xl flex flex-col max-h-full shadow-2xl">
        <header className="px-5 pt-4 pb-3 border-b border-slate-200 space-y-2">
          <div className="flex items-center gap-3">
            <FileSpreadsheet size={20} className="text-emerald-600 flex-shrink-0" />
            <h2 className="font-bold text-slate-900 flex-1 min-w-0 truncate">Importer un classeur{classeur ? ` — ${classeur.nom}` : ''}</h2>
            <button type="button" onClick={onFerme} disabled={occupe} className="text-slate-400 hover:text-slate-900 p-1 disabled:opacity-40 flex-shrink-0" aria-label="Fermer"><X size={20} /></button>
          </div>
          <Etapes etape={etape} />
        </header>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {etape === 'choix' && (
            <>
              <button type="button" onClick={() => champFichier.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setSurvol(true); }} onDragLeave={() => setSurvol(false)}
                onDrop={(e) => { e.preventDefault(); setSurvol(false); ouvrir(e.dataTransfer.files?.[0]); }}
                className={`w-full rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${survol ? 'border-docuflow-secondary bg-blue-50' : 'border-slate-300 hover:border-slate-400 bg-slate-50'}`}>
                {occupe ? <Loader2 size={34} className="animate-spin mx-auto text-slate-400" /> : <UploadCloud size={34} className="mx-auto text-slate-400" />}
                <p className="font-bold text-slate-800 mt-3">Glissez votre classeur ici, ou cliquez pour le choisir</p>
                <p className="text-sm text-slate-500 mt-1">Excel (.xlsx, .xls), LibreOffice (.ods) ou CSV — quel que soit son agencement.</p>
              </button>
              <input ref={champFichier} type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt" className="hidden" onChange={(e) => ouvrir(e.target.files?.[0])} />
              <ul className="text-sm text-slate-600 space-y-1 list-disc pl-5">
                <li>Une ligne du classeur devient une fiche : un dossier, une entreprise, un acte…</li>
                <li>Les colonnes sont reconnues par leur titre. Si rien ne correspond, DocuFlow crée la classe d'après vos colonnes.</li>
                <li>Le fichier est lu sur votre poste : seules les lignes que vous importez sont envoyées.</li>
              </ul>
            </>
          )}

          {etape === 'colonnes' && feuille && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {classeur.feuilles.length > 1 && (
                  <label className="block text-xs font-bold text-slate-600">Feuille
                    <select className="input-premium mt-1" value={iFeuille} onChange={(e) => preparer(classeur, Number(e.target.value))}>
                      {classeur.feuilles.map((f, i) => <option key={f.nom} value={i}>{f.nom} ({pluriel(f.lignes.length, 'ligne', 'lignes')})</option>)}
                    </select>
                  </label>
                )}
                <label className="block text-xs font-bold text-slate-600">Ligne des titres de colonnes
                  <select className="input-premium mt-1" value={iTitres} onChange={(e) => changerTitres(Number(e.target.value))}>
                    {feuille.lignes.slice(0, LIGNES_MAX_AFFICHEES).map((l, i) => <option key={l.rang} value={i}>Ligne {l.rang} : {l.cellules.filter((x) => x !== '').map(afficher).join(' · ').slice(0, 70)}</option>)}
                  </select>
                </label>
              </div>

              <fieldset className="rounded-xl border border-slate-200 p-3 space-y-2">
                <legend className="text-xs font-bold text-slate-600 px-1">Où ranger ces {pluriel(donnees.length, 'ligne', 'lignes')} ?</legend>
                <label className="flex flex-wrap items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="mode-classe" checked={mode === 'existante'} onChange={() => changerClasse('existante', classeId || String(classes[0]?.id || ''))} disabled={!classes.length} />
                  <span className="font-semibold text-slate-800">Dans une classe qui existe</span>
                  <select className="input-premium w-auto min-w-[220px] flex-1" value={mode === 'existante' ? classeId : ''} disabled={mode !== 'existante'} onChange={(e) => changerClasse('existante', e.target.value)} aria-label="Classe">
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </label>
                {modele.peut_creer_classe && (
                  <label className="flex flex-wrap items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="mode-classe" checked={mode === 'nouvelle'} onChange={() => changerClasse('nouvelle', '')} />
                    <span className="font-semibold text-slate-800">Dans une nouvelle classe, créée d'après ce classeur</span>
                    <input className="input-premium w-auto min-w-[220px] flex-1" value={nomClasse} disabled={mode !== 'nouvelle'} onChange={(e) => setNomClasse(e.target.value)} maxLength={100} placeholder="Nom de la classe" aria-label="Nom de la nouvelle classe" />
                  </label>
                )}
                {mode === 'nouvelle' && (
                  <label className="flex flex-wrap items-center gap-2 text-sm pl-6">
                    <span className="text-slate-600">Chaque fiche portera le nom lu dans la colonne</span>
                    <select className="input-premium w-auto min-w-[200px]" value={colTitre} onChange={(e) => setColTitre(e.target.value)} aria-label="Colonne qui nomme les fiches">
                      <option value="">(aucune : fiches numérotées)</option>
                      {colonnes.filter((c) => (cibles[c.index] || '').startsWith('n:')).map((c) => <option key={c.index} value={c.index}>{c.titre}</option>)}
                    </select>
                  </label>
                )}
                {modele.peut_creer_classe && (
                  <label className="flex items-start gap-2 text-sm cursor-pointer pt-1 border-t border-slate-100">
                    <input type="checkbox" className="mt-1" checked={referentiel} onChange={(e) => setReferentiel(e.target.checked)} />
                    <span>
                      <span className="font-semibold text-slate-800">Se servir de ces fiches pour reconnaître les documents à indexer</span>
                      <span className="block text-xs text-slate-500">Quand un document cite l'un de ces noms ou de ces numéros, DocuFlow propose de remplir sa fiche avec ces informations, et les suggère pendant la saisie.</span>
                    </span>
                  </label>
                )}
              </fieldset>

              <div className="rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500 bg-slate-50"><th className="p-2.5 font-bold">Colonne du classeur</th><th className="p-2.5 font-bold">Exemples</th><th className="p-2.5 font-bold w-[38%]">Devient</th></tr></thead>
                  <tbody>
                    {colonnes.map((c) => {
                      const cible = cibles[c.index] || 'ignorer';
                      return (
                        <tr key={c.index} className={`border-t border-slate-100 ${cible === 'ignorer' ? 'bg-slate-50/60' : ''}`}>
                          <td className={`p-2.5 font-semibold ${cible === 'ignorer' ? 'text-slate-400' : 'text-slate-800'}`}>{c.titre}</td>
                          <td className="p-2.5 text-slate-500 text-xs">{c.exemples.join(' · ') || <em>vide</em>}</td>
                          <td className="p-2">
                            <select className="input-premium" value={cible} aria-label={`Ce que devient la colonne ${c.titre}`}
                              onChange={(e) => { setCibles((x) => ({ ...x, [c.index]: e.target.value })); setVerif(null); setMessage(null); }}>{options}</select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                {requises.map((p) => (
                  <label key={p.id} className="block text-xs font-bold text-slate-600">{p.libelle} <span className="font-normal text-slate-400">(toutes les lignes)</span>
                    {p.type === 'select' ? (
                      <select className="input-premium mt-1 w-52" value={lot[p.id] ?? ''} onChange={(e) => setLot((x) => ({ ...x, [p.id]: e.target.value }))}>
                        <option value="">— Choisir —</option>
                        {p.choix.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : <input className="input-premium mt-1 w-52" value={lot[p.id] ?? ''} onChange={(e) => setLot((x) => ({ ...x, [p.id]: e.target.value }))} />}
                  </label>
                ))}
                {modele.boites.length > 0 && !Object.values(cibles).includes('boite') && (
                  <label className="block text-xs font-bold text-slate-600">Boîte <span className="font-normal text-slate-400">(facultatif)</span>
                    <select className="input-premium mt-1 w-64" value={emplacement} onChange={(e) => setEmplacement(e.target.value)}>
                      <option value="">Pas encore rangés</option>
                      {modele.boites.map((b) => <option key={b.id} value={b.id}>{b.cote}{b.libelle ? ` — ${b.libelle}` : ''}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </>
          )}

          {etape === 'import' && verif && !progression && (
            <>
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-lg font-bold text-slate-900">{pluriel(aImporter.length, 'ligne prête', 'lignes prêtes')} à importer</p>
                <p className="text-sm text-slate-600">Classe « {verif.classe.nom} » · {pluriel(verif.lignes, 'ligne lue', 'lignes lues')} dans le classeur{verif.base.emplacement_id ? ` · boîte ${modele.boites.find((b) => b.id === verif.base.emplacement_id)?.cote || ''}` : ''}</p>
              </div>
              {verif.erreurs.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
                  <p className="font-bold text-red-800 flex items-center gap-2"><AlertTriangle size={15} /> {pluriel(fautives.size, 'ligne ne sera pas importée', 'lignes ne seront pas importées')} : {fautives.size > 1 ? 'corrigez-les dans le classeur, puis importez-les à part' : 'corrigez-la dans le classeur, puis importez-la à part'}</p>
                  <ul className="mt-1.5 space-y-0.5 max-h-44 overflow-auto text-red-800">
                    {verif.erreurs.slice(0, 200).map((e, i) => <li key={`${e.ligne}-${e.colonne}-${i}`}><strong>Ligne {verif.envoyees[e.ligne]?.rang} du classeur, {verif.libelle(e.colonne)}</strong> : {e.message}</li>)}
                    {verif.erreurs.length > 200 && <li>… et {verif.erreurs.length - 200} autres.</li>}
                  </ul>
                </div>
              )}
              {verif.doublons.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
                  <p className="font-bold text-amber-900 flex items-center gap-2"><AlertTriangle size={15} /> {pluriel(doubles.size, 'ligne existe déjà', 'lignes existent déjà')}</p>
                  <ul className="mt-1.5 space-y-0.5 max-h-32 overflow-auto text-amber-900">
                    {verif.doublons.slice(0, 100).map((d) => <li key={d.ligne}><strong>Ligne {verif.envoyees[d.ligne]?.rang}</strong> : {d.motif.replace(/la ligne (\d+)/, (_, n) => `la ligne ${verif.envoyees[Number(n) - 1]?.rang ?? n}`)}</li>)}
                  </ul>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer text-amber-900"><input type="checkbox" checked={avecDoublons} onChange={(e) => setAvecDoublons(e.target.checked)} /> Les importer quand même</label>
                </div>
              )}
              {verif.erreurs.length === 0 && verif.doublons.length === 0 && <p className="text-sm text-emerald-700 font-semibold flex items-center gap-2"><CheckCircle2 size={16} /> Toutes les lignes sont lisibles, aucune n'existe déjà.</p>}
            </>
          )}

          {progression && (
            <div className="py-6 text-center space-y-3">
              {progression.termine
                ? (progression.erreur ? <AlertTriangle size={36} className="mx-auto text-amber-500" /> : <CheckCircle2 size={36} className="mx-auto text-emerald-600" />)
                : <Loader2 size={36} className="mx-auto animate-spin text-docuflow-secondary" />}
              <p className="text-lg font-bold text-slate-900">
                {progression.termine ? `${pluriel(progression.fait, 'fiche importée', 'fiches importées')} dans « ${verif.classe.nom} »` : `Import en cours : ${progression.fait.toLocaleString('fr-FR')} sur ${progression.total.toLocaleString('fr-FR')}`}
              </p>
              <div className="h-2 rounded-full bg-slate-100 max-w-md mx-auto overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={progression.total} aria-valuenow={progression.fait}>
                <div className="h-full bg-docuflow-secondary transition-all" style={{ width: `${progression.total ? Math.round((progression.fait / progression.total) * 100) : 100}%` }} />
              </div>
              {progression.erreur && <p className="text-sm text-amber-800">{progression.erreur} Les fiches déjà importées sont enregistrées.</p>}
              {!progression.termine && <p className="text-sm text-slate-500">Gardez cette fenêtre ouverte.</p>}
            </div>
          )}

          {message && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex gap-2" role="alert"><AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /> {message}</p>}
        </div>

        <footer className="flex flex-wrap items-center gap-2 px-5 py-3.5 border-t border-slate-200">
          {etape === 'colonnes' && (
            <>
              <button type="button" onClick={() => { setEtape('choix'); setClasseur(null); setMessage(null); }} className="btn btn-ghost"><ArrowLeft size={16} /> Autre classeur</button>
              <span className="text-sm text-slate-500 ml-auto">{pluriel(donnees.length, 'ligne', 'lignes')} · {pluriel(colonnes.filter((c) => (cibles[c.index] || 'ignorer') !== 'ignorer').length, 'colonne importée', 'colonnes importées')}</span>
              <button type="button" onClick={verifier} disabled={occupe} className="btn btn-primary">{occupe ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />} {mode === 'nouvelle' ? 'Créer la classe et vérifier' : 'Vérifier'}</button>
            </>
          )}
          {etape === 'import' && verif && !progression && (
            <>
              <button type="button" onClick={() => { setEtape('colonnes'); setVerif(null); }} className="btn btn-ghost"><ArrowLeft size={16} /> Revoir les colonnes</button>
              <button type="button" onClick={importer} disabled={occupe || !aImporter.length} className="btn btn-primary ml-auto"><UploadCloud size={16} /> Importer {pluriel(aImporter.length, 'ligne', 'lignes')}</button>
            </>
          )}
          {progression?.termine && (
            <>
              <Link to="/documents/liste" className="btn btn-secondary ml-auto">Voir les documents</Link>
              <button type="button" onClick={onFerme} className="btn btn-primary">Terminer</button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
};

export default ImportClasseur;
