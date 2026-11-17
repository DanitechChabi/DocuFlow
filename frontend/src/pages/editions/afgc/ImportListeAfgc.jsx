import React, { useState, useEffect, useRef } from 'react';
import { FileSpreadsheet, X, Upload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { lireClasseur } from '../../../utils/classeur';
import { listeService } from '../../../services/listeService';
import { requestService } from '../../../services/requestService';
import { CHAMPS, preparerFeuille, lignesDeFeuille } from './listesExcel';
import { intitule, references } from './vocabulaire';
import { ChoixCadre } from './elements';

// ============================================================================
// « Demander une liste » : un classeur Excel dont chaque feuille est une liste
// de dossiers (« Liste 1 » … « Liste n »). L'agent choisit le cadre (soldes
// créditeurs, commissaire aux comptes…), vérifie le rapprochement des colonnes
// et envoie : chaque feuille devient une liste, chaque ligne une demande.
// ============================================================================

const ImportListeAfgc = ({ open, onClose, cadres, cadreParDefaut, onEnvoye }) => {
  const [fichier, setFichier] = useState(null);
  const [feuilles, setFeuilles] = useState([]);
  const [cadre, setCadre] = useState('');
  const [lecture, setLecture] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const [resultats, setResultats] = useState(null);
  const [types, setTypes] = useState([]);
  const entree = useRef(null);

  useEffect(() => {
    if (!open) return;
    setFichier(null); setFeuilles([]); setErreur(''); setResultats(null); setEnvoi(false);
    setCadre(cadreParDefaut || cadres[0]?.value || '');
  }, [open, cadreParDefaut, cadres]);

  const lire = async (f) => {
    if (!f) return;
    setErreur(''); setLecture(true); setResultats(null);
    try {
      // Les typologies de l'organisation, pour reconnaître la colonne « Typologie ».
      const typesConnus = types.length ? types : ((await requestService.getOptions().catch(() => null))?.documentTypes || []);
      if (!types.length) setTypes(typesConnus);
      const classeur = await lireClasseur(f);
      const prets = classeur.feuilles.map((feuille) => ({ feuille, libelle: feuille.nom, inclus: true, ...preparerFeuille(feuille, typesConnus) }))
        .filter((x) => x.lignes.length);
      if (!prets.length) setErreur('Aucune ligne de dossier n\'a été trouvée dans ce classeur.');
      setFichier(f); setFeuilles(prets);
    } catch {
      setErreur('Ce fichier n\'a pas pu être lu. Enregistrez-le en .xlsx, .xls, .ods ou .csv, puis réessayez.');
    } finally {
      setLecture(false);
    }
  };

  const modifier = (i, changement) => setFeuilles((fs) => fs.map((f, k) => {
    if (k !== i) return f;
    const suivant = { ...f, ...changement };
    if (changement.assoc) suivant.lignes = lignesDeFeuille(f.feuille, f.indexTitres, changement.assoc, f.colonnes, types);
    return suivant;
  }));

  const retenues = feuilles.filter((f) => f.inclus && f.lignes.length);
  const totalDossiers = retenues.reduce((n, f) => n + f.lignes.length, 0);

  const envoyer = async () => {
    setEnvoi(true); setErreur('');
    const res = [];
    for (const f of retenues) {
      try {
        const liste = await listeService.creer({
          libelle: f.libelle.trim() || f.feuille.nom,
          cadre,
          fichier: fichier?.name,
          // `rang` (ligne du tableur) reste ici : il sert à situer une erreur.
          lignes: f.lignes.map(({ nom_entreprise, num_dossier, num_acte, annee, description, type_document, banque, montant }) => ({ nom_entreprise, num_dossier, num_acte, annee, description, type_document, banque, montant })),
        });
        res.push({ libelle: liste.libelle, ok: true, n: liste.dossiers.length });
      } catch (e) {
        const details = e.response?.data?.details || [];
        res.push({
          libelle: f.libelle, ok: false,
          message: e.response?.data?.message || 'Envoi impossible.',
          // Le serveur numérote les lignes envoyées ; on rend celles du tableur.
          lignes: details.map((d) => ({ rang: f.lignes[d.ligne - 1]?.rang, message: d.message })),
        });
      }
    }
    setResultats(res);
    setEnvoi(false);
    if (res.some((r) => r.ok)) onEnvoye?.();
  };

  return (
    <Modal open={open} onClose={envoi ? undefined : onClose} panelClassName="w-full max-w-3xl mx-4">
      <div className="bg-white rounded-xl shadow-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <FileSpreadsheet size={20} className="text-docuflow-secondary" />
          <h2 className="font-bold text-slate-900 text-lg flex-1">Demander une liste (Excel)</h2>
          <button type="button" onClick={onClose} disabled={envoi} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100" aria-label="Fermer"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {resultats ? (
            <div className="space-y-3">
              {resultats.map((r) => (
                <div key={r.libelle} className={`rounded-lg p-4 ${r.ok ? 'bg-green-50' : 'bg-red-50'}`}>
                  <div className={`flex items-center gap-2 font-bold ${r.ok ? 'text-green-800' : 'text-red-700'}`}>
                    {r.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                    {r.libelle} : {r.ok ? `${r.n} dossier${r.n > 1 ? 's' : ''} demandé${r.n > 1 ? 's' : ''}` : r.message}
                  </div>
                  {!r.ok && r.lignes?.length > 0 && (
                    <ul className="mt-2 text-sm text-red-700 space-y-0.5">
                      {r.lignes.slice(0, 8).map((l) => <li key={`${l.rang}-${l.message}`}>Ligne {l.rang} du tableur : {l.message}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          ) : !feuilles.length ? (
            <>
              <p className="text-sm text-slate-600">
                Chaque feuille du classeur devient une liste (« Liste 1 », « Liste 2 »…). Les colonnes sont reconnues d'après leur titre :
                entreprise, typologie, n° de dossier (004523.0008), n° d'acte (2026/1234), banque, année, montant.
              </p>
              <button
                type="button"
                onClick={() => entree.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); lire(e.dataTransfer.files?.[0]); }}
                className="w-full rounded-xl border border-dashed border-slate-200 hover:border-docuflow-secondary py-12 flex flex-col items-center gap-3 text-slate-500 transition-colors"
              >
                {lecture ? <Loader2 size={28} className="animate-spin text-docuflow-secondary" /> : <Upload size={28} className="text-docuflow-secondary" />}
                <span className="font-bold text-slate-700">{lecture ? 'Lecture du classeur…' : 'Choisir le classeur'}</span>
                <span className="text-xs">Excel (.xlsx, .xls), LibreOffice (.ods) ou CSV — le fichier reste sur votre poste</span>
              </button>
              <input ref={entree} type="file" accept=".xlsx,.xls,.ods,.csv" className="hidden" onChange={(e) => lire(e.target.files?.[0])} />
            </>
          ) : (
            <>
              <div>
                <div className="text-xs font-bold text-slate-400 mb-2">Motif de la demande</div>
                <ChoixCadre cadres={cadres} valeur={cadre} onChange={setCadre} />
              </div>
              {feuilles.map((f, i) => (
                <div key={f.feuille.nom} className={`rounded-lg border p-4 ${f.inclus ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <input type="checkbox" checked={f.inclus} onChange={(e) => modifier(i, { inclus: e.target.checked })} className="w-4 h-4 accent-[var(--color-docuflow-secondary)]" aria-label={`Envoyer la feuille ${f.feuille.nom}`} />
                    <input value={f.libelle} onChange={(e) => modifier(i, { libelle: e.target.value })} maxLength={120}
                      className="flex-1 min-w-[160px] px-3 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-800 focus:outline-none focus:border-docuflow-secondary" aria-label="Nom de la liste" />
                    <span className="text-sm font-bold text-slate-500">{f.lignes.length} dossier{f.lignes.length > 1 ? 's' : ''}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-3">
                    {CHAMPS.map((champ) => (
                      <label key={champ.cle} className="text-[11px] font-bold text-slate-400">
                        {champ.label}
                        <select
                          value={f.assoc[champ.cle] ?? ''}
                          onChange={(e) => {
                            const assoc = { ...f.assoc };
                            if (e.target.value === '') delete assoc[champ.cle]; else assoc[champ.cle] = Number(e.target.value);
                            modifier(i, { assoc });
                          }}
                          className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700 bg-white"
                        >
                          <option value="">—</option>
                          {f.colonnes.map((c) => <option key={c.index} value={c.index}>{c.titre}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <ul className="mt-3 text-xs text-slate-500 divide-y divide-slate-50">
                    {f.lignes.slice(0, 3).map((l) => (
                      <li key={l.rang} className="py-1.5 flex gap-2">
                        <span className="text-slate-300 w-14 flex-shrink-0">ligne {l.rang}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-slate-700 line-clamp-2">{intitule(l)}</span>
                          {references(l) && <span className="block truncate">{references(l)}</span>}
                        </span>
                      </li>
                    ))}
                    {f.lignes.length > 3 && <li className="py-1.5 text-slate-400">… et {f.lignes.length - 3} autre{f.lignes.length - 3 > 1 ? 's' : ''}</li>}
                  </ul>
                </div>
              ))}
            </>
          )}
          {erreur && <p className="text-sm font-semibold text-red-600 flex items-center gap-2"><AlertCircle size={16} /> {erreur}</p>}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2">
          {resultats ? (
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-docuflow-secondary text-white font-bold">Terminé</button>
          ) : feuilles.length ? (
            <>
              <button type="button" onClick={() => { setFeuilles([]); setFichier(null); }} disabled={envoi} className="px-4 py-2.5 rounded-xl text-slate-600 font-bold hover:bg-slate-100">Autre classeur</button>
              <button type="button" onClick={envoyer} disabled={envoi || !retenues.length || !cadre}
                className="px-5 py-2.5 rounded-xl bg-docuflow-secondary text-white font-bold disabled:opacity-50 inline-flex items-center gap-2">
                {envoi && <Loader2 size={16} className="animate-spin" />}
                Envoyer {retenues.length} liste{retenues.length > 1 ? 's' : ''} · {totalDossiers} dossier{totalDossiers > 1 ? 's' : ''}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
};

export default ImportListeAfgc;
