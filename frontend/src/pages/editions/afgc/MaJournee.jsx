import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Send, MessageSquareWarning, AlertTriangle, Database, Users, Settings2, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';
import { entreeService } from '../../../services/entreeService';
import { Presence } from './presence';
import { useMfiles, estNumerise } from './mfiles';
import { etatDemande } from './vocabulaire';

// ============================================================================
// « Ma journée » : en arrivant, l'archiviste voit ce qui l'attend — à
// transmettre (dont ce qui part par M-Files), à revoir (demandes complétées),
// en attente de compléments, en retard — et retrouve un dossier d'une seule
// recherche (semaine, date du point, lettre, armoire, numérisé ou non).
// L'administrateur a en plus ses deux raccourcis : comptes et réglages.
// ============================================================================

const Tache = ({ to, icone: Icone, nombre, titre, detail, ton }) => {
  const tons = {
    vert: 'text-[#2C9C0A]', bleu: 'text-slate-600', ambre: 'text-amber-600', rouge: 'text-red-600', gris: 'text-slate-500',
  };
  return (
    <Link to={to} className="group rounded-lg border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-slate-400">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Icone size={16} className={tons[ton] || tons.gris} /> {titre}<ArrowRight size={14} className="ml-auto opacity-40 group-hover:opacity-100" /></div>
      <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{nombre}</div>
      {detail && <div className="text-xs text-slate-500">{detail}</div>}
    </Link>
  );
};

const MaJournee = ({ demandes, enRetard, admin, configure }) => {
  const navigate = useNavigate();
  const mf = useMfiles();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [cours, setCours] = useState(false);
  const liste = (demandes || []).filter((d) => !d.lot_id);
  const aTransmettre = liste.filter((d) => etatDemande(d).cle === 'demande');
  const parMfiles = aTransmettre.filter((d) => estNumerise(d, null, mf.annees)).length;
  const completees = aTransmettre.filter((d) => d.complement_fourni_at).length;
  const aCompleter = (demandes || []).filter((d) => d.statut === 'a completer').length;

  const chercher = async (e) => {
    e.preventDefault();
    const s = q.trim();
    if (s.length < 2) return;
    setCours(true);
    const acte = /^(?:(?:19|20)\d{2}\s*\/\s*)?\d+$/.test(s);
    try {
      setRes({ saisie: s, r: await entreeService.presence(acte ? { num_acte: s } : { nom_entreprise: s }) });
    } catch { setRes({ saisie: s, r: { recherche: true, total: 0, entrees: [] } }); } finally { setCours(false); }
  };
  const premiere = res?.r?.entrees?.[0];

  return (
    <section className="glass-card-premium rounded-xl p-5 md:p-6 mb-6 animate-fade-in-up">
      <h2 className="text-lg font-bold text-slate-900 mb-3">Ma journée</h2>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tache to="/demandes/a-traiter" icone={Send} ton="vert" nombre={demandes === null ? '…' : aTransmettre.length} titre="À transmettre"
          detail={parMfiles ? `dont ${parMfiles} par M-Files` : 'demandes en attente'} />
        <Tache to="/demandes/a-traiter" icone={CheckCircle2} ton="bleu" nombre={demandes === null ? '…' : completees} titre="Complétées" detail="renvoyées par les agents, à revoir" />
        <Tache to="/demandes/a-traiter" icone={MessageSquareWarning} ton="ambre" nombre={demandes === null ? '…' : aCompleter} titre="Chez les agents" detail="attendent leurs compléments" />
        <Tache to="/demandes/prets" icone={AlertTriangle} ton={enRetard ? 'rouge' : 'gris'} nombre={enRetard} titre="En retard" detail="dossiers à récupérer" />
      </div>

      <form onSubmit={chercher} className="mt-4 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Où est ce dossier ? Nom de l'entreprise ou n° d'acte (2025/2479)"
            className="w-full pl-11 pr-3 py-3 rounded-lg border border-slate-200 text-base font-semibold focus:outline-none focus:border-docuflow-secondary" />
        </div>
        <button type="submit" disabled={cours || q.trim().length < 2} className="px-5 py-3 rounded-lg bg-docuflow-secondary text-white font-bold inline-flex items-center gap-2 disabled:opacity-50">
          {cours ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />} Chercher
        </button>
      </form>
      {res && (
        <div className="mt-3">
          <Presence resultat={res.r} archiviste />
          {premiere && (
            <div className="mt-2 flex flex-wrap gap-2">
              {mf.annees.includes(Number(premiere.date_point.slice(0, 4))) && (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-50 border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-800"><Database size={14} /> Numérisé dans M-Files</span>
              )}
              <button type="button" onClick={() => navigate('/archives/entrees')} className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:border-docuflow-secondary">Entrée des dossiers ›</button>
            </div>
          )}
        </div>
      )}

      {(admin || configure) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {admin && <Link to="/admin/comptes" className="px-4 py-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-800 inline-flex items-center gap-2 hover:bg-slate-200"><Users size={15} /> Comptes des agents</Link>}
          {configure && <Link to="/admin/reglages" className="px-4 py-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-800 inline-flex items-center gap-2 hover:bg-slate-200"><Settings2 size={15} /> Réglages de l'AFGC</Link>}
        </div>
      )}
    </section>
  );
};

export default MaJournee;
