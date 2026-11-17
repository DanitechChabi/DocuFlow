import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Settings2, ListChecks, Tags, Building2, CalendarDays, UserPlus, Mail, Database, Clock, Archive, Users, Plus, X, ArrowUp, ArrowDown, Loader2, Save, ArrowRight } from 'lucide-react';
import { settingsService } from '../../../services/settingsService';
import { sectionService } from '../../../services/sectionService';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, Chargement } from './elements';

// ============================================================================
// Réglages de l'AFGC : l'essentiel, sur une page, en mots simples — motifs,
// typologies, départements, jours fériés, inscription, courriels, M-Files,
// durée de prêt. Chaque carte s'enregistre seule. Le reste de la
// configuration de la plateforme ne s'affiche pas ici.
// ============================================================================

const liste = (v) => {
  try { const x = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(x) ? x.map((o) => (typeof o === 'string' ? o : o.value)).filter(Boolean) : []; } catch { return []; }
};
const vrai = (v) => v === true || v === 'true';

const Carte = ({ icone: Icone, titre, aide, children, onEnregistrer, envoi, modifie }) => (
  <section className="glass-card-premium rounded-3xl p-5 md:p-6 flex flex-col">
    <div className="flex items-start gap-3">
      <span className="w-10 h-10 rounded-xl bg-green-50 text-docuflow-secondary flex items-center justify-center flex-shrink-0"><Icone size={20} /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-black text-slate-900">{titre}</h2>
        {aide && <p className="text-sm text-slate-600">{aide}</p>}
      </div>
    </div>
    <div className="mt-4 flex-1">{children}</div>
    {onEnregistrer && (
      <div className="mt-4 flex items-center justify-end gap-3">
        {modifie && <span className="text-xs font-bold text-amber-700">modifications non enregistrées</span>}
        <button type="button" onClick={onEnregistrer} disabled={envoi || !modifie}
          className="px-4 py-2 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-40">
          {envoi ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Enregistrer
        </button>
      </div>
    )}
  </section>
);

/** Une liste de choix : ajouter, retirer, remonter, descendre. */
const EditeurListe = ({ valeurs, onChange, exemple }) => {
  const [nouveau, setNouveau] = useState('');
  const ajouter = () => { const v = nouveau.trim(); if (v && !valeurs.includes(v)) onChange([...valeurs, v]); setNouveau(''); };
  const bouger = (i, d) => { const c = [...valeurs]; [c[i], c[i + d]] = [c[i + d], c[i]]; onChange(c); };
  return (
    <div>
      <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {valeurs.map((v, i) => (
          <li key={v} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5">
            <span className="text-xs font-bold text-slate-400 w-5 text-right">{i + 1}</span>
            <span className="flex-1 text-sm font-semibold text-slate-800">{v}</span>
            <button type="button" onClick={() => bouger(i, -1)} disabled={i === 0} className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-25" aria-label={`Monter ${v}`}><ArrowUp size={14} /></button>
            <button type="button" onClick={() => bouger(i, 1)} disabled={i === valeurs.length - 1} className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-25" aria-label={`Descendre ${v}`}><ArrowDown size={14} /></button>
            <button type="button" onClick={() => onChange(valeurs.filter((x) => x !== v))} className="p-1 rounded text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label={`Retirer ${v}`}><X size={14} /></button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input value={nouveau} onChange={(e) => setNouveau(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouter(); } }} placeholder={exemple}
          className="flex-1 px-3 py-2 rounded-xl border-2 border-slate-200 text-sm focus:outline-none focus:border-docuflow-secondary" />
        <button type="button" onClick={ajouter} className="px-3 py-2 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-700 hover:border-docuflow-secondary inline-flex items-center gap-1"><Plus size={14} /> Ajouter</button>
      </div>
    </div>
  );
};

const Interrupteur = ({ coche, onChange, libelle, aide }) => (
  <label className="flex items-start gap-3 py-2 cursor-pointer">
    <button type="button" role="switch" aria-checked={coche} onClick={() => onChange(!coche)}
      className={`mt-0.5 w-11 h-6 rounded-full transition-colors flex-shrink-0 relative ${coche ? 'bg-docuflow-secondary' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${coche ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
    <span><span className="block text-sm font-bold text-slate-800">{libelle}</span>{aide && <span className="block text-xs text-slate-600">{aide}</span>}</span>
  </label>
);

const AdministrationAfgc = () => {
  useTitrePage('Réglages');
  const [initial, setInitial] = useState(null);
  const [v, setV] = useState(null);
  const [sections, setSections] = useState(null);
  const [nouvelleSection, setNouvelleSection] = useState('');
  const [envoi, setEnvoi] = useState(null);

  const charger = useCallback(async () => {
    const s = await settingsService.getSettings();
    const valeurs = {
      request_motifs: liste(s.request_motifs),
      request_document_types: liste(s.request_document_types),
      jours_feries: s.jours_feries || '',
      registration_email_domains: s.registration_email_domains || '',
      registration_new_department: vrai(s.registration_new_department),
      enable_email_notifications: vrai(s.enable_email_notifications),
      notify_archive_on_request: s.notify_archive_on_request === undefined ? true : vrai(s.notify_archive_on_request),
      notify_on_request_created: s.notify_on_request_created === undefined ? true : vrai(s.notify_on_request_created),
      notify_on_status_change: vrai(s.notify_on_status_change),
      mfiles_annees: s.mfiles_annees || '',
      mfiles_url: s.mfiles_url || '',
      loan_default_days: String(s.loan_default_days || '7'),
    };
    setInitial(valeurs);
    setV(valeurs);
  }, []);
  const chargerSections = useCallback(() => sectionService.getSections().then((l) => setSections(Array.isArray(l) ? l : [])).catch(() => setSections([])), []);
  useEffect(() => { charger().catch(() => toast.error('Réglages illisibles.')); chargerSections(); }, [charger, chargerSections]);

  const change = (cle) => (x) => setV((o) => ({ ...o, [cle]: x }));
  const modifie = (...cles) => v && initial && cles.some((c) => JSON.stringify(v[c]) !== JSON.stringify(initial[c]));
  const enregistrer = (carte, ...cles) => async () => {
    setEnvoi(carte);
    try {
      const corps = {};
      for (const c of cles) {
        corps[c] = Array.isArray(v[c]) ? JSON.stringify(v[c].map((x) => ({ value: x, label: x }))) : v[c];
      }
      await settingsService.updateSettings(corps);
      setInitial((o) => ({ ...o, ...Object.fromEntries(cles.map((c) => [c, v[c]])) }));
      toast.success('Enregistré.');
    } catch (e) {
      toast.error(e.response?.data?.message || 'L\'enregistrement a échoué.');
    } finally { setEnvoi(null); }
  };
  const ajouterSection = async () => {
    const nom = nouvelleSection.trim();
    if (!nom) return;
    try { await sectionService.createSection(nom); setNouvelleSection(''); chargerSections(); toast.success(`Département « ${nom} » ajouté.`); } catch (e) { toast.error(e.response?.data?.message || 'Ajout impossible.'); }
  };
  const retirerSection = async (s) => {
    try { await sectionService.deleteSection(s.id); chargerSections(); toast.success(`Département « ${s.name} » retiré.`); } catch (e) { toast.error(e.response?.data?.message || 'Retrait impossible : des agents y sont peut-être encore rattachés.'); }
  };

  const champ = 'w-full px-3 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-semibold focus:outline-none focus:border-docuflow-secondary';
  if (!v) return <div className="p-8"><Chargement /></div>;
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <EnTete titre="Réglages de l'AFGC" icone={Settings2} aide="L'essentiel de la configuration, en un endroit. Chaque carte s'enregistre séparément." />

      <div className="grid gap-3 sm:grid-cols-2 mb-5">
        <Link to="/admin/comptes" className="glass-card-premium rounded-2xl px-5 py-4 flex items-center gap-3 hover:ring-2 hover:ring-green-200">
          <Users size={20} className="text-docuflow-secondary" /><span className="font-black text-slate-900">Comptes des agents</span><span className="text-sm text-slate-600">rôles, départements, départs</span><ArrowRight size={16} className="ml-auto text-slate-400" />
        </Link>
        <Link to="/archives/entrees" className="glass-card-premium rounded-2xl px-5 py-4 flex items-center gap-3 hover:ring-2 hover:ring-green-200">
          <Archive size={20} className="text-violet-600" /><span className="font-black text-slate-900">Armoires</span><span className="text-sm text-slate-600">Entrée des dossiers › Rangement</span><ArrowRight size={16} className="ml-auto text-slate-400" />
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Carte icone={ListChecks} titre="Motifs de demande" aide="Ce que l'agent choisit en demandant un dossier, dans cet ordre."
          onEnregistrer={enregistrer('motifs', 'request_motifs')} envoi={envoi === 'motifs'} modifie={modifie('request_motifs')}>
          <EditeurListe valeurs={v.request_motifs} onChange={change('request_motifs')} exemple="Nouveau motif…" />
        </Carte>
        <Carte icone={Tags} titre="Typologies des dossiers" aide="Les types de dossiers (cautions, prêts, garanties…) ; le sigle entre parenthèses est reconnu dans la saisie."
          onEnregistrer={enregistrer('types', 'request_document_types')} envoi={envoi === 'types'} modifie={modifie('request_document_types')}>
          <EditeurListe valeurs={v.request_document_types} onChange={change('request_document_types')} exemple="ex. Caution de soumission (CS)" />
        </Carte>
        <Carte icone={Building2} titre="Départements" aide="Proposés à l'inscription et dans les comptes. Un département qui a encore des agents ne peut pas être retiré.">
          {sections === null ? <Chargement /> : (
            <>
              <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {sections.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5">
                    <span className="flex-1 text-sm font-semibold text-slate-800">{s.name}</span>
                    <button type="button" onClick={() => retirerSection(s)} className="p-1 rounded text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label={`Retirer ${s.name}`}><X size={14} /></button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <input value={nouvelleSection} onChange={(e) => setNouvelleSection(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterSection(); } }}
                  placeholder="ex. DSI — Systèmes d'information" className={champ} />
                <button type="button" onClick={ajouterSection} className="px-3 py-2 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-700 hover:border-docuflow-secondary inline-flex items-center gap-1"><Plus size={14} /> Ajouter</button>
              </div>
            </>
          )}
        </Carte>
        <div className="space-y-5">
          <Carte icone={Database} titre="Dossiers numérisés (M-Files)" aide="Pour les dossiers de ces années, l'archive envoie la copie depuis M-Files au lieu de sortir le papier."
            onEnregistrer={enregistrer('mfiles', 'mfiles_annees', 'mfiles_url')} envoi={envoi === 'mfiles'} modifie={modifie('mfiles_annees', 'mfiles_url')}>
            <label className="block text-sm font-bold text-slate-700">Années numérisées
              <input value={v.mfiles_annees} onChange={(e) => change('mfiles_annees')(e.target.value)} placeholder="ex. 2025" className={`mt-1 ${champ}`} />
            </label>
            <label className="block mt-3 text-sm font-bold text-slate-700">Adresse de M-Files Web <span className="font-semibold text-slate-500">(facultatif)</span>
              <input value={v.mfiles_url} onChange={(e) => change('mfiles_url')(e.target.value)} placeholder="https://mfiles.afgcsa.com" className={`mt-1 ${champ}`} />
            </label>
          </Carte>
          <Carte icone={Clock} titre="Durée de prêt" aide="Nombre de jours avant le retour prévu d'un dossier sorti."
            onEnregistrer={enregistrer('pret', 'loan_default_days')} envoi={envoi === 'pret'} modifie={modifie('loan_default_days')}>
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={90} value={v.loan_default_days} onChange={(e) => change('loan_default_days')(e.target.value)} className={`${champ} w-28`} />
              <span className="text-sm font-semibold text-slate-700">jours</span>
            </div>
          </Carte>
        </div>
        <Carte icone={CalendarDays} titre="Jours fériés" aide="Sans production aux archives : dates fixes (MM-JJ) ou datées (AAAA-MM-JJ), séparées par des virgules. Pâques, Ascension et Pentecôte sont comptés d'office ; ajoutez Tabaski, Ramadan, Maouloud à leur date."
          onEnregistrer={enregistrer('feries', 'jours_feries')} envoi={envoi === 'feries'} modifie={modifie('jours_feries')}>
          <textarea rows={3} value={v.jours_feries} onChange={(e) => change('jours_feries')(e.target.value)} className={champ} />
        </Carte>
        <Carte icone={UserPlus} titre="Inscription des agents" aide="Qui peut créer son compte."
          onEnregistrer={enregistrer('inscription', 'registration_email_domains', 'registration_new_department')} envoi={envoi === 'inscription'} modifie={modifie('registration_email_domains', 'registration_new_department')}>
          <label className="block text-sm font-bold text-slate-700">Adresses admises
            <input value={v.registration_email_domains} onChange={(e) => change('registration_email_domains')(e.target.value)} placeholder="afgcsa.com" className={`mt-1 ${champ}`} />
          </label>
          <Interrupteur coche={v.registration_new_department} onChange={change('registration_new_department')} libelle="Un agent peut créer son département" aide="S'il ne figure pas dans la liste." />
        </Carte>
        <Carte icone={Mail} titre="Courriels (Outlook)" aide="Ce que l'application envoie par courriel. La cloche reste toujours active."
          onEnregistrer={enregistrer('courriels', 'enable_email_notifications', 'notify_archive_on_request', 'notify_on_request_created', 'notify_on_status_change')}
          envoi={envoi === 'courriels'} modifie={modifie('enable_email_notifications', 'notify_archive_on_request', 'notify_on_request_created', 'notify_on_status_change')}>
          <Interrupteur coche={v.enable_email_notifications} onChange={change('enable_email_notifications')} libelle="Envoyer des courriels" aide="Coupe tous les courriels d'un coup." />
          <div className={v.enable_email_notifications ? '' : 'opacity-40 pointer-events-none'}>
            <Interrupteur coche={v.notify_archive_on_request} onChange={change('notify_archive_on_request')} libelle="À l'archive, pour chaque demande" aide="Nouvelle demande, nouvelle liste, demande complétée." />
            <Interrupteur coche={v.notify_on_request_created} onChange={change('notify_on_request_created')} libelle="Accusé de réception au demandeur" />
            <Interrupteur coche={v.notify_on_status_change} onChange={change('notify_on_status_change')} libelle="Au demandeur, à chaque étape" aide="Transmis, retourné, compléments, retards, copie M-Files." />
          </div>
        </Carte>
      </div>
    </div>
  );
};

export default AdministrationAfgc;
