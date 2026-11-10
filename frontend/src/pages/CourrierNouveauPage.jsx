import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Loader2, Upload, FileText, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import ChoixDocument from '../components/archives/ChoixDocument';
import { courrierService, CANAUX, NATURES, INSTRUCTIONS } from '../services/courrierService';
import { documentService } from '../services/documentService';
import { usePermissions } from '../hooks/usePermissions';
import { useTitrePage } from '../hooks/useTitrePage';
import { toast } from '../components/Toast';

/**
 * Enregistrement d'un courrier au registre (migration 041). Le scan de la
 * lettre est versé dans la GED (ou choisi parmi les documents déjà numérisés),
 * puis le courrier reçoit son numéro chronologique.
 */
const Champ = ({ libelle, aide, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="text-xs font-bold text-slate-600">{libelle}</span>
    <div className="mt-1">{children}</div>
    {aide && <span className="block text-[11px] text-slate-400 mt-0.5">{aide}</span>}
  </label>
);

const CourrierNouveauPage = () => {
  useTitrePage('Enregistrer un courrier');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { can } = usePermissions();
  const [f, setF] = useState({
    sens: ['arrivee', 'depart', 'interne'].includes(params.get('sens')) ? params.get('sens') : 'arrivee',
    objet: '', correspondant: '', organisme: '', reference_externe: '', date_courrier: '', canal: 'papier', nature: 'lettre',
    urgent: false, confidentiel: false, reponse_attendue: true, echeance: '', assigne_a: '', instruction: '', copies: [],
  });
  const [agents, setAgents] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [fichier, setFichier] = useState(null);
  const [doc, setDoc] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const entree = useRef(null);
  const depart = f.sens === 'depart';

  useEffect(() => { courrierService.agents().then(setAgents).catch(() => setAgents([])); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (f.correspondant.trim().length < 2) { setSuggestions([]); return; }
      courrierService.correspondants(f.correspondant).then((r) => setSuggestions(r.filter((s) => s.correspondant !== f.correspondant))).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [f.correspondant]);

  const champ = (cle) => ({ value: f[cle], onChange: (e) => setF({ ...f, [cle]: e.target.value }) });
  const coche = (cle) => ({ checked: f[cle], onChange: (e) => setF({ ...f, [cle]: e.target.checked }) });

  const envoyer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      let documentId = doc?.id || null;
      if (fichier) {
        const fd = new FormData();
        fd.append('bulkUpload', 'true');
        fd.append('files', fichier);
        const r = await documentService.createDocument(fd);
        documentId = r.created?.[0]?.id || null;
        if (!documentId) throw new Error(r.failed?.[0]?.error || 'Le scan n\'a pas pu être versé dans la GED.');
      }
      const c = await courrierService.enregistrer({
        ...f, document_id: documentId, assigne_a: depart ? undefined : (f.assigne_a || undefined),
        copies: depart ? [] : f.copies, echeance: f.echeance || undefined, date_courrier: f.date_courrier || undefined,
      });
      toast.success(`Courrier enregistré sous le n° ${c.numero}`);
      navigate(`/courrier/${c.id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Enregistrement impossible');
    } finally { setEnvoi(false); }
  };

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[900px] mx-auto">
      <PageHeader title="Enregistrer un courrier" subtitle="Le numéro du registre est attribué à l'enregistrement" icon={Mail}
        breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Courrier', to: '/courrier' }, { label: 'Enregistrer' }]} />
      <form onSubmit={envoyer} className="space-y-5">
        <div className="flex rounded-xl bg-slate-100 p-1 w-fit" role="tablist" aria-label="Sens du courrier">
          {[['arrivee', 'Arrivée', 'Courrier reçu'], ['depart', 'Départ', 'Courrier envoyé'], ['interne', 'Interne', 'Entre services']].map(([cle, libelle, aide]) => (
            <button key={cle} type="button" role="tab" aria-selected={f.sens === cle} title={aide} onClick={() => setF({ ...f, sens: cle })}
              className={`px-5 py-2 rounded-lg text-sm font-bold ${f.sens === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{libelle}</button>
          ))}
        </div>

        <section className="glass-card-premium p-5 grid gap-4 sm:grid-cols-2">
          <Champ libelle="Objet *" className="sm:col-span-2"><input className="input-premium" required autoFocus placeholder="Ex. : demande de permis de construire" {...champ('objet')} /></Champ>
          <Champ libelle={depart ? 'Destinataire *' : 'Expéditeur *'} className="relative">
            <input className="input-premium" required autoComplete="off" placeholder="Nom de la personne" {...champ('correspondant')} />
            {suggestions.length > 0 && (
              <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                {suggestions.map((s) => (
                  <li key={s.correspondant}>
                    <button type="button" onClick={() => { setF({ ...f, correspondant: s.correspondant, organisme: s.organisme || f.organisme }); setSuggestions([]); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                      <span className="font-semibold text-slate-800">{s.correspondant}</span>{s.organisme && <span className="text-slate-400"> · {s.organisme}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Champ>
          <Champ libelle="Organisme"><input className="input-premium" placeholder="Administration, société…" {...champ('organisme')} /></Champ>
          <Champ libelle={depart ? 'Référence rappelée' : 'Référence de la lettre'} aide={depart ? undefined : 'Celle que porte le courrier reçu'}><input className="input-premium" {...champ('reference_externe')} /></Champ>
          <Champ libelle="Date du courrier"><input type="date" className="input-premium" max={new Date().toISOString().slice(0, 10)} {...champ('date_courrier')} /></Champ>
          <Champ libelle="Nature"><select className="input-premium" {...champ('nature')}>{Object.entries(NATURES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Champ>
          <Champ libelle={depart ? "Mode d'envoi prévu" : 'Reçu par'}><select className="input-premium" {...champ('canal')}>{Object.entries(CANAUX).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Champ>
          <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
            <label className="flex items-center gap-2"><input type="checkbox" {...coche('urgent')} /> Urgent</label>
            <label className="flex items-center gap-2" title="Visible seulement de vous, de l'agent chargé et des personnes en copie"><input type="checkbox" {...coche('confidentiel')} /> Confidentiel</label>
            {!depart && <label className="flex items-center gap-2"><input type="checkbox" {...coche('reponse_attendue')} /> Une réponse est attendue</label>}
          </div>
        </section>

        <section className="glass-card-premium p-5 space-y-3">
          <h2 className="text-sm font-black text-slate-900">Le document</h2>
          {fichier ? (
            <p className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100 text-sm">
              <FileText size={16} className="text-docuflow-secondary" /> <span className="font-semibold truncate">{fichier.name}</span>
              <button type="button" onClick={() => setFichier(null)} className="ml-auto text-slate-400 hover:text-slate-600" aria-label="Retirer le fichier"><X size={15} /></button>
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {can('documents.upload') && !doc && (
                <button type="button" onClick={() => entree.current?.click()}
                  className="p-4 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-600 hover:border-docuflow-secondary hover:text-docuflow-secondary flex items-center justify-center gap-2">
                  <Upload size={16} /> Joindre le scan de la lettre
                </button>
              )}
              <div><ChoixDocument valeur={doc} onChange={setDoc} placeholder="…ou un document déjà dans la GED" /></div>
              <input ref={entree} type="file" className="hidden" accept=".pdf,image/*,.doc,.docx,.odt" onChange={(e) => setFichier(e.target.files?.[0] || null)} />
            </div>
          )}
          <p className="text-[11px] text-slate-400">Le scan est versé dans la GED : il y est lu (OCR), cherchable et conservé. Facultatif : il peut être ajouté plus tard.</p>
        </section>

        {!depart && (
          <section className="glass-card-premium p-5 grid gap-4 sm:grid-cols-2">
            <h2 className="text-sm font-black text-slate-900 sm:col-span-2">Affectation <span className="font-medium text-slate-400">— facultative, elle peut se faire plus tard</span></h2>
            <Champ libelle="Agent chargé du courrier">
              <select className="input-premium" {...champ('assigne_a')}>
                <option value="">À affecter plus tard</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}{a.section ? ` — ${a.section}` : ''}</option>)}
              </select>
            </Champ>
            {f.reponse_attendue && <Champ libelle="Répondre avant le" aide="Vide : le délai réglé par l'organisation"><input type="date" className="input-premium" {...champ('echeance')} /></Champ>}
            <Champ libelle="Instruction" className="sm:col-span-2">
              <input className="input-premium" list="instructions-courrier" placeholder="Pour étude et avis…" {...champ('instruction')} />
              <datalist id="instructions-courrier">{INSTRUCTIONS.map((i) => <option key={i} value={i} />)}</datalist>
            </Champ>
            <Champ libelle="En copie" className="sm:col-span-2" aide="Ils voient le courrier sans avoir à le traiter">
              <div className="flex flex-wrap gap-1.5">
                {agents.filter((a) => String(a.id) !== String(f.assigne_a)).map((a) => {
                  const actif = f.copies.includes(a.id);
                  return (
                    <button key={a.id} type="button" aria-pressed={actif} onClick={() => setF({ ...f, copies: actif ? f.copies.filter((x) => x !== a.id) : [...f.copies, a.id] })}
                      className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${actif ? 'bg-blue-50 border-blue-200 text-docuflow-secondary' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{a.full_name}</button>
                  );
                })}
              </div>
            </Champ>
          </section>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => navigate('/courrier')} className="btn-secondary">Annuler</button>
          <button type="submit" disabled={envoi} className="btn-primary flex items-center gap-2">{envoi && <Loader2 size={15} className="animate-spin" />} Enregistrer au registre</button>
        </div>
      </form>
    </div>
  );
};

export default CourrierNouveauPage;
