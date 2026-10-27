import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, Rocket, ChevronRight } from 'lucide-react';
import { settingsService } from '../services/settingsService';
import { usePermissions } from '../hooks/usePermissions';

// ============================================================================
// AssistantDemarrage — mise en place d'une organisation, pas à pas.
// Les étapes sont constatées par le serveur (GET /settings/demarrage) : rien à
// cocher, l'étape se valide quand la chose est faite. L'assistant s'efface de
// lui-même quand les étapes obligatoires sont faites ; on peut aussi le masquer.
// ============================================================================

const CLE_MASQUE = 'docuflow:demarrage-masque';

const AssistantDemarrage = () => {
  const { can } = usePermissions();
  const autorise = can('settings.manage');
  const [etat, setEtat] = useState(null);
  const [masque, setMasque] = useState(() => {
    try { return localStorage.getItem(CLE_MASQUE) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (!autorise || masque) return;
    settingsService.demarrage().then(setEtat).catch(() => setEtat(null));
  }, [autorise, masque]);

  if (!autorise || masque || !etat || etat.termine) return null;

  const masquer = () => {
    try { localStorage.setItem(CLE_MASQUE, '1'); } catch { /* privé */ }
    setMasque(true);
  };
  const prochaine = etat.etapes.find((e) => !e.fait && !e.facultatif) || etat.etapes.find((e) => !e.fait);
  const pourcentage = Math.round((etat.faites / etat.total) * 100);

  return (
    <section className="glass-card-premium p-5 mt-6" data-tour="assistant-demarrage" aria-labelledby="assistant-titre">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-docuflow-secondary flex items-center justify-center"><Rocket size={20} /></div>
          <div>
            <h2 id="assistant-titre" className="text-base font-bold text-slate-800">Mettre en place votre service d'archives</h2>
            <p className="text-xs text-slate-500">{etat.faites} étape(s) sur {etat.total} · chaque étape se valide d'elle-même quand elle est faite</p>
          </div>
        </div>
        <button type="button" onClick={masquer} className="text-xs font-semibold text-slate-400 hover:text-slate-600">Masquer</button>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={pourcentage} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-docuflow-secondary transition-all" style={{ width: `${pourcentage}%` }} />
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-2">
        {etat.etapes.map((e, i) => {
          const courante = prochaine?.cle === e.cle;
          return (
            <li key={e.cle} className={`flex gap-3 p-3 rounded-xl border ${courante ? 'border-docuflow-secondary bg-blue-50/40' : 'border-slate-100'}`}>
              {e.fait
                ? <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" aria-label="Fait" />
                : <Circle size={18} className="text-slate-300 flex-shrink-0 mt-0.5" aria-label="À faire" />}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold ${e.fait ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-700'}`}>
                  {i + 1}. {e.titre}{e.facultatif && <span className="ml-1 text-[11px] font-medium text-slate-400 no-underline">(facultatif)</span>}
                </p>
                {!e.fait && <p className="text-xs text-slate-500 mt-0.5">{e.explication}</p>}
                {e.detail && <p className="text-[11px] text-slate-400 mt-0.5">{e.detail}</p>}
                {!e.fait && (
                  <Link to={e.lien} className="inline-flex items-center gap-1 mt-1.5 text-xs font-bold text-docuflow-secondary hover:underline">
                    {e.action} <ChevronRight size={12} />
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default AssistantDemarrage;
