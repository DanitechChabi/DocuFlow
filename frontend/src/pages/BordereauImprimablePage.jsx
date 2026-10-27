import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { Printer, Loader2, ArrowLeft } from 'lucide-react';
import {
  archivageService, DESTINATIONS, DECISIONS_VISA, COMMUNICABILITE, dateFr, taille,
} from '../services/archivageService';
import { empreinteGroupee } from '../services/archivesService';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Bordereaux imprimables (décret n° 2007-532 du 2 novembre 2007) :
 *   - ÉLIMINATION : la liste soumise au visa de l'autorité d'archives
 *     (art. 44), avec le cadre réservé à son visa ;
 *   - VERSEMENT : la liste descriptive remise au service d'archives
 *     (art. 45-47), avec le cadre du récépissé.
 * Imprimable au format portrait (portail, voir index.css).
 */
const Entete = ({ org, titre, numero, intitule }) => (
  <header className="certificat-entete">
    <div>
      <p className="certificat-surtitre">{org?.nom || ''}{org?.adresse ? ` — ${org.adresse}` : ''}</p>
      <h1>{titre}</h1>
      <p className="certificat-numero">{numero} — {intitule}</p>
    </div>
  </header>
);

const Elimination = ({ b }) => (
  <article className="certificat">
    <Entete org={b.organisation} titre="Bordereau d'élimination" numero={b.numero} intitule={b.intitule} />
    <p className="certificat-texte">
      Liste des documents parvenus au terme de leur durée d'utilité administrative, dont le sort final est l'élimination,
      soumise au visa de {b.visa_autorite || b.organisation?.autorite || 'la Direction des Archives Nationales'} conformément à
      l'article 44 du décret n° 2007-532 du 2 novembre 2007. {b.totaux.documents} document(s), {b.totaux.fichiers} fichier(s), {taille(b.totaux.volume_octets)}.
    </p>
    <section>
      <h2>Service producteur</h2>
      <dl className="certificat-grille">
        <dt>Préparé par</dt><dd>{b.created_by_nom || '—'}</dd>
        <dt>Proposé par</dt><dd>{b.propose_par_nom || '—'} le {dateFr(b.propose_at)}</dd>
        <dt>Validé par</dt><dd>{b.valide_par_nom || '—'} le {dateFr(b.valide_at)}</dd>
      </dl>
    </section>
    <section>
      <h2>Documents ({b.lignes.length})</h2>
      <table>
        <thead><tr><th>#</th><th>Document</th><th>Classe</th><th>Date</th><th>DUA / échéance</th><th>Volume</th></tr></thead>
        <tbody>
          {b.lignes.map((l) => (
            <tr key={l.id}>
              <td>{l.ordre}</td>
              <td>{l.masque ? 'Document hors de votre périmètre' : <>{l.reference}<br /><span className="discret">{l.intitule}</span></>}</td>
              <td>{l.classe || '—'}</td>
              <td>{dateFr(l.date_document)}</td>
              <td>{l.dua_annees != null ? `${l.dua_annees} an(s) · ${dateFr(l.echeance)}` : dateFr(l.echeance)}{l.dua_reference ? <><br /><span className="discret">{l.dua_reference}</span></> : null}</td>
              <td>{l.nb_fichiers} · {taille(l.volume_octets)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
    <section>
      <h2>Visa de l'autorité d'archives</h2>
      {b.visa_numero ? (
        <dl className="certificat-grille">
          <dt>Décision</dt><dd>{DECISIONS_VISA[b.visa_decision]} — n° {b.visa_numero} du {dateFr(b.visa_date)}</dd>
          <dt>Autorité</dt><dd>{b.visa_autorite || '—'}</dd>
          {b.visa_observations && (<><dt>Observations</dt><dd>{b.visa_observations}</dd></>)}
        </dl>
      ) : (
        <dl className="certificat-grille">
          <dt>Décision</dt><dd>☐ Visa accordé &nbsp; ☐ Visa partiel &nbsp; ☐ Visa refusé</dd>
          <dt>N° et date</dt><dd>&nbsp;</dd>
          <dt>Observations</dt><dd>&nbsp;<br />&nbsp;</dd>
          <dt>Cachet et signature</dt><dd>&nbsp;<br />&nbsp;<br />&nbsp;</dd>
        </dl>
      )}
    </section>
    <section>
      <h2>Signatures du service producteur</h2>
      <dl className="certificat-grille"><dt>L'archiviste</dt><dd>&nbsp;</dd><dt>Le responsable</dt><dd>&nbsp;</dd></dl>
    </section>
  </article>
);

const Versement = ({ v }) => (
  <article className="certificat">
    <Entete org={v.organisation} titre="Bordereau de versement" numero={v.numero} intitule={v.intitule} />
    <p className="certificat-texte">
      Liste descriptive des documents versés {v.destination === 'archives_publiques' ? 'aux archives publiques' : 'au dépôt de pré-archivage'}
      {v.service_destinataire ? ` (${v.service_destinataire})` : ''}, conformément aux articles 45 à 47 du décret n° 2007-532 du 2 novembre 2007.
      {' '}{v.totaux.documents} document(s), {v.totaux.fichiers} fichier(s), {taille(v.totaux.volume_octets)}
      {v.totaux.dates_extremes ? `, dates extrêmes ${dateFr(v.totaux.dates_extremes.debut)} – ${dateFr(v.totaux.dates_extremes.fin)}` : ''}.
    </p>
    <section>
      <h2>Versement</h2>
      <dl className="certificat-grille">
        <dt>Destination</dt><dd>{DESTINATIONS[v.destination]}{v.service_destinataire ? ` — ${v.service_destinataire}` : ''}</dd>
        <dt>Préparé par</dt><dd>{v.created_by_nom || '—'}</dd>
        <dt>Transmis par</dt><dd>{v.transmis_par_nom || '—'} le {dateFr(v.transmis_at)}</dd>
      </dl>
    </section>
    <section>
      <h2>Documents ({v.lignes.length})</h2>
      <table>
        <thead><tr><th>#</th><th>Document</th><th>Classe / dossier</th><th>Date</th><th>Communicabilité</th><th>Fichiers et empreintes SHA-256</th></tr></thead>
        <tbody>
          {v.lignes.map((l) => (
            <tr key={l.id}>
              <td>{l.ordre}</td>
              <td>{l.masque ? 'Document hors de votre périmètre' : <>{l.reference}<br /><span className="discret">{l.intitule}</span></>}</td>
              <td>{l.classe || '—'}{l.dossier ? <><br /><span className="discret">{l.dossier}</span></> : null}</td>
              <td>{dateFr(l.date_document)}</td>
              <td>{l.masque ? '' : COMMUNICABILITE[l.communicabilite || '']}</td>
              <td className="mono empreinte">{(l.fichiers || []).map((f) => <div key={f.version}>v{f.version} {f.empreinte_sha256 ? empreinteGroupee(f.empreinte_sha256) : '—'}</div>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
    <section className="certificat-sceau">
      <h2>Scellement</h2>
      <dl className="certificat-grille">
        <dt>Empreinte du bordereau</dt><dd className="mono">{v.empreinte ? empreinteGroupee(v.empreinte) : '—'}</dd>
        <dt>Contrôle</dt><dd>{v.empreinte_conforme === null ? '—' : v.empreinte_conforme ? 'Conforme : la liste n\'a pas changé depuis la transmission' : 'NON CONFORME'}</dd>
      </dl>
    </section>
    <section>
      <h2>Récépissé du service d'archives</h2>
      {v.recepisse_numero ? (
        <dl className="certificat-grille">
          <dt>Récépissé</dt><dd>n° {v.recepisse_numero} du {dateFr(v.recepisse_date)}</dd>
          <dt>Pris en charge par</dt><dd>{v.pris_en_charge_par_nom || '—'}</dd>
        </dl>
      ) : (
        <dl className="certificat-grille">
          <dt>N° et date</dt><dd>&nbsp;</dd><dt>Nom et qualité</dt><dd>&nbsp;</dd><dt>Cachet et signature</dt><dd>&nbsp;<br />&nbsp;<br />&nbsp;</dd>
        </dl>
      )}
    </section>
  </article>
);

const BordereauImprimablePage = ({ type }) => {
  const { id } = useParams();
  useTitrePage(type === 'versement' ? 'Bordereau de versement' : "Bordereau d'élimination");
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState(null);
  useEffect(() => {
    (type === 'versement' ? archivageService.versement(id) : archivageService.bordereau(id))
      .then(setD).catch((e) => setErreur(e.response?.data?.message || 'Bordereau indisponible'));
  }, [id, type]);
  const retour = type === 'versement' ? `/documents/archivage?onglet=versements&versement=${id}` : `/documents/archivage?onglet=eliminations&bordereau=${id}`;
  const contenu = d && (type === 'versement' ? <Versement v={d} /> : <Elimination b={d} />);
  return (
    <div className="px-4 sm:px-8 py-6 max-w-[920px] mx-auto">
      <div className="flex items-center justify-between gap-3 mb-5">
        <Link to={retour} className="text-sm font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"><ArrowLeft size={15} /> Bordereau</Link>
        <button type="button" onClick={() => window.print()} disabled={!d} className="btn btn-primary"><Printer size={16} /> Imprimer</button>
      </div>
      {erreur ? <div className="glass-card-premium p-10 text-center text-sm text-red-600 font-semibold">{erreur}</div>
        : !d ? <div className="glass-card-premium p-16 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto" /></div>
          : <div className="certificat-ecran">{contenu}</div>}
      {d && createPortal(
        <div className="portail-impression portail-portrait">
          <style>{'@media print { @page { size: A4 portrait; margin: 14mm; } }'}</style>
          {contenu}
        </div>,
        document.body,
      )}
    </div>
  );
};

export default BordereauImprimablePage;
