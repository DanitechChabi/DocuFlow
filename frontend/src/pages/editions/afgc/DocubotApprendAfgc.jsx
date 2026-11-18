import React, { useState, useEffect, useCallback } from 'react';
import { GraduationCap, Check, X } from 'lucide-react';
import api from '../../../services/api';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, Chargement } from './elements';

// ============================================================================
// « DocuBot apprend » (056) : les questions que DocuBot a mal comprises, ou
// sans assurance. L'archive dit ce qu'elles voulaient dire : DocuBot se
// réentraîne aussitôt. L'auteur d'une question n'est jamais montré.
// ============================================================================

const COMPRIS = {
  ou_est: 'Trouver un dossier', demander: 'Trouver un dossier', qui_a: 'Qui a un dossier', mes_demandes: 'Ses demandes', retards: 'Retards',
  journee: 'Travail du jour', chiffres: 'Chiffres', semaine: 'Entrées d\'une semaine', aide: 'Comment faire', salut: 'Bonjour', merci: 'Merci',
  hors_sujet: 'Hors sujet', inconnu: 'Rien compris', raisonnement: 'Raisonnement',
};

const Chiffre = ({ valeur, libelle }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
    <div className="text-2xl font-bold text-slate-900 tabular-nums">{valeur}</div>
    <div className="text-xs text-slate-500">{libelle}</div>
  </div>
);

const DocubotApprendAfgc = () => {
  useTitrePage('DocuBot apprend');
  const [donnees, setDonnees] = useState(null);
  const [choix, setChoix] = useState({});
  const [envoi, setEnvoi] = useState(null);

  const charger = useCallback(() => api.get('/ia/docubot/apprentissage').then((r) => setDonnees(r.data))
    .catch(() => { toast.error('Lecture impossible.'); setDonnees({ questions: [], bilan: {}, modele: {}, choix: {} }); }), []);
  useEffect(() => { charger(); }, [charger]);

  const valider = async (q, intention) => {
    if (!intention) { toast.error('Choisissez ce que la question voulait dire.'); return; }
    setEnvoi(q.id);
    try {
      await api.post(`/ia/docubot/echanges/${q.id}/correction`, { intention });
      setDonnees((d) => ({ ...d, questions: d.questions.filter((x) => x.id !== q.id) }));
      if (intention !== 'ignorer') toast.success('Appris : DocuBot comprendra mieux ce genre de question.');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Enregistrement impossible.');
    } finally { setEnvoi(null); }
  };

  if (!donnees) return <div className="p-8"><Chargement /></div>;
  const b = donnees.bilan || {};
  const avis = (b.utiles || 0) + (b.pas_utiles || 0);
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <EnTete titre="DocuBot apprend" icone={GraduationCap}
        aide="Chaque question posée à DocuBot l'entraîne. Ici, les questions qu'il a mal comprises : dites ce qu'elles voulaient dire, il s'en souviendra." />

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-6">
        <Chiffre valeur={b.questions ?? 0} libelle="questions sur 30 jours" />
        <Chiffre valeur={avis ? `${Math.round((100 * (b.utiles || 0)) / avis)} %` : '—'} libelle={`réponses jugées utiles (${avis} avis)`} />
        <Chiffre valeur={b.corrigees ?? 0} libelle="corrections sur 30 jours" />
        <Chiffre valeur={(donnees.modele?.exemples_base || 0) + (donnees.modele?.exemples_usage || 0)} libelle={`exemples appris, dont ${donnees.modele?.exemples_usage || 0} de l'usage`} />
      </div>

      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-900">
          À revoir {donnees.questions.length ? `(${donnees.questions.length})` : ''}
        </h2>
        {donnees.questions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">Rien à revoir : DocuBot a compris les questions récentes.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {donnees.questions.map((q) => (
              <li key={q.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-72">
                  <div className="text-sm font-semibold text-slate-900">« {q.question} »</div>
                  <div className="text-xs text-slate-500">
                    {q.le} · compris : {COMPRIS[q.intention] || q.intention || '—'}
                    {q.utile === false && <span className="text-red-600"> · jugé « pas ça »</span>}
                    {q.confiance !== null && q.confiance < 0.6 && q.utile !== false && <span> · peu sûr</span>}
                  </div>
                </div>
                <select value={choix[q.id] || ''} onChange={(e) => setChoix((c) => ({ ...c, [q.id]: e.target.value }))}
                  className="px-2 py-1.5 rounded-md border border-slate-300 text-sm bg-white">
                  <option value="">Elle voulait…</option>
                  {Object.entries(donnees.choix || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button type="button" disabled={envoi === q.id} onClick={() => valider(q, choix[q.id])}
                  className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-sm font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                  <Check size={14} /> Apprendre
                </button>
                <button type="button" disabled={envoi === q.id} onClick={() => valider(q, 'ignorer')} title="Ne pas en tenir compte"
                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100" aria-label="Ignorer"><X size={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default DocubotApprendAfgc;
