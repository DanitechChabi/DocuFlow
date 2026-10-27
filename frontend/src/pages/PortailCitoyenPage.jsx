import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { FileText, Search, Loader2, CheckCircle2, Circle, Copy, AlertCircle, MapPin } from 'lucide-react';
import { urlApi } from '../services/collaborationService';

/**
 * Portail citoyen (migration 040), PUBLIC : l'usager demande un acte sans
 * compte et suit sa demande avec son code. Pensé pour le téléphone. Appels par
 * fetch (pas l'instance axios authentifiée, qui déconnecte sur un 401).
 */
const ETAPES = ['Demande reçue', 'Recherche de l\'acte', 'Acte prêt', 'Acte retiré'];

const Champ = ({ libelle, aide, children }) => (
  <label className="block">
    <span className="text-sm font-semibold text-slate-700">{libelle}</span>
    {aide && <span className="block text-xs text-slate-500">{aide}</span>}
    <div className="mt-1">{children}</div>
  </label>
);

const Suivi = ({ base, codeInitial }) => {
  const [code, setCode] = useState(codeInitial || '');
  const [res, setRes] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const chercher = async (e, valeur = code) => {
    e?.preventDefault();
    if (!valeur.trim()) return;
    setEnvoi(true); setErreur(null); setRes(null);
    try {
      const r = await fetch(`${base}/suivi/${encodeURIComponent(valeur.trim())}`);
      const corps = await r.json().catch(() => ({}));
      if (r.status === 404) setErreur('Aucune demande ne correspond à ce code. Vérifiez-le (il commence par DF-).');
      else if (!r.ok) setErreur(corps.message || 'Suivi indisponible.');
      else setRes(corps);
    } catch { setErreur('Serveur injoignable.'); } finally { setEnvoi(false); }
  };
  useEffect(() => { if (codeInitial) chercher(null, codeInitial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return (
    <div className="space-y-4">
      <form onSubmit={chercher} className="flex gap-2">
        <input className="input-premium flex-1 uppercase tracking-wider" placeholder="DF-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code de suivi" />
        <button type="submit" disabled={envoi} className="btn-primary flex items-center gap-2">{envoi ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Suivre</button>
      </form>
      {erreur && <p className="p-3 rounded-xl bg-red-50 text-red-700 text-sm flex gap-2"><AlertCircle size={16} className="flex-shrink-0 mt-0.5" /> {erreur}</p>}
      {res && (
        <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-4">
          <div>
            <p className="text-xs text-slate-500">{res.code} · {res.type} · déposée le {new Date(res.depose_le).toLocaleDateString('fr-FR')}</p>
            <p className={`text-lg font-bold mt-1 ${res.statut.cle === 'prete' ? 'text-emerald-700' : res.statut.cle === 'rejetee' || res.statut.cle === 'annulee' ? 'text-red-700' : 'text-slate-800'}`}>{res.statut.libelle}</p>
            {res.statut.motif && <p className="text-sm text-slate-600 mt-1">{res.statut.motif}</p>}
          </div>
          {res.statut.etape > 0 && (
            <ol className="space-y-2">
              {ETAPES.map((e, i) => (
                <li key={e} className="flex items-center gap-2 text-sm">
                  {i < res.statut.etape ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Circle size={18} className="text-slate-300" />}
                  <span className={i < res.statut.etape ? 'font-semibold text-slate-800' : 'text-slate-400'}>{e}</span>
                </li>
              ))}
            </ol>
          )}
          {res.statut.cle === 'prete' && (
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-900 text-sm space-y-1">
              {res.lieu_retrait && <p className="flex gap-2"><MapPin size={16} className="flex-shrink-0 mt-0.5" /> {res.lieu_retrait}</p>}
              <p>Présentez votre code <b>{res.code}</b> et une pièce d'identité.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const PortailCitoyenPage = () => {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const base = `${urlApi()}/portail/${encodeURIComponent(slug)}`;
  const [org, setOrg] = useState(null);
  const [erreurOrg, setErreurOrg] = useState(null);
  const onglet = params.get('suivi') !== null ? 'suivi' : 'demande';
  const [f, setF] = useState({ type_acte: 'naissance', lien: 'soi_meme', demandeur_nom: '', demandeur_prenoms: '', telephone: '', email: '', personne_concernee: '', date_evenement: '', annee_evenement: '', lieu_evenement: '', numero_acte: '', motif: '', site_web: '' });
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [recu, setRecu] = useState(null);

  useEffect(() => {
    fetch(base).then(async (r) => {
      const corps = await r.json().catch(() => ({}));
      if (!r.ok) setErreurOrg(r.status === 404 ? 'Ce portail n\'est pas ouvert.' : (corps.message || 'Portail indisponible.'));
      else { setOrg(corps); document.title = `Démarches en ligne — ${corps.nom}`; }
    }).catch(() => setErreurOrg('Serveur injoignable.'));
  }, [base]);

  const champ = (cle) => ({ value: f[cle], onChange: (e) => setF({ ...f, [cle]: e.target.value }) });
  const envoyer = async (e) => {
    e.preventDefault();
    setEnvoi(true); setErreur(null);
    try {
      const r = await fetch(`${base}/demandes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const corps = await r.json().catch(() => ({}));
      if (!r.ok) setErreur(corps.message || 'Envoi impossible.');
      else { setRecu(corps); window.scrollTo(0, 0); }
    } catch { setErreur('Serveur injoignable. Vérifiez votre connexion.'); } finally { setEnvoi(false); }
  };

  if (erreurOrg) return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><p className="text-slate-600 font-semibold">{erreurOrg}</p></div>;
  if (!org) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 size={28} className="animate-spin text-slate-400" /></div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-xl mx-auto px-4 py-4 flex items-center gap-3">
          {org.logo ? <img src={org.logo} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <div className="w-10 h-10 rounded-lg bg-docuflow-secondary text-white flex items-center justify-center"><FileText size={20} /></div>}
          <div className="min-w-0">
            <p className="font-bold text-slate-900 truncate">{org.nom}</p>
            <p className="text-xs text-slate-500">Démarches en ligne</p>
          </div>
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <div className="flex rounded-xl bg-white border border-slate-200 p-1" role="tablist">
          {[['demande', 'Demander un acte'], ['suivi', 'Suivre ma demande']].map(([cle, libelle]) => (
            <button key={cle} type="button" role="tab" aria-selected={onglet === cle} onClick={() => { setRecu(null); setParams(cle === 'suivi' ? { suivi: '' } : {}, { replace: true }); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold ${onglet === cle ? 'bg-docuflow-secondary text-white' : 'text-slate-600'}`}>{libelle}</button>
          ))}
        </div>

        {onglet === 'suivi' ? <Suivi base={base} codeInitial={params.get('suivi') || ''} /> : recu ? (
          <div className="p-5 rounded-2xl bg-white border border-emerald-200 space-y-3 text-center">
            <CheckCircle2 size={40} className="text-emerald-600 mx-auto" />
            <p className="text-lg font-bold text-slate-900">Demande enregistrée</p>
            <p className="text-sm text-slate-600">Notez votre code de suivi. Il vous sera demandé au retrait.</p>
            <p className="text-2xl font-black tracking-widest text-slate-900 font-mono">{recu.code_suivi}</p>
            <button type="button" onClick={() => navigator.clipboard?.writeText(recu.code_suivi)} className="btn-secondary inline-flex items-center gap-2"><Copy size={15} /> Copier le code</button>
            <p className="text-sm text-slate-600">Vous serez prévenu{f.email ? ' par e-mail' : ''} quand l'acte sera prêt. Vous pouvez aussi suivre l'avancement ici, à tout moment.</p>
            <button type="button" onClick={() => setParams({ suivi: recu.code_suivi }, { replace: true })} className="btn-primary">Suivre ma demande</button>
          </div>
        ) : (
          <form onSubmit={envoyer} className="space-y-4">
            {org.message && <p className="p-3 rounded-xl bg-blue-50 text-sm text-slate-700 whitespace-pre-line">{org.message}</p>}
            <section className="p-4 rounded-2xl bg-white border border-slate-200 space-y-3">
              <h2 className="font-bold text-slate-900">L'acte demandé</h2>
              <Champ libelle="Type d'acte">
                <select className="input-premium" {...champ('type_acte')}>{Object.entries(org.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </Champ>
              <Champ libelle="Personne concernée *" aide="Nom et prénoms tels qu'ils figurent sur l'acte">
                <input className="input-premium" required {...champ('personne_concernee')} />
              </Champ>
              <div className="grid grid-cols-2 gap-3">
                <Champ libelle="Date de l'événement" aide="Naissance, mariage, décès">
                  <input type="date" className="input-premium" {...champ('date_evenement')} />
                </Champ>
                <Champ libelle="ou l'année" aide="Si la date est inconnue">
                  <input type="number" inputMode="numeric" className="input-premium" placeholder="1998" {...champ('annee_evenement')} />
                </Champ>
              </div>
              <Champ libelle="Lieu de l'événement"><input className="input-premium" {...champ('lieu_evenement')} /></Champ>
              <Champ libelle="Numéro de l'acte" aide="Facultatif, s'il figure sur une ancienne copie"><input className="input-premium" {...champ('numero_acte')} /></Champ>
              <Champ libelle="Motif" aide="Facultatif : passeport, concours, mariage…"><input className="input-premium" {...champ('motif')} /></Champ>
            </section>
            <section className="p-4 rounded-2xl bg-white border border-slate-200 space-y-3">
              <h2 className="font-bold text-slate-900">Vous</h2>
              <div className="grid grid-cols-2 gap-3">
                <Champ libelle="Nom *"><input className="input-premium" required autoComplete="family-name" {...champ('demandeur_nom')} /></Champ>
                <Champ libelle="Prénoms *"><input className="input-premium" required autoComplete="given-name" {...champ('demandeur_prenoms')} /></Champ>
              </div>
              <Champ libelle="Votre lien avec la personne concernée">
                <select className="input-premium" {...champ('lien')}>{Object.entries(org.liens).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </Champ>
              <Champ libelle="Téléphone *"><input type="tel" className="input-premium" required autoComplete="tel" placeholder="+229 01 00 00 00 00" {...champ('telephone')} /></Champ>
              <Champ libelle="E-mail" aide="Facultatif : pour être prévenu quand l'acte est prêt"><input type="email" className="input-premium" autoComplete="email" {...champ('email')} /></Champ>
              {/* Champ piège : invisible pour l'usager, rempli par les robots. */}
              <input type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" {...champ('site_web')} />
            </section>
            {erreur && <p className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{erreur}</p>}
            <button type="submit" disabled={envoi} className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2">
              {envoi && <Loader2 size={18} className="animate-spin" />} Envoyer ma demande
            </button>
            <p className="text-xs text-slate-500 text-center">Vos informations servent uniquement au traitement de cette demande par {org.nom}.</p>
          </form>
        )}
      </main>
    </div>
  );
};

export default PortailCitoyenPage;
