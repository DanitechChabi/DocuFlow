import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe, Copy, Printer, ExternalLink } from 'lucide-react';
import api from '../services/api';
import { usePermissions } from '../hooks/usePermissions';
import { toast } from './Toast';

/**
 * Portail citoyen (040) sur la vue d'ensemble des demandes : ouvert ou non,
 * lien à communiquer, affiche à imprimer pour le guichet, premiers chiffres.
 */
const PortailCarte = () => {
  const { can } = usePermissions();
  const [p, setP] = useState(null);
  useEffect(() => {
    if (!can('requests.process')) return;
    api.get('/portail-indicateurs').then((r) => setP(r.data)).catch(() => setP(null));
  }, [can]);
  if (!p) return null;
  const lien = p.lien || (p.chemin ? `${window.location.origin}${p.chemin}` : null);
  return (
    <div className="glass-card-premium p-5 flex flex-col md:flex-row md:items-center gap-4 mb-6">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-blue-50 text-docuflow-secondary flex items-center justify-center flex-shrink-0"><Globe size={20} /></div>
        <div className="min-w-0">
          <p className="font-bold text-slate-800">Portail citoyen {p.actif ? <span className="text-xs font-semibold text-emerald-700">· ouvert</span> : <span className="text-xs font-semibold text-slate-400">· fermé</span>}</p>
          {p.actif
            ? <p className="text-xs text-slate-500 truncate">{p.demandes} demande(s) en ligne · {p.retirees} retirée(s){p.delai_moyen_heures !== null ? ` · acte prêt en ${p.delai_moyen_heures < 1 ? `${Math.max(1, Math.round(p.delai_moyen_heures * 60))} min` : `${p.delai_moyen_heures} h`} en moyenne` : ''}</p>
            : <p className="text-xs text-slate-500">Les usagers demandent leurs actes en ligne et suivent l'avancement : un seul passage au guichet, pour le retrait.</p>}
        </div>
      </div>
      {p.actif && lien ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { navigator.clipboard?.writeText(lien); toast.success('Lien copié'); }} className="btn-secondary flex items-center gap-1.5"><Copy size={14} /> Copier le lien</button>
          <a href={lien} target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-1.5"><ExternalLink size={14} /> Ouvrir</a>
          <Link to="/demandes/portail/affiche" className="btn-primary flex items-center gap-1.5"><Printer size={14} /> Affiche du guichet</Link>
        </div>
      ) : can('settings.manage') && (
        <Link to="/admin-portal?onglet=configuration" className="btn-secondary">Ouvrir le portail</Link>
      )}
    </div>
  );
};

export default PortailCarte;
