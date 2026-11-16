import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ClipboardList, ListChecks, FileSearch, Search, Send, Undo2, Loader2, ChevronRight, FileSpreadsheet, Phone, Mail } from 'lucide-react';
import BoiteDemande from './BoiteDemande';
import { exporterListe } from './exportListe';
import { requestService } from '../../../services/requestService';
import { listeService } from '../../../services/listeService';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, ChoixCadre, Pastille, Chargement, Avancement } from './elements';
import { etatDemande, etatDossierListe, intitule, references, dateCourte } from './vocabulaire';
import { parDepartement } from './departements';
import { Presence, usePresences } from './presence';
import SupprimerListe from './SupprimerListe';
import { ModaleComplement, EchangeComplement, BoutonComplement } from './complements';

// ============================================================================
// À traiter (archive) : chaque dossier se TRANSMET d'un clic, et son RETOUR se
// note d'un clic. Les listes (soldes créditeurs…) se traitent en entier ou
// par sélection. La date de retour proposée est celle réglée pour
// l'organisation (sept jours par défaut).
//
// Les demandes qui arrivent autrement — un appel, un courrier du Suivi (DE)
// pour des restitutions de provision ou des soldes créditeurs — s'enregistrent
// ici au nom de l'agent : un courrier devient une liste qui porte sa
// référence, retrouvable dans le registre des sorties.
// ============================================================================

const aujourdhuiCourt = () => new Date().toLocaleDateString('fr-FR');

const correspond = (d, q) => !q || [d.nom_entreprise, d.num_dossier, d.num_acte, d.description, d.requester_name, d.libelle, d.demandeur_name]
  .some((x) => x && String(x).toLowerCase().includes(q.toLowerCase()));

const message = (e, defaut) => e.response?.data?.message || defaut;

/**
 * Typologie d'une demande arrivée sans elle : l'archiviste la précise en
 * sortant le dossier (elle fait partie de l'intitulé).
 */
const PreciserTypologie = ({ d, typologies, onChoix, desactive }) => (d.type_document || !typologies.length ? null : (
  <select value="" onChange={(e) => e.target.value && onChoix(d, e.target.value)} disabled={desactive} aria-label={`Typologie de ${intitule(d)}`}
    className="px-2.5 py-1.5 rounded-xl border border-dashed border-amber-300 bg-amber-50 text-xs font-bold text-amber-800 max-w-[170px] cursor-pointer disabled:opacity-60">
    <option value="">Typologie ?</option>
    {typologies.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
  </select>
));

/** Une demande dans la file : intitulé, références, motif, demandeur. */
const Ligne = ({ d, presence, children }) => (
  <li className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
    <div className="min-w-0 flex-1 basis-64">
      <div className="text-sm font-semibold text-slate-800 line-clamp-2">{intitule(d)}</div>
      <div className="text-xs text-slate-400 truncate">{[references(d), d.motif, d.requester_name && `pour ${d.requester_name}`].filter(Boolean).join(' · ')}</div>
      {/* Où le chercher : semaine de production, date du point, lettre. */}
      <Presence resultat={presence} archiviste className="mt-2" />
      <EchangeComplement d={d} />
    </div>
    {/* Les gestes restent groupés, à droite, même quand ils passent à la ligne. */}
    <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">{children}</div>
  </li>
);

const TraitementAfgc = () => {
  useTitrePage('À traiter');
  const [onglet, setOnglet] = useState('demandes');
  const [demandes, setDemandes] = useState(null);
  const [listes, setListes] = useState(null);
  const [cadres, setCadres] = useState([]);
  const [cadre, setCadre] = useState('');
  const [q, setQ] = useState('');
  const [geste, setGeste] = useState(null);
  const [ouverte, setOuverte] = useState(null);
  const [coches, setCoches] = useState(new Set());
  // Demande reçue par téléphone ou par courrier : pour qui, la référence du
  // courrier, et faut-il transmettre aussitôt.
  const [demandeurs, setDemandeurs] = useState([]);
  const [canal, setCanal] = useState('telephone');
  const [agentTel, setAgentTel] = useState('');
  const [refCourrier, setRefCourrier] = useState('');
  const [transmettreTel, setTransmettreTel] = useState(true);
  const [typologies, setTypologies] = useState([]);
  // Demande renvoyée au demandeur faute d'informations (051).
  const [aRenvoyer, setARenvoyer] = useState(null);

  const charger = useCallback(() => {
    requestService.getAllRequests().then((l) => setDemandes(Array.isArray(l) ? l : [])).catch(() => setDemandes([]));
    listeService.lister().then(setListes).catch(() => setListes([]));
  }, []);

  useEffect(() => {
    charger();
    listeService.cadres().then(setCadres).catch(() => setCadres([]));
    listeService.demandeurs().then(setDemandeurs).catch(() => setDemandeurs([]));
    requestService.getOptions().then((o) => setTypologies(o?.documentTypes || [])).catch(() => setTypologies([]));
  }, [charger]);

  const seules = useMemo(() => (demandes || []).filter((d) => !d.lot_id && (!cadre || d.motif === cadre) && correspond(d, q)), [demandes, cadre, q]);
  const aTransmettre = seules.filter((d) => etatDemande(d).cle === 'demande').sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  // Pour chaque dossier à sortir : semaine et date du point où il est entré.
  const presences = usePresences(aTransmettre);
  const enAttenteComplements = seules.filter((d) => etatDemande(d).cle === 'a_completer');
  const sortis = seules.filter((d) => etatDemande(d).cle === 'transmis').sort((a, b) => String(a.loan_retour_prevu).localeCompare(String(b.loan_retour_prevu)));
  const listesVues = (listes || []).filter((l) => (!cadre || l.cadre === cadre) && correspond(l, q));
  const listesOuvertes = listesVues.filter((l) => l.a_transmettre + l.transmis > 0);

  const transmettre = async (d) => {
    setGeste(`t-${d.id}`);
    try {
      await requestService.remettreDossier(d.id, {});
      toast.success(`Transmis : ${intitule(d)}${d.requester_name ? ` à ${d.requester_name}` : ''}.`);
      charger();
    } catch (e) { toast.error(message(e, 'Transmission impossible.')); } finally { setGeste(null); }
  };

  const retourne = async (d) => {
    setGeste(`r-${d.id}`);
    try {
      await requestService.retournerDossier(d.id, {});
      toast.success(`Retourné : ${intitule(d)}.`);
      charger();
    } catch (e) { toast.error(message(e, 'Retour impossible.')); } finally { setGeste(null); }
  };

  const preciser = async (d, valeur) => {
    setGeste(`y-${d.id}`);
    try {
      await listeService.typologie(d.id, valeur);
      toast.success(`Typologie précisée : ${intitule({ ...d, type_document: valeur })}.`);
      if (ouverte?.dossiers?.some((x) => x.id === d.id)) setOuverte(await listeService.detail(ouverte.id));
      charger();
    } catch (e) { toast.error(message(e, 'La typologie n\'a pas pu être enregistrée.')); } finally { setGeste(null); }
  };

  const ouvrir = async (id) => {
    if (ouverte?.id === id) { setOuverte(null); return; }
    setCoches(new Set());
    setOuverte({ id, chargement: true });
    try { setOuverte(await listeService.detail(id)); } catch { setOuverte(null); toast.error('Cette liste n\'a pas pu être ouverte.'); }
  };

  const gesteListe = async (type, tous) => {
    const ids = tous ? undefined : [...coches];
    setGeste(`${type}-liste`);
    try {
      const r = type === 't'
        ? await listeService.transmettre(ouverte.id, { ids })
        : await listeService.retourner(ouverte.id, { ids });
      toast.success(type === 't' ? `${r.transmis} dossier${r.transmis > 1 ? 's' : ''} transmis.` : `${r.retournes} dossier${r.retournes > 1 ? 's' : ''} retourné${r.retournes > 1 ? 's' : ''}.`);
      setOuverte(r.liste); setCoches(new Set());
      charger();
    } catch (e) { toast.error(message(e, 'Opération impossible.')); } finally { setGeste(null); }
  };

  const agent = demandeurs.find((a) => String(a.id) === String(agentTel));
  const groupesAgents = useMemo(() => parDepartement(demandeurs), [demandeurs]);
  const parCourrier = canal === 'courrier';

  // Plusieurs dossiers à la fois (un courrier, ou une liste dictée) : une
  // liste au nom de l'agent, transmise dans la foulée si on le demande.
  const enregistrerListe = async (corps) => {
    const ref = refCourrier.trim();
    const libelle = parCourrier
      ? (ref ? `Courrier ${/^n[°o]/i.test(ref) ? ref : `n° ${ref}`}` : `Courrier du ${aujourdhuiCourt()}`)
      : `Demande par téléphone du ${aujourdhuiCourt()}`;
    const liste = await listeService.creer({ ...corps, libelle, demandeur_id: Number(agentTel) });
    if (parCourrier) setRefCourrier('');
    if (!transmettreTel) return liste;
    try {
      return (await listeService.transmettre(liste.id)).liste;
    } catch (e) {
      toast.error(message(e, 'Liste enregistrée, mais la transmission a échoué : transmettez-la depuis l\'onglet « Listes ».'));
      return liste;
    }
  };

  const presencesListe = usePresences(useMemo(() => (ouverte?.dossiers || []).filter((d) => d.etat === 'demande'), [ouverte]));
  const basculer = (id) => setCoches((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const cochesEtat = (etat) => (ouverte?.dossiers || []).filter((d) => coches.has(d.id) && d.etat === etat).length;
  const compte = (etat) => (ouverte?.dossiers || []).filter((d) => d.etat === etat).length;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <EnTete titre="À traiter" icone={ClipboardList} aide="Transmettez un dossier d'un clic ; à son retour, un clic sur « Retourné »." />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex p-1 rounded-2xl bg-slate-100">
          {[['demandes', 'Demandes', FileSearch, aTransmettre.length], ['listes', 'Listes', ListChecks, listesOuvertes.length]].map(([cle, label, Icone, n]) => (
            <button key={cle} type="button" onClick={() => setOnglet(cle)}
              className={`px-4 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 transition-colors ${onglet === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <Icone size={15} /> {label} {n > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-docuflow-secondary text-white text-[11px] inline-flex items-center justify-center">{n}</span>}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Entreprise, n° de dossier, agent, liste…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-docuflow-secondary" aria-label="Rechercher" />
        </div>
      </div>
      {cadres.length > 1 && <div className="mb-5"><ChoixCadre cadres={cadres} valeur={cadre} onChange={setCadre} tous /></div>}

      {onglet === 'demandes' ? (
        demandes === null ? <Chargement /> : (<>
          {/* On appelle encore l'archive, on lui écrit : la demande s'inscrit quand même au registre. */}
          <section className="glass-card-premium rounded-3xl p-5 md:p-6 mb-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
              <h2 className="font-bold text-slate-900">Demande reçue par</h2>
              <div className="inline-flex p-1 rounded-xl bg-slate-100" role="radiogroup" aria-label="Demande reçue par">
                {[['telephone', 'Téléphone', Phone], ['courrier', 'Courrier', Mail]].map(([cle, label, Icone]) => (
                  <button key={cle} type="button" role="radio" aria-checked={canal === cle} onClick={() => setCanal(cle)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold inline-flex items-center gap-1.5 transition-colors ${canal === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Icone size={14} className={canal === cle ? 'text-docuflow-secondary' : ''} /> {label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-400">
                {parCourrier ? 'les dossiers du courrier, enregistrés au nom de l\'agent ; la référence du courrier permet de les retrouver' : 'enregistrée au nom de l\'agent, qui la retrouve dans « Mes dossiers »'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <select value={agentTel} onChange={(e) => setAgentTel(e.target.value)} aria-label="Agent qui demande"
                className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white text-slate-700 min-w-[240px]">
                <option value="">Qui demande ?</option>
                {groupesAgents.map(([departement, agents]) => (
                  <optgroup key={departement} label={departement}>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                  </optgroup>
                ))}
              </select>
              {parCourrier && (
                <input value={refCourrier} onChange={(e) => setRefCourrier(e.target.value)} maxLength={80}
                  placeholder="Réf. du courrier (facultatif)" aria-label="Référence du courrier"
                  className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 w-56 focus:outline-none focus:border-docuflow-secondary" />
              )}
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 cursor-pointer">
                <input type="checkbox" checked={transmettreTel} onChange={(e) => setTransmettreTel(e.target.checked)} className="w-4 h-4 accent-[var(--color-docuflow-secondary)]" />
                Transmettre tout de suite
              </label>
            </div>
            <BoiteDemande
              key={canal}
              cumuler={parCourrier}
              annulable={false}
              retenir={false}
              departement={agent?.section || ''}
              desactive={!agentTel}
              libelleBouton={transmettreTel ? 'Enregistrer et transmettre' : 'Enregistrer'}
              envoyerUn={(corps) => listeService.pourAgent({ ...corps, pour_user_id: Number(agentTel), transmettre: transmettreTel })}
              envoyerListe={enregistrerListe}
              messageEnvoye={(texte) => {
                const nom = agent?.full_name || 'l\'agent';
                return transmettreTel ? `Transmis à ${nom} : ${texte}.` : `Enregistré pour ${nom} : ${texte}.`;
              }}
              onEnvoye={charger}
            />
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="glass-card-premium rounded-3xl p-5 md:p-6">
              <h2 className="font-bold text-slate-900 mb-2">À transmettre <span className="text-slate-400 font-semibold">({aTransmettre.length})</span></h2>
              {aTransmettre.length ? (
                <ul className="divide-y divide-slate-100">
                  {aTransmettre.map((d) => (
                    <Ligne key={d.id} d={d} presence={presences[d.id]}>
                      <PreciserTypologie d={d} typologies={typologies} onChoix={preciser} desactive={Boolean(geste)} />
                      <span className="text-xs text-slate-400">demandé le {dateCourte(d.created_at)}</span>
                      <BoutonComplement onClick={() => setARenvoyer(d)} desactive={Boolean(geste)} />
                      <button type="button" onClick={() => transmettre(d)} disabled={Boolean(geste)}
                        className="px-3.5 py-2 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-60">
                        {geste === `t-${d.id}` ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Transmettre
                      </button>
                    </Ligne>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-400 py-2">Aucune demande en attente.</p>}
            </section>
            <section className="glass-card-premium rounded-3xl p-5 md:p-6">
              <h2 className="font-bold text-slate-900 mb-2">Transmis <span className="text-slate-400 font-semibold">({sortis.length})</span></h2>
              {sortis.length ? (
                <ul className="divide-y divide-slate-100">
                  {sortis.map((d) => {
                    const etat = etatDemande(d);
                    return (
                      <Ligne key={d.id} d={d}>
                        <PreciserTypologie d={d} typologies={typologies} onChoix={preciser} desactive={Boolean(geste)} />
                        <Pastille ton={etat.ton}>retour {dateCourte(d.loan_retour_prevu)}</Pastille>
                        <button type="button" onClick={() => retourne(d)} disabled={Boolean(geste)}
                          className="px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:border-docuflow-secondary hover:text-docuflow-secondary inline-flex items-center gap-1.5 disabled:opacity-60">
                          {geste === `r-${d.id}` ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Retourné
                        </button>
                      </Ligne>
                    );
                  })}
                </ul>
              ) : <p className="text-sm text-slate-400 py-2">Aucun dossier sorti.</p>}
            </section>
          </div>
          {enAttenteComplements.length > 0 && (
            <section className="glass-card-premium rounded-3xl p-5 md:p-6 mt-6 border-2 border-amber-200">
              <h2 className="font-bold text-slate-900 mb-1">Attendent des compléments <span className="text-amber-600 font-semibold">({enAttenteComplements.length})</span></h2>
              <p className="text-sm text-slate-600 mb-2">Renvoyées à leur auteur ; elles reviennent dans « À transmettre » dès qu'il les a complétées.</p>
              <ul className="divide-y divide-slate-100">
                {enAttenteComplements.map((d) => <Ligne key={d.id} d={d}><Pastille ton="rouge">À compléter</Pastille></Ligne>)}
              </ul>
            </section>
          )}
        </>)
      ) : (
        listes === null ? <Chargement /> : listesVues.length ? (
          <div className="space-y-3">
            {listesVues.map((l) => (
              <div key={l.id} className="glass-card-premium rounded-3xl overflow-hidden">
                <button type="button" onClick={() => ouvrir(l.id)} className="w-full text-left p-5 flex flex-wrap items-center gap-4 hover:bg-slate-50/60 transition-colors">
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="font-black text-slate-900">{l.libelle} <span className="text-slate-400 font-semibold">· {l.total} dossier{l.total > 1 ? 's' : ''}</span></div>
                    <div className="text-xs text-slate-400">{l.cadre} · pour {l.demandeur_name || '—'} · déposée le {dateCourte(l.created_at)}</div>
                    <div className="mt-2 max-w-md"><Avancement total={l.total} transmis={l.transmis} retournes={l.retournes} /></div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {l.a_transmettre > 0 && <Pastille ton="ambre">{l.a_transmettre} à transmettre</Pastille>}
                    {l.a_completer > 0 && <Pastille ton="rouge">{l.a_completer} à compléter</Pastille>}
                    {l.transmis > 0 && <Pastille ton="vert">{l.transmis} transmis</Pastille>}
                    {l.retournes > 0 && <Pastille ton="gris">{l.retournes} retourné{l.retournes > 1 ? 's' : ''}</Pastille>}
                    {l.en_retard > 0 && <Pastille ton="rouge">{l.en_retard} en retard</Pastille>}
                  </div>
                  <ChevronRight size={18} className={`text-slate-300 transition-transform ${ouverte?.id === l.id ? 'rotate-90' : ''}`} />
                </button>
                {ouverte?.id === l.id && (
                  <div className="px-5 pb-5">
                    {ouverte.chargement ? <Chargement /> : (
                      <>
                        <div className="flex flex-wrap items-center gap-2 py-3 border-t border-slate-100">
                          <button type="button" onClick={() => gesteListe('t', coches.size === 0)}
                            disabled={Boolean(geste) || !(coches.size ? cochesEtat('demande') : compte('demande'))}
                            className="px-3.5 py-2 rounded-xl bg-docuflow-secondary text-white text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-40">
                            {geste === 't-liste' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            {coches.size ? `Transmettre la sélection (${cochesEtat('demande')})` : `Tout transmettre (${compte('demande')})`}
                          </button>
                          <button type="button" onClick={() => gesteListe('r', coches.size === 0)}
                            disabled={Boolean(geste) || !(coches.size ? cochesEtat('transmis') : compte('transmis'))}
                            className="px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:border-docuflow-secondary inline-flex items-center gap-1.5 disabled:opacity-40">
                            {geste === 'r-liste' ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                            {coches.size ? `Retourné (${cochesEtat('transmis')})` : `Tout retourné (${compte('transmis')})`}
                          </button>
                          {coches.size > 0 && <button type="button" onClick={() => setCoches(new Set())} className="px-3 py-2 text-sm font-bold text-slate-400 hover:text-slate-600">Décocher</button>}
                          <span className="ml-auto"><SupprimerListe liste={ouverte} onFait={() => { setOuverte(null); charger(); }} /></span>
                          <button type="button" onClick={() => exporterListe(ouverte).catch(() => toast.error('L\'export Excel a échoué.'))}
                            className="px-3.5 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1.5">
                            <FileSpreadsheet size={14} /> Exporter (Excel)
                          </button>
                        </div>
                        <ul className="divide-y divide-slate-100">
                          {ouverte.dossiers.map((d) => {
                            const etat = etatDossierListe(d);
                            const cochable = d.etat === 'demande' || d.etat === 'transmis';
                            return (
                              <li key={d.id} className="py-2.5 flex items-center gap-3">
                                <input type="checkbox" disabled={!cochable} checked={coches.has(d.id)} onChange={() => basculer(d.id)}
                                  className="w-4 h-4 accent-[var(--color-docuflow-secondary)]" aria-label={`Sélectionner ${intitule(d)}`} />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold text-slate-800 line-clamp-2">{intitule(d)}</div>
                                  <div className="text-xs text-slate-400 truncate">{references(d) || d.description || 'Sans référence'}</div>
                                  {d.etat === 'demande' && <Presence resultat={presencesListe[d.id]} archiviste className="mt-2" />}
                                  <EchangeComplement d={d} />
                                </div>
                                {d.etat === 'demande' && <BoutonComplement onClick={() => setARenvoyer({ ...d, requester_name: ouverte.demandeur_name })} desactive={Boolean(geste)} />}
                                {(d.etat === 'demande' || d.etat === 'transmis') && (
                                  <PreciserTypologie d={d} typologies={typologies} onChoix={preciser} desactive={Boolean(geste)} />
                                )}
                                {d.etat === 'transmis' && d.date_retour_prevue && <span className="text-xs text-slate-500 hidden sm:inline">retour {dateCourte(d.date_retour_prevue)}</span>}
                                <Pastille ton={etat.ton}>{etat.texte}</Pastille>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <div className="glass-card-premium rounded-3xl p-8 text-center text-sm text-slate-500">Aucune liste.</div>
      )}
      {aRenvoyer && (
        <ModaleComplement dossier={aRenvoyer} onClose={() => setARenvoyer(null)}
          onFait={async () => { charger(); if (ouverte?.id) setOuverte(await listeService.detail(ouverte.id)); }} />
      )}
    </div>
  );
};

export default TraitementAfgc;
