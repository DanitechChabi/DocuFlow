import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Download, Eye, Lock, Loader2, AlertCircle } from 'lucide-react';
import { urlApi } from '../services/collaborationService';

/**
 * Page PUBLIQUE d'un lien de partage (migration 033), hors connexion : le
 * jeton de l'URL est la seule autorisation. Appels par fetch et non par
 * l'instance axios authentifiée, dont l'intercepteur déconnecte sur un 401
 * (ici, un 401 veut seulement dire « mot de passe incorrect »).
 */
const taille = (o) => (o == null ? '' : o < 1048576 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1048576).toFixed(1)} Mo`);

const PartagePublicPage = () => {
  const { jeton } = useParams();
  const base = `${urlApi()}/partage/${encodeURIComponent(jeton)}`;
  const [etat, setEtat] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [motDePasse, setMotDePasse] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    document.title = 'Document partagé';
    fetch(base).then(async (r) => {
      const corps = await r.json().catch(() => ({}));
      if (!r.ok) setErreur(corps.message || 'Lien indisponible.');
      else setEtat(corps);
    }).catch(() => setErreur('Serveur injoignable.'));
  }, [base]);

  const deverrouiller = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const r = await fetch(`${base}/acces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mot_de_passe: motDePasse }) });
      const corps = await r.json().catch(() => ({}));
      if (!r.ok) setErreur(r.status === 401 ? null : corps.message);
      if (r.status === 401) setEtat((x) => ({ ...x, refus: corps.message }));
      else if (r.ok) setEtat(corps);
    } finally {
      setEnvoi(false);
    }
  };

  const lienFichier = (mode) => `${base}/fichier?${new URLSearchParams({ ...(etat?.preuve ? { preuve: etat.preuve } : {}), ...(mode ? { mode } : {}) })}`;
  const org = etat?.organisation;
  return (
    <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-elevated border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 flex items-center gap-3 text-white" style={{ background: org?.couleur || '#0f172a' }}>
          {org?.logo_url ? <img src={org.logo_url} alt="" className="h-8 w-8 rounded bg-white object-contain" /> : <FileText size={22} />}
          <p className="font-bold truncate">{org?.nom || 'Document partagé'}</p>
        </div>
        <div className="p-6 space-y-4">
          {erreur ? (
            <p className="text-sm text-red-600 font-semibold flex items-start gap-2"><AlertCircle size={18} className="flex-shrink-0" /> {erreur}</p>
          ) : !etat ? (
            <div className="py-8 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto" /></div>
          ) : etat.protege && !etat.preuve ? (
            <form onSubmit={deverrouiller} className="space-y-3">
              <p className="text-sm text-slate-700 flex items-center gap-2"><Lock size={16} /> Ce document est protégé par un mot de passe.</p>
              <input type="password" autoFocus required className="input-premium" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} placeholder="Mot de passe" />
              {etat.refus && <p className="text-xs text-red-600">{etat.refus}</p>}
              <button type="submit" disabled={envoi || !motDePasse} className="btn btn-primary w-full">{envoi && <Loader2 size={15} className="animate-spin" />} Accéder au document</button>
            </form>
          ) : (
            <>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{etat.document.type || 'Document'}</p>
                <h1 className="text-lg font-black text-slate-900">{etat.document.titre}</h1>
                <p className="text-sm text-slate-500">{etat.document.reference} · {etat.document.annee}</p>
                {etat.libelle && <p className="text-sm text-slate-600 mt-1">{etat.libelle}</p>}
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-sm">
                <p className="font-semibold text-slate-700 break-all">{etat.fichier.nom}</p>
                <p className="text-xs text-slate-500">Version {etat.fichier.version} · {taille(etat.fichier.taille)}</p>
              </div>
              <div className="flex gap-2">
                {etat.fichier.apercu && <a href={lienFichier('apercu')} target="_blank" rel="noopener noreferrer" className="btn btn-secondary flex-1"><Eye size={15} /> Aperçu</a>}
                <a href={lienFichier()} className="btn btn-primary flex-1"><Download size={15} /> Télécharger</a>
              </div>
              <p className="text-xs text-slate-400">
                Lien valable jusqu'au {new Date(etat.expire_at).toLocaleDateString('fr-FR')}
                {etat.telechargements_restants != null && ` · ${etat.telechargements_restants} téléchargement(s) restant(s)`}.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PartagePublicPage;
