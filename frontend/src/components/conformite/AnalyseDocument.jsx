import React, { useCallback, useEffect, useState } from 'react';
import { ScanSearch, RefreshCw, Loader2, Bot, ShieldCheck } from 'lucide-react';
import { conformiteService, NATURES, montant } from '../../services/conformiteService';
import { usePermissions } from '../../hooks/usePermissions';
import AlerteCarte from './AlerteCarte';
import { toast } from '../Toast';

/**
 * Carte « Analyse » de la fiche d'un document : ce que la lecture a trouvé
 * (nature, émetteur, montants, dates, identifiants) et les alertes de
 * conformité qui le concernent.
 */
const Ligne = ({ libelle, valeur, mono }) => (valeur ? (
  <div className="flex justify-between gap-3 text-xs py-1 border-b border-slate-50 last:border-0">
    <span className="text-slate-500">{libelle}</span>
    <span className={`text-right font-semibold text-slate-800 ${mono ? 'font-mono' : ''}`}>{valeur}</span>
  </div>
) : null);

const date = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : null);

const AnalyseDocument = ({ documentId }) => {
  const { can } = usePermissions();
  const [etat, setEtat] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    conformiteService.analyseDocument(documentId).then(setEtat).catch(() => setEtat({ extraction: null, alertes: [] }));
  }, [documentId]);
  useEffect(() => { charger(); }, [charger]);

  if (!can('compliance.view')) return null;

  const relancer = async () => {
    setEnvoi(true);
    try {
      setEtat(await conformiteService.relancerAnalyse(documentId));
      toast.success('Document relu');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Analyse impossible');
    } finally {
      setEnvoi(false);
    }
  };

  const e = etat?.extraction;
  const d = e?.donnees || {};
  return (
    <div className="glass-card-premium p-5 space-y-3" data-tour="analyse-document">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5"><ScanSearch size={14} /> Analyse</span>
        {can('compliance.manage') && (
          <button type="button" onClick={relancer} disabled={envoi} className="text-[11px] font-bold text-docuflow-secondary flex items-center gap-1 normal-case tracking-normal">
            {envoi ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Relire
          </button>
        )}
      </h3>
      {!etat ? <div className="h-16 skeleton rounded-xl" /> : !e ? (
        <p className="text-xs text-slate-500">Pas encore analysé : l'analyse se fait dès que le texte du document est lisible.</p>
      ) : (
        <>
          <div>
            <Ligne libelle="Nature" valeur={NATURES[e.nature] || e.nature} />
            <Ligne libelle="Émetteur" valeur={d.emetteur_nom} />
            <Ligne libelle="Destinataire" valeur={d.destinataire_nom} />
            <Ligne libelle="Numéro" valeur={d.numero_document} mono />
            <Ligne libelle="Identifiant" valeur={d.identifiant || d.identifiant_declare} mono />
            <Ligne libelle="Établissement" valeur={d.etablissement} mono />
            <Ligne libelle="Montant HT" valeur={d.montant_ht !== null && d.montant_ht !== undefined ? montant(d.montant_ht, d.devise) : null} />
            <Ligne libelle="TVA" valeur={d.montant_tva !== null && d.montant_tva !== undefined ? montant(d.montant_tva, d.devise) : null} />
            <Ligne libelle="Montant TTC" valeur={d.montant_ttc !== null && d.montant_ttc !== undefined ? montant(d.montant_ttc, d.devise) : null} />
            <Ligne libelle="Émis le" valeur={date(d.date_emission)} />
            <Ligne libelle="Échéance / validité" valeur={date(d.date_echeance)} />
          </div>
          <p className="text-[11px] text-slate-400 flex items-center gap-1">
            <Bot size={12} /> {e.source === 'llm' ? `Lu par ${e.modele}` : 'Lu par les règles intégrées'} · {new Date(e.analyse_at).toLocaleString('fr-FR')}
            {e.erreur && <span className="text-amber-600"> · modèle indisponible</span>}
          </p>
          {etat.alertes.length ? (
            <div className="space-y-2">
              {etat.alertes.map((a) => <AlerteCarte key={a.id} alerte={a} compact peutGerer={can('compliance.manage')} onChange={charger} />)}
            </div>
          ) : (
            <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1"><ShieldCheck size={13} /> Aucune incohérence avec les autres documents</p>
          )}
        </>
      )}
    </div>
  );
};

export default AnalyseDocument;
