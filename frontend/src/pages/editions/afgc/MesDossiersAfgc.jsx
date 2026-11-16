import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FileSearch, ListChecks, Search, ChevronRight, X, Loader2, PlusCircle, FileSpreadsheet } from 'lucide-react';
import { exporterListe } from './exportListe';
import { requestService } from '../../../services/requestService';
import { listeService } from '../../../services/listeService';
import { toast } from '../../../components/Toast';
import { useTitrePage } from '../../../hooks/useTitrePage';
import { EnTete, ChoixCadre, Pastille, Chargement, Avancement } from './elements';
import { etatDemande, etatDossierListe, intitule, references, dateCourte } from './vocabulaire';

// ============================================================================
// Mes dossiers : où en est chacune de mes demandes — Demandé, Transmis,
// Retourné — et l'avancement de mes listes (soldes créditeurs…). On y
// retrouve tout par cadre ou par entreprise.
// ============================================================================

const correspond = (d, q) => !q || [d.nom_entreprise, d.num_dossier, d.num_acte, d.description, d.libelle]
  .some((x) => x && String(x).toLowerCase().includes(q.toLowerCase()));

const LigneDossier = ({ d, etat, children }) => (
  <li className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
    <div className="min-w-0 flex-1 basis-60">
      <div className="text-sm font-semibold text-slate-800 line-clamp-2">{intitule(d)}</div>
      <div className="text-xs text-slate-400 truncate">{[references(d), d.motif].filter(Boolean).join(' · ') || 'Sans référence'}</div>
    </div>
    {children}
    <Pastille ton={etat.ton}>{etat.texte}</Pastille>
  </li>
);

const MesDossiersAfgc = () => {
  useTitrePage('Mes dossiers');
  const [onglet, setOnglet] = useState('dossiers');
  const [demandes, setDemandes] = useState(null);
  const [listes, setListes] = useState(null);
  const [cadres, setCadres] = useState([]);
  const [cadre, setCadre] = useState('');
  const [q, setQ] = useState('');
  const [ouverte, setOuverte] = useState(null);
  const [annulation, setAnnulation] = useState(null);

  const charger = useCallback(() => {
    requestService.getMyRequests().then((l) => setDemandes(Array.isArray(l) ? l : [])).catch(() => setDemandes([]));
    listeService.lister().then(setListes).catch(() => setListes([]));
  }, []);

  useEffect(() => {
    charger();
    listeService.cadres().then(setCadres).catch(() => setCadres([]));
  }, [charger]);

  const seules = useMemo(() => (demandes || []).filter((d) => !d.lot_id && (!cadre || d.motif === cadre) && correspond(d, q)), [demandes, cadre, q]);
  const enCours = seules.filter((d) => ['demande', 'transmis'].includes(etatDemande(d).cle));
  const terminees = seules.filter((d) => !['demande', 'transmis'].includes(etatDemande(d).cle));
  const listesVues = (listes || []).filter((l) => (!cadre || l.cadre === cadre) && correspond(l, q));

  const ouvrir = async (id) => {
    if (ouverte?.id === id) { setOuverte(null); return; }
    setOuverte({ id, chargement: true });
    try {
      setOuverte(await listeService.detail(id));
    } catch {
      setOuverte(null);
      toast.error('Cette liste n\'a pas pu être ouverte.');
    }
  };

  const annuler = async (d) => {
    setAnnulation(d.id);
    try {
      await requestService.updateStatus(d.id, { status: 'annulé' });
      toast.success(`Demande annulée : ${intitule(d)}.`);
      charger();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Annulation impossible.');
    } finally {
      setAnnulation(null);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <EnTete titre="Mes dossiers" icone={FileSearch} aide="Chaque dossier demandé : Demandé, puis Transmis, puis Retourné.">
        <Link to="/demandes/nouvelle" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-docuflow-secondary text-white text-sm font-bold">
          <PlusCircle size={16} /> Demander un dossier
        </Link>
      </EnTete>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex p-1 rounded-2xl bg-slate-100">
          {[['dossiers', 'Dossiers', FileSearch], ['listes', 'Listes', ListChecks]].map(([cle, label, Icone]) => (
            <button key={cle} type="button" onClick={() => setOnglet(cle)}
              className={`px-4 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 transition-colors ${onglet === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <Icone size={15} /> {label}
              {cle === 'listes' && listes?.length > 0 && <span className="text-xs text-slate-400">{listes.length}</span>}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Entreprise, n° de dossier, n° d'acte…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-docuflow-secondary" aria-label="Rechercher" />
        </div>
      </div>
      {cadres.length > 1 && <div className="mb-5"><ChoixCadre cadres={cadres} valeur={cadre} onChange={setCadre} tous /></div>}

      {onglet === 'dossiers' ? (
        demandes === null ? <Chargement /> : (
          <div className="space-y-6">
            <section className="glass-card-premium rounded-3xl p-5 md:p-6">
              <h2 className="font-bold text-slate-900 mb-2">En cours <span className="text-slate-400 font-semibold">({enCours.length})</span></h2>
              {enCours.length ? (
                <ul className="divide-y divide-slate-100">
                  {enCours.map((d) => {
                    const etat = etatDemande(d);
                    return (
                      <LigneDossier key={d.id} d={d} etat={etat}>
                        {etat.cle === 'transmis' && d.loan_retour_prevu && (
                          <span className="text-xs text-slate-500">retour prévu le <strong>{dateCourte(d.loan_retour_prevu)}</strong></span>
                        )}
                        {etat.cle === 'demande' && (
                          <button type="button" onClick={() => annuler(d)} disabled={annulation === d.id}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-red-50 hover:text-red-600 inline-flex items-center gap-1">
                            {annulation === d.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Annuler
                          </button>
                        )}
                      </LigneDossier>
                    );
                  })}
                </ul>
              ) : <p className="text-sm text-slate-400 py-2">Aucun dossier en cours.</p>}
            </section>
            {terminees.length > 0 && (
              <section className="glass-card-premium rounded-3xl p-5 md:p-6">
                <h2 className="font-bold text-slate-900 mb-2">Terminés <span className="text-slate-400 font-semibold">({terminees.length})</span></h2>
                <ul className="divide-y divide-slate-100">
                  {terminees.slice(0, 50).map((d) => <LigneDossier key={d.id} d={d} etat={etatDemande(d)} />)}
                </ul>
              </section>
            )}
          </div>
        )
      ) : (
        listes === null ? <Chargement /> : listesVues.length ? (
          <div className="space-y-3">
            {listesVues.map((l) => (
              <div key={l.id} className="glass-card-premium rounded-3xl overflow-hidden">
                <button type="button" onClick={() => ouvrir(l.id)} className="w-full text-left p-5 flex flex-wrap items-center gap-4 hover:bg-slate-50/60 transition-colors">
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="font-black text-slate-900">{l.libelle}</div>
                    <div className="text-xs text-slate-400">{l.cadre} · déposée le {dateCourte(l.created_at)}{l.fichier ? ` · ${l.fichier}` : ''}</div>
                    <div className="mt-2 max-w-md"><Avancement total={l.total} transmis={l.transmis} retournes={l.retournes} /></div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {l.a_transmettre > 0 && <Pastille ton="ambre">{l.a_transmettre} demandé{l.a_transmettre > 1 ? 's' : ''}</Pastille>}
                    {l.transmis > 0 && <Pastille ton="vert">{l.transmis} transmis</Pastille>}
                    {l.retournes > 0 && <Pastille ton="gris">{l.retournes} retourné{l.retournes > 1 ? 's' : ''}</Pastille>}
                    {l.en_retard > 0 && <Pastille ton="rouge">{l.en_retard} en retard</Pastille>}
                  </div>
                  <ChevronRight size={18} className={`text-slate-300 transition-transform ${ouverte?.id === l.id ? 'rotate-90' : ''}`} />
                </button>
                {ouverte?.id === l.id && (
                  <div className="px-5 pb-5">
                    {ouverte.chargement ? <Chargement /> : (<>
                      <div className="flex justify-end py-2 border-t border-slate-100">
                        <button type="button" onClick={() => exporterListe(ouverte).catch(() => toast.error('L\'export Excel a échoué.'))}
                          className="px-3.5 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1.5">
                          <FileSpreadsheet size={14} /> Exporter (Excel)
                        </button>
                      </div>
                      <ul className="divide-y divide-slate-100">
                        {ouverte.dossiers.map((d) => (
                          <LigneDossier key={d.id} d={d} etat={etatDossierListe(d)}>
                            {d.etat === 'transmis' && d.date_retour_prevue && <span className="text-xs text-slate-500">retour prévu le <strong>{dateCourte(d.date_retour_prevue)}</strong></span>}
                          </LigneDossier>
                        ))}
                      </ul>
                    </>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-card-premium rounded-3xl p-8 text-center text-sm text-slate-500">
            Aucune liste. Pour demander d'un coup les dossiers d'un classeur Excel, utilisez « Demander une liste (Excel) » depuis{' '}
            <Link to="/demandes/nouvelle" className="font-bold text-docuflow-secondary hover:underline">Demander un dossier</Link>.
          </div>
        )
      )}
    </div>
  );
};

export default MesDossiersAfgc;
