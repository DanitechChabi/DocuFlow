import React, { useEffect, useState } from 'react';
import { DatabaseZap, Search, Loader2, ExternalLink, FileText, Download, Sparkles, ArrowLeft, RefreshCw } from 'lucide-react';
import api from '../../../services/api';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, Chargement } from './elements';

// ============================================================================
// Recherche M-Files (060) : la recherche rapide de M-Files depuis
// l'application (API REST), la fiche d'un objet et ses fichiers, et les
// questions posées au contenu des documents indexés (RAG).
// ============================================================================

const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

const MfilesAfgc = () => {
  useTitrePage('Recherche M-Files');
  const [etat, setEtat] = useState(null);
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [cherche, setCherche] = useState(false);
  const [fiche, setFiche] = useState(null);
  const [question, setQuestion] = useState('');
  const [reponse, setReponse] = useState(null);
  const [demande, setDemande] = useState(false);
  const [indexation, setIndexation] = useState(false);

  const chargerEtat = () => api.get('/mfiles/etat').then((r) => setEtat(r.data)).catch(() => setEtat({ mfiles: { raccorde: false }, rag: { sources: [] } }));
  useEffect(() => { chargerEtat(); }, []);

  const rechercher = async (e) => {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setCherche(true); setFiche(null);
    try { setRes((await api.get('/mfiles/recherche', { params: { q: q.trim(), limite: 100 } })).data); } catch (err) { toast.error(err.response?.data?.message || 'Recherche impossible.'); } finally { setCherche(false); }
  };

  const ouvrir = async (o) => {
    setFiche({ ...o, chargement: true });
    try { setFiche((await api.get(`/mfiles/objets/${o.type}/${o.id}`)).data); } catch (err) { toast.error(err.response?.data?.message || 'Objet indisponible.'); setFiche(null); }
  };

  const fichier = async (o, f, telecharger) => {
    try {
      const r = await api.get(`/mfiles/objets/${o.type}/${o.id}/fichiers/${f.id}`, { params: { nom: f.nom, telecharger: telecharger ? 1 : undefined }, responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      if (telecharger) { const a = document.createElement('a'); a.href = url; a.download = f.nom; a.click(); } else window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { toast.error('Fichier indisponible.'); }
  };

  const indexerObjet = async (o) => {
    try {
      const r = (await api.post(`/mfiles/objets/${o.type}/${o.id}/indexer`)).data;
      toast.success(r.sansTexte ? 'Indexé, mais aucun texte lisible dans ses fichiers.' : `Indexé pour DocuBot (${r.morceaux} passages).`);
      chargerEtat();
    } catch (err) { toast.error(err.response?.data?.message || 'Indexation impossible.'); }
  };

  const indexerRecherche = async () => {
    if (!window.confirm(`Lire le contenu des ${res.resultats.length} résultats pour que DocuBot puisse répondre dessus ? Cela peut prendre plusieurs minutes.`)) return;
    setIndexation(true);
    try {
      const r = (await api.post('/mfiles/indexer', { q: q.trim(), limite: 500 })).data;
      toast.success(`${r.indexes} document(s) indexé(s), ${r.deja} déjà à jour${r.erreurs ? `, ${r.erreurs} en erreur` : ''}.`);
      chargerEtat();
    } catch (err) { toast.error(err.response?.data?.message || 'Indexation impossible.'); } finally { setIndexation(false); }
  };

  const poser = async (e) => {
    e.preventDefault();
    if (question.trim().length < 3) return;
    setDemande(true);
    try { setReponse((await api.post('/mfiles/question', { question: question.trim() })).data); } catch (err) { toast.error(err.response?.data?.message || 'Question impossible.'); } finally { setDemande(false); }
  };

  if (!etat) return <div className="p-8"><Chargement /></div>;
  const m = etat.mfiles;
  const indexes = etat.rag.sources.reduce((n, s) => n + s.documents, 0);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <EnTete titre="Recherche M-Files" icone={DatabaseZap}
        aide="Les dossiers numérisés et indexés dans M-Files, cherchés depuis l'application. Les documents indexés pour DocuBot répondent aussi aux questions sur leur contenu." />

      {!m.raccorde && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          M-Files n'est pas encore raccordé. L'administrateur du serveur renseigne l'adresse de l'API REST, le coffre et un compte de service
          (variables MFILES_REST_URL, MFILES_VAULT_GUID, MFILES_USERNAME, MFILES_PASSWORD), puis redémarre le service.
        </div>
      )}
      {m.raccorde && !m.joignable && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          M-Files ne répond pas ({m.erreur}). Le serveur de l'application doit pouvoir joindre {m.adresse}.
        </div>
      )}

      <form onSubmit={rechercher} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} disabled={!m.raccorde} placeholder="Client, n° d'acte, typologie… comme dans M-Files"
            className="w-full pl-10 pr-3 py-2.5 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-slate-500 disabled:bg-slate-50" />
        </div>
        <button type="submit" disabled={cherche || !m.raccorde} className="px-4 py-2.5 rounded-md bg-slate-800 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
          {cherche ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Rechercher
        </button>
      </form>

      {fiche ? (
        <section className="rounded-lg border border-slate-200 bg-white mb-8">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setFiche(null)} className="p-1 rounded hover:bg-slate-100" aria-label="Retour"><ArrowLeft size={16} /></button>
            <h2 className="text-sm font-semibold text-slate-900 flex-1 min-w-0 truncate">{fiche.titre}</h2>
            {fiche.lien && <a href={fiche.lien} target="_blank" rel="noreferrer" className="text-sm font-semibold text-slate-700 inline-flex items-center gap-1 hover:underline"><ExternalLink size={14} /> Ouvrir dans M-Files</a>}
            {!fiche.chargement && <button type="button" onClick={() => indexerObjet(fiche)} className="text-sm font-semibold text-slate-700 inline-flex items-center gap-1 hover:underline"><Sparkles size={14} /> Indexer pour DocuBot</button>}
          </div>
          {fiche.chargement ? <Chargement /> : (
            <div className="grid gap-6 p-4 md:grid-cols-[1fr_18rem]">
              <dl className="grid grid-cols-[11rem_1fr] gap-x-4 gap-y-1.5 text-sm">
                {fiche.proprietes.map((p) => <React.Fragment key={p.id}><dt className="text-slate-500">{p.nom}</dt><dd className="text-slate-900 break-words">{String(p.valeur)}</dd></React.Fragment>)}
              </dl>
              <div>
                <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Fichiers</h3>
                <ul className="space-y-1.5">
                  {fiche.fichiers.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 text-sm">
                      <FileText size={15} className="text-slate-400 shrink-0" />
                      <button type="button" onClick={() => fichier(fiche, f, false)} className="flex-1 min-w-0 truncate text-left text-slate-800 hover:underline">{f.nom}</button>
                      <button type="button" onClick={() => fichier(fiche, f, true)} className="p-1 rounded text-slate-500 hover:bg-slate-100" aria-label="Télécharger"><Download size={14} /></button>
                    </li>
                  ))}
                  {!fiche.fichiers.length && <li className="text-sm text-slate-500">Aucun fichier.</li>}
                </ul>
              </div>
            </div>
          )}
        </section>
      ) : res && (
        <section className="rounded-lg border border-slate-200 bg-white mb-8">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-900 flex-1">{res.resultats.length} résultat{res.resultats.length > 1 ? 's' : ''}{res.plus ? ' (les premiers)' : ''}</h2>
            {res.resultats.length > 0 && (
              <button type="button" onClick={indexerRecherche} disabled={indexation} className="text-sm font-semibold text-slate-700 inline-flex items-center gap-1 hover:underline disabled:opacity-60">
                {indexation ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Indexer ces résultats pour DocuBot
              </button>
            )}
          </div>
          {res.resultats.length ? (
            <ul className="divide-y divide-slate-100">
              {res.resultats.map((o) => (
                <li key={`${o.type}-${o.id}`} className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-0.5">
                  <button type="button" onClick={() => ouvrir(o)} className="font-semibold text-slate-900 text-left min-w-0 flex-1 basis-64 hover:underline">{o.titre}</button>
                  <span className="text-xs text-slate-500">{[dateFr(o.modifie_le), o.fichiers.map((f) => f.nom).join(', ')].filter(Boolean).join(' · ')}</span>
                  <a href={o.lien} target="_blank" rel="noreferrer" className="p-1 rounded text-slate-500 hover:bg-slate-100" aria-label="Ouvrir dans M-Files"><ExternalLink size={14} /></a>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-sm text-slate-500">M-Files ne trouve rien.</p>}
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center gap-3">
          <Sparkles size={16} className="text-slate-600" />
          <h2 className="text-sm font-semibold text-slate-900 flex-1">Poser une question aux documents</h2>
          <span className="text-xs text-slate-500">{indexes} document{indexes > 1 ? 's' : ''} indexé{indexes > 1 ? 's' : ''}{etat.rag.ollama ? '' : ' · réponses sans rédaction (Ollama non réglé)'}</span>
          <button type="button" onClick={chargerEtat} className="p-1 rounded text-slate-500 hover:bg-slate-100" aria-label="Actualiser"><RefreshCw size={14} /></button>
        </div>
        <form onSubmit={poser} className="p-4 flex gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex. : quelle est la durée de la caution de bonne exécution de Sarl X ?"
            className="flex-1 px-3 py-2.5 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-slate-500" />
          <button type="submit" disabled={demande || !indexes} className="px-4 py-2.5 rounded-md bg-[#2C9C0A] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
            {demande && <Loader2 size={15} className="animate-spin" />} Demander
          </button>
        </form>
        {reponse && (
          <div className="px-4 pb-4 space-y-3">
            <p className="text-sm text-slate-800 whitespace-pre-line">{reponse.texte}</p>
            {reponse.sources?.length > 0 && (
              <ol className="space-y-1.5">
                {reponse.sources.map((s) => (
                  <li key={s.n} className="text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">{s.n}. {s.titre}</span> · {s.source}
                    {s.lien && <> · <a href={s.lien} target={/^https?:/.test(s.lien) ? '_blank' : undefined} rel="noreferrer" className="underline">ouvrir</a></>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default MfilesAfgc;
