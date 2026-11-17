import React, { useEffect, useState } from 'react';
import { Database, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react';
import { settingsService } from '../../../services/settingsService';
import { requestService } from '../../../services/requestService';
import { toast } from '../../../components/Toast';
import { intitule } from './vocabulaire';

// ============================================================================
// Dossiers numérisés dans M-Files (réglage « Années numérisées », ex. 2025) :
// on ne sort plus le papier, l'archive envoie la copie depuis M-Files puis
// clique « Servi par M-Files ». L'année d'un dossier se lit dans la demande
// (champ année, acte « 2025/… ») ou dans son entrée aux archives (point).
// ============================================================================

let reglages = null;
function lireReglages() {
  if (!reglages) {
    reglages = settingsService.getSettings().then((s) => ({
      annees: String(s.mfiles_annees || '').split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 1900),
      url: /^https?:\/\//.test(String(s.mfiles_url || '').trim()) ? String(s.mfiles_url).trim() : null,
    })).catch(() => { reglages = null; return { annees: [], url: null }; });
  }
  return reglages;
}

export function useMfiles() {
  const [r, setR] = useState({ annees: [], url: null });
  useEffect(() => { let actif = true; lireReglages().then((x) => actif && setR(x)); return () => { actif = false; }; }, []);
  return r;
}

/** Année d'un dossier : la demande d'abord, sinon le point d'entrée trouvé (si le nom concorde). */
export function anneeDuDossier(d, presence) {
  const a = Number(d?.annee);
  if (Number.isInteger(a) && a > 1900) return a;
  const m = /^((?:19|20)\d{2})\s*[/.-]/.exec(String(d?.num_acte || '').trim()) || /(?:^|\D)((?:19|20)\d{2})[-/]\d+$/.exec(String(d?.num_acte || ''));
  if (m) return Number(m[1]);
  const e = presence?.entrees?.[0];
  if (e && e.nom_concorde !== false && e.date_point) return Number(e.date_point.slice(0, 4));
  return null;
}

export const estNumerise = (d, presence, annees) => {
  const a = anneeDuDossier(d, presence);
  return Boolean(a && annees.includes(a));
};

/** Bandeau « Numérisé dans M-Files » et geste « Servi par M-Files ». */
export const ServirMfiles = ({ d, url, onFait, compact = false }) => {
  const [envoi, setEnvoi] = useState(false);
  const servir = async () => {
    setEnvoi(true);
    try {
      await requestService.serviMfiles(d.id);
      toast.success(`Servi par M-Files : ${intitule(d)}${d.requester_name ? `, pour ${d.requester_name}` : ''}.`);
      onFait?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Le geste n\'a pas pu être enregistré.');
    } finally { setEnvoi(false); }
  };
  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-2'}`}>
      {!compact && (
        <span className="inline-flex items-center gap-1.5 text-sm font-black text-blue-900">
          <Database size={15} /> Numérisé dans M-Files <span className="font-semibold text-blue-800">— envoyez la copie, le papier ne sort pas</span>
        </span>
      )}
      <span className="ml-auto flex gap-2">
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl border-2 border-blue-200 bg-white text-sm font-bold text-blue-800 inline-flex items-center gap-1.5 hover:border-blue-400">
            <ExternalLink size={14} /> Ouvrir M-Files
          </a>
        )}
        <button type="button" onClick={servir} disabled={envoi}
          className="px-3.5 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-60 shadow-sm shadow-blue-200">
          {envoi ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Servi par M-Files
        </button>
      </span>
    </div>
  );
};
