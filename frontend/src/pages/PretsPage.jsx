import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpenCheck, Printer, RefreshCw, AlertTriangle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { requestService } from '../services/requestService';
import { toast } from '../components/Toast';
import { libelleDemande, ETATS_PRET, dateCourte, dateHeure } from '../utils/demande';

/**
 * PretsPage — le registre de sortie des dossiers physiques (migration 025).
 *
 * Remplace le registre papier : qui a quel dossier, depuis quand, pour quand,
 * remis par qui, retourné quand et rangé où. Imprimable (window.print et une
 * version papier rendue en portail, voir index.css), pour les structures qui
 * gardent une trace papier pendant la transition — sans dépendance de
 * génération PDF à embarquer dans l'application de bureau.
 */
const FILTRES = [
  { cle: '', libelle: 'Tous' },
  { cle: 'en_cours', libelle: 'En cours' },
  { cle: 'en_retard', libelle: 'En retard' },
  { cle: 'signale', libelle: 'Signalés' },
  { cle: 'retourne', libelle: 'Retournés' },
];

const PretsPage = () => {
  const [filtre, setFiltre] = useState('');
  const [prets, setPrets] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [indisponible, setIndisponible] = useState(null);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setPrets(await requestService.getRegistrePrets(filtre));
      setIndisponible(null);
    } catch (err) {
      if (err.response?.status === 503) setIndisponible(err.response.data?.message);
      else toast.error(err.response?.data?.message || 'Registre des prêts illisible');
    } finally {
      setChargement(false);
    }
  }, [filtre]);

  useEffect(() => { charger(); }, [charger]);

  // Compteurs sur le registre complet : le filtre « Tous » les fournit, les
  // autres vues n'ont que leur sous-ensemble.
  const compteurs = useMemo(() => {
    if (filtre) return null;
    return prets.reduce((acc, p) => ({ ...acc, [p.etat]: (acc[p.etat] || 0) + 1 }), {});
  }, [prets, filtre]);

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 md:py-8">
      <div className="max-w-7xl mx-auto">
        <div>
          <PageHeader
            title="Registre des prêts"
            subtitle="Les dossiers physiques remis aux agents : qui les a, jusqu'à quand, et leur retour"
            icon={BookOpenCheck}
            breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Demandes', to: '/demandes' }, { label: 'Registre des prêts' }]}
            documentTitle="Registre des prêts"
            actions={(
              <>
                <button onClick={charger} className="btn btn-secondary btn-icon" title="Rafraîchir">
                  <RefreshCw size={16} className={chargement ? 'animate-spin' : undefined} />
                </button>
                <button onClick={() => window.print()} className="btn btn-secondary" disabled={!prets.length}>
                  <Printer size={16} /> <span>Imprimer</span>
                </button>
              </>
            )}
          />
        </div>

        {indisponible ? (
          <div className="mt-6 p-5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex gap-3">
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" /> {indisponible}
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Filtrer le registre">
              {FILTRES.map((f) => (
                <button key={f.cle || 'tous'} role="tab" aria-selected={filtre === f.cle} onClick={() => setFiltre(f.cle)}
                  className={`px-4 py-2 rounded-full text-sm font-bold border transition-all ${
                    filtre === f.cle ? 'bg-docuflow-primary text-white border-docuflow-primary' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                  {f.libelle}
                  {compteurs && f.cle && compteurs[f.cle] ? <span className="ml-2 opacity-70">{compteurs[f.cle]}</span> : null}
                </button>
              ))}
            </div>

            <div className="mt-4 bg-white rounded-2xl border border-slate-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-widest text-slate-400 border-b border-slate-100">
                    <th className="px-4 py-3">Dossier</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Remis</th>
                    <th className="px-4 py-3">Retour prévu</th>
                    <th className="px-4 py-3">Retour</th>
                    <th className="px-4 py-3">État</th>
                  </tr>
                </thead>
                <tbody>
                  {chargement && !prets.length ? (
                    [...Array(4)].map((_, i) => (
                      <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-6 skeleton rounded" /></td></tr>
                    ))
                  ) : !prets.length ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                        {filtre ? 'Aucun prêt dans cette catégorie.' : 'Aucun dossier remis pour l\'instant. La remise se fait depuis la fiche d\'une demande.'}
                      </td>
                    </tr>
                  ) : prets.map((p) => {
                    const etat = ETATS_PRET[p.etat] || {};
                    return (
                      <tr key={p.id} className="border-b border-slate-50 align-top">
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-800">{libelleDemande({ ...p, id: p.request_id })}</p>
                          {p.observation_remise && <p className="text-xs text-slate-500 mt-0.5">{p.observation_remise}</p>}
                          {p.signalement && <p className="text-xs text-amber-700 mt-1">⚠ Signalé : {p.signalement}</p>}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{p.emprunteur_name || '—'}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {dateHeure(p.remis_at)}
                          <p className="text-xs text-slate-400">par {p.remis_par_name || '—'}</p>
                          {p.reception_confirmee_at && <p className="text-xs text-emerald-600">Réception confirmée</p>}
                        </td>
                        <td className={`px-4 py-3 ${p.etat === 'en_retard' ? 'text-red-600 font-bold' : 'text-slate-600'}`}>{dateCourte(p.date_retour_prevue)}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {p.retourne_at ? (
                            <>
                              {dateHeure(p.retourne_at)}
                              <p className="text-xs text-slate-400">par {p.retourne_par_name || '—'}</p>
                              {p.observation_retour && <p className="text-xs text-slate-500">{p.observation_retour}</p>}
                            </>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${etat.classe || ''}`}>{etat.libelle || p.etat}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Version papier : portail hors de la mise en page de l'application
          (voir .portail-impression dans index.css). Sobre, sans couleurs ni
          pastilles, lisible en noir et blanc. */}
      {createPortal(
        <div className="portail-impression">
          <h1 style={{ fontSize: 16, fontWeight: 700 }}>Registre des prêts de dossiers</h1>
          <p style={{ margin: '2px 0 10px' }}>{FILTRES.find((f) => f.cle === filtre)?.libelle} — imprimé le {dateHeure(new Date())} — {prets.length} prêt(s)</p>
          <table>
            <thead>
              <tr><th>Dossier</th><th>Agent</th><th>Remis le / par</th><th>Retour prévu</th><th>Retourné le / par</th><th>État</th><th>Observations</th></tr>
            </thead>
            <tbody>
              {prets.map((p) => (
                <tr key={p.id}>
                  <td>{libelleDemande({ ...p, id: p.request_id })}</td>
                  <td>{p.emprunteur_name || '—'}</td>
                  <td>{dateHeure(p.remis_at)}<br />{p.remis_par_name || '—'}</td>
                  <td>{dateCourte(p.date_retour_prevue)}</td>
                  <td>{p.retourne_at ? <>{dateHeure(p.retourne_at)}<br />{p.retourne_par_name || '—'}</> : '—'}</td>
                  <td>{ETATS_PRET[p.etat]?.libelle || p.etat}</td>
                  <td>
                    {[p.observation_remise && `Remise : ${p.observation_remise}`, p.observation_retour && `Retour : ${p.observation_retour}`,
                      p.signalement && `Signalé : ${p.signalement}`].filter(Boolean).join(' — ') || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
        document.body
      )}
    </div>
  );
};

export default PretsPage;
