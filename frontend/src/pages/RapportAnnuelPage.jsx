import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { Printer, Loader2, ArrowLeft } from 'lucide-react';
import { serviceArchivesService } from '../services/serviceArchivesService';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Rapport annuel sur la gestion des archives (décret n° 2007-532, art. 31),
 * calculé sur les données de l'organisation, imprimable et à signer.
 */
const n = (v) => Number(v || 0).toLocaleString('fr-FR');
const go = (o) => (o >= 1e9 ? `${(o / 1e9).toFixed(1)} Go` : `${(o / 1e6).toFixed(1)} Mo`);
const NATURES = { original: ['original', 'originaux'], copie: ['copie', 'copies'], consultation: ['consultation sur place', 'consultations sur place'] };

const Ligne = ({ libelle, valeur }) => <><dt>{libelle}</dt><dd>{valeur}</dd></>;

const Rapport = ({ r }) => {
  const enCours = r.annee === new Date().getFullYear();
  return (
    <article className="certificat">
      <header className="certificat-entete">
        <div>
          <p className="certificat-surtitre">{r.organisation}</p>
          <h1>Rapport annuel sur la gestion des archives — {r.annee}</h1>
          <p className="certificat-numero">Destinataire : {r.autorite || 'autorité d\'archives compétente'} · décret n° 2007-532, art. 31</p>
        </div>
      </header>
      {enCours && <p className="certificat-texte"><em>Année en cours : chiffres arrêtés au {new Date(r.genere_at).toLocaleDateString('fr-FR')}.</em></p>}
      <section>
        <h2>1. Accroissements de l'année</h2>
        <dl className="certificat-grille">
          <Ligne libelle="Documents enregistrés" valeur={n(r.accroissements.documents)} />
          <Ligne libelle="dont sur support papier" valeur={n(r.accroissements.papier)} />
        </dl>
      </section>
      <section>
        <h2>2. Fonds conservé {enCours ? 'à ce jour' : 'au 31 décembre'}</h2>
        <dl className="certificat-grille">
          <Ligne libelle="Documents" valeur={n(r.fonds.documents)} />
          <Ligne libelle="dont papier / rangés en magasin" valeur={`${n(r.fonds.documents_papier)} / ${n(r.fonds.ranges)}`} />
          <Ligne libelle="Fichiers numériques" valeur={`${n(r.conservation.fichiers)} (${go(r.conservation.octets)})`} />
          <Ligne libelle="Locaux" valeur={`${n(r.fonds.depots)} dépôt(s), ${n(r.fonds.magasins)} magasin(s), ${n(r.fonds.boites)} boîte(s)${r.fonds.capacite_ml ? `, ${n(r.fonds.capacite_ml)} ml de capacité` : ''}`} />
          <Ligne libelle="Plan de classement" valeur={`${n(r.fonds.classes)} classe(s), dont ${n(r.fonds.classes_sans_duree)} sans durée de conservation`} />
        </dl>
      </section>
      <section>
        <h2>3. Éliminations et versements</h2>
        <dl className="certificat-grille">
          <Ligne libelle="Bordereaux d'élimination exécutés" valeur={`${n(r.eliminations.bordereaux)} (dont ${n(r.eliminations.vises)} visé(s) par l'autorité)`} />
          <Ligne libelle="Documents éliminés" valeur={n(r.eliminations.documents)} />
          <Ligne libelle="En attente de visa" valeur={n(r.eliminations.en_attente_visa)} />
          <Ligne libelle="Bordereaux de versement transmis / pris en charge" valeur={`${n(r.versements.transmis)} / ${n(r.versements.pris_en_charge)}`} />
          <Ligne libelle="Documents versés" valeur={n(r.versements.documents)} />
        </dl>
      </section>
      <section>
        <h2>4. Communication</h2>
        <dl className="certificat-grille">
          <Ligne libelle="Demandes reçues / livrées" valeur={`${n(r.communication.demandes_recues)} / ${n(r.communication.demandes_livrees)}`} />
          <Ligne libelle="Prêts et consultations" valeur={Object.keys(r.communication.prets).length ? Object.entries(r.communication.prets).map(([k, v]) => `${n(v)} ${NATURES[k] ? NATURES[k][v > 1 ? 1 : 0] : k}`).join(', ') : 'aucun'} />
          <Ligne libelle="Copies certifiées conformes" valeur={`${n(r.communication.copies_certifiees)} (dont ${n(r.communication.copies_sur_autorisation)} sur autorisation)`} />
        </dl>
      </section>
      <section>
        <h2>5. Conservation</h2>
        <dl className="certificat-grille">
          <Ligne libelle="Récolements clos" valeur={`${n(r.recolement.clos)} — ${n(r.recolement.manquants)} absent(s), ${n(r.recolement.abimes)} abîmé(s)`} />
          <Ligne libelle="Contrôles d'intégrité dans l'année" valeur={n(r.conservation.controles)} />
          <Ligne libelle="Fichiers à l'intégrité compromise" valeur={n(r.conservation.alterees)} />
          <Ligne libelle="Fichiers en format à risque / copies PDF/A" valeur={`${n(r.conservation.formats_a_risque)} / ${n(r.conservation.pdfa)}`} />
          <Ligne libelle="Horodatages par un tiers" valeur={n(r.conservation.horodatages)} />
        </dl>
      </section>
      <section>
        <h2>6. Points d'attention</h2>
        {r.points_attention.length
          ? <ul className="certificat-texte">{r.points_attention.map((p) => <li key={p}>{p}</li>)}</ul>
          : <p className="certificat-texte">Aucun point d'attention relevé.</p>}
      </section>
      <section><h2>Signature</h2><dl className="certificat-grille"><dt>Le responsable des archives</dt><dd>&nbsp;</dd><dt>Le chef du service producteur</dt><dd>&nbsp;</dd></dl></section>
    </article>
  );
};

const RapportAnnuelPage = () => {
  const { annee } = useParams();
  useTitrePage(`Rapport annuel ${annee}`);
  const [r, setR] = useState(null);
  const [erreur, setErreur] = useState(null);
  useEffect(() => { serviceArchivesService.rapport(annee).then(setR).catch((e) => setErreur(e.response?.data?.message || 'Rapport indisponible')); }, [annee]);
  return (
    <div className="px-4 sm:px-8 py-6 max-w-[920px] mx-auto">
      <div className="flex items-center justify-between gap-3 mb-5">
        <Link to="/documents/archivage?onglet=rapport" className="text-sm font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"><ArrowLeft size={15} /> Conservation et preuve</Link>
        <button type="button" onClick={() => window.print()} disabled={!r} className="btn btn-primary"><Printer size={16} /> Imprimer</button>
      </div>
      {erreur ? <div className="glass-card-premium p-10 text-center text-sm text-red-600 font-semibold">{erreur}</div>
        : !r ? <div className="glass-card-premium p-16 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto" /></div>
          : <div className="certificat-ecran"><Rapport r={r} /></div>}
      {r && createPortal(<div className="portail-impression portail-portrait"><style>{'@media print { @page { size: A4 portrait; margin: 14mm; } }'}</style><Rapport r={r} /></div>, document.body)}
    </div>
  );
};

export default RapportAnnuelPage;
