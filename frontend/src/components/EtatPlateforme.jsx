import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import api from '../services/api';
import { estBureau } from '../utils/plateforme';

/* global __VERSION_INTERFACE__ */
const VERSION_INTERFACE = typeof __VERSION_INTERFACE__ !== 'undefined' ? __VERSION_INTERFACE__ : '';

/**
 * État de la plateforme : quelle version tourne (interface et serveur), la
 * base répond-elle, où en sont les migrations, les fichiers sont-ils stockés
 * durablement. Répond à « je ne vois pas la mise à jour » et « mes documents
 * n'apparaissent plus » sans accès aux consoles d'hébergement.
 */
const EtatPlateforme = () => {
  const [etat, setEtat] = useState(null);
  const [erreur, setErreur] = useState('');
  const [charge, setCharge] = useState(false);

  const verifier = async () => {
    setCharge(true);
    setErreur('');
    try {
      setEtat((await api.get('/health', { timeout: 60000 })).data);
    } catch (err) {
      if (err.response?.data?.api) setEtat(err.response.data);
      else setErreur(err.code === 'ECONNABORTED'
        ? 'Le serveur ne répond pas (il redémarre peut-être : sur l\'offre gratuite de Render, le réveil prend jusqu\'à une minute).'
        : 'Serveur injoignable depuis ce navigateur.');
    } finally {
      setCharge(false);
    }
  };
  useEffect(() => { verifier(); }, []);

  const ligne = (libelle, valeur, ok = true) => (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0 text-sm">
      <span className="text-slate-500">{libelle}</span>
      <span className={`font-semibold text-right ${ok ? 'text-slate-800' : 'text-red-600'}`}>{valeur}</span>
    </div>
  );

  return (
    <section className="glass-card-premium p-5 mb-6" aria-labelledby="titre-etat">
      <div className="flex items-center justify-between mb-3">
        <h2 id="titre-etat" className="font-bold text-slate-800 flex items-center gap-2"><Activity size={18} /> État de la plateforme</h2>
        <button type="button" onClick={verifier} disabled={charge} className="btn btn-secondary text-sm">
          <RefreshCw size={14} className={charge ? 'animate-spin' : ''} /> Vérifier
        </button>
      </div>
      {ligne('Version de l\'interface', VERSION_INTERFACE || 'non communiquée')}
      {erreur ? ligne('Serveur', erreur, false) : etat && (
        <>
          {ligne('Version du serveur', etat.version || 'non communiquée')}
          {ligne('Serveur démarré le', new Date(etat.demarre_le).toLocaleString('fr-FR'))}
          {ligne('Base de données', etat.base === 'ok' ? 'répond' : `injoignable — ${etat.base_erreur || ''}`, etat.base === 'ok')}
          {ligne('Dernière migration', etat.migration_en_echec ? `ÉCHEC de ${etat.migration_en_echec}` : (etat.derniere_migration || '—'), !etat.migration_en_echec)}
          {ligne('Stockage des fichiers', etat.stockage === 'cloudinary' ? 'Cloudinary (durable)' : estBureau() ? 'disque du poste' : 'disque du serveur', etat.stockage === 'cloudinary' || estBureau())}
        </>
      )}
      {etat && etat.stockage === 'local' && !estBureau() && (
        <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex gap-2">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          Les fichiers sont enregistrés sur le disque du serveur. Sur Render sans disque persistant, ils sont effacés à chaque redéploiement :
          les fiches restent, mais leurs fichiers deviennent introuvables. Configurez Cloudinary (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
          CLOUDINARY_API_SECRET) ou attachez un disque Render.
        </p>
      )}
      {etat && etat.base === 'ok' && !etat.migration_en_echec && (etat.stockage === 'cloudinary' || estBureau()) && (
        <p className="mt-3 text-xs text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14} /> Tout est en ordre.</p>
      )}
    </section>
  );
};

export default EtatPlateforme;
