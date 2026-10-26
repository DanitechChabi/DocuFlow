import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { Award, Printer, Loader2, Gavel, ArrowLeft } from 'lucide-react';
import { archivesService, empreinteGroupee, dateHeure, dateCourte } from '../services/archivesService';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Certificat d'archivage d'un document (migration 031).
 *
 * Chaque ouverture ÉMET un certificat : numéro unique, contenu figé dans une
 * empreinte SHA-256, émission inscrite au journal chaîné. Un certificat
 * présenté plus tard se vérifie dans Archivage › Vérifier un certificat.
 * Imprimable (window.print et portail, voir index.css), au format portrait.
 */
const INTEGRITE = { intacte: 'Intacte', alteree: 'ALTÉRÉE', introuvable: 'INTROUVABLE' };
const taille = (o) => (o == null ? '—' : o < 1024 ? `${o} o` : o < 1048576 ? `${(o / 1024).toFixed(1)} Ko` : `${(o / 1048576).toFixed(1)} Mo`);

const Certificat = ({ c }) => (
  <article className="certificat">
    <header className="certificat-entete">
      <div>
        <p className="certificat-surtitre">{c.organisation}</p>
        <h1>Certificat d'archivage</h1>
        <p className="certificat-numero">N° {c.numero}</p>
      </div>
      <Award size={44} strokeWidth={1.4} aria-hidden="true" />
    </header>

    <p className="certificat-texte">
      Le présent certificat atteste que le document décrit ci-dessous est conservé dans le système d'archivage
      de <strong>{c.organisation}</strong>, que chacun de ses fichiers est identifié par son empreinte SHA-256,
      et que les événements de sa vie sont inscrits dans un journal d'audit chaîné et scellé.
    </p>

    <section>
      <h2>Document</h2>
      <dl className="certificat-grille">
        <dt>Référence</dt><dd className="mono">{c.document.reference}</dd>
        <dt>Entreprise</dt><dd>{c.document.entreprise}</dd>
        <dt>N° dossier / acte</dt><dd>{c.document.dossier_numero} / {c.document.acte}</dd>
        {c.document.classe && (<><dt>Classe</dt><dd>{c.document.classe}</dd></>)}
        {!c.document.classe && c.document.type && (<><dt>Type</dt><dd>{c.document.type}</dd></>)}
        {c.document.dossier && (<><dt>Classement</dt><dd>{c.document.dossier}</dd></>)}
        <dt>Année</dt><dd>{c.document.annee}</dd>
        {c.document.date_document && (<><dt>Date du document</dt><dd>{dateCourte(c.document.date_document)}</dd></>)}
        <dt>Entré dans la GED</dt><dd>{dateHeure(c.document.cree_le)}</dd>
        <dt>Statut</dt><dd>{c.document.statut}{c.document.en_corbeille ? ' (en corbeille)' : ''}</dd>
      </dl>
    </section>

    {c.gel && (
      <section className="certificat-gel">
        <h2><Gavel size={14} /> Gel juridique en cours</h2>
        <p>{c.gel.motif}{c.gel.reference ? ` — réf. ${c.gel.reference}` : ''}. Posé par {c.gel.pose_par || '—'} le {dateCourte(c.gel.pose_at)}.
          Aucune destruction n'est possible tant que le gel n'est pas levé.</p>
      </section>
    )}

    <section>
      <h2>Fichiers ({c.fichiers.length})</h2>
      <table>
        <thead><tr><th>Version</th><th>Fichier</th><th>Empreinte SHA-256</th><th>Contrôle</th></tr></thead>
        <tbody>
          {c.fichiers.map((f) => (
            <tr key={f.version}>
              <td>v{f.version}<br /><span className="discret">{dateCourte(f.verse_le)}</span></td>
              <td>{f.nom}<br /><span className="discret">{f.type} · {taille(f.taille)}</span></td>
              <td className="mono empreinte">{f.empreinte_sha256 ? empreinteGroupee(f.empreinte_sha256) : 'non calculée'}
                {f.empreinte_sha256 && <><br /><span className="discret">{f.empreinte_origine === 'rattrapage' ? `calculée le ${dateCourte(f.empreinte_le)}, après le versement` : 'calculée au versement'}</span></>}
              </td>
              <td>{INTEGRITE[f.integrite] || 'en attente'}<br /><span className="discret">{f.verifie_le ? dateHeure(f.verifie_le) : ''}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>

    <section>
      <h2>Événements au journal ({c.evenements.length})</h2>
      {c.evenements.length === 0 ? <p className="discret">Aucun événement journalisé pour ce document.</p> : (
        <table>
          <thead><tr><th>Date</th><th>Événement</th><th>Par</th><th>Maillon</th></tr></thead>
          <tbody>
            {c.evenements.map((e, i) => (
              <tr key={i}>
                <td>{dateHeure(e.date)}</td>
                <td>{e.action}</td>
                <td>{e.acteur || '—'}</td>
                <td className="mono">{e.rang ? `n° ${e.rang} · ${e.empreinte.slice(0, 12)}…` : 'antérieur au chaînage'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>

    <section className="certificat-sceau">
      <h2>Scellement</h2>
      <dl className="certificat-grille">
        <dt>Journal chaîné</dt><dd className="mono">maillon n° {c.journal.rang} · {empreinteGroupee(c.journal.empreinte)}</dd>
        {c.journal.dernier_sceau && (<><dt>Dernier sceau</dt><dd className="mono">n° {c.journal.dernier_sceau.rang} du {dateHeure(c.journal.dernier_sceau.scelle_at)}</dd></>)}
        <dt>Empreinte du certificat</dt><dd className="mono">{empreinteGroupee(c.empreinte_certificat)}</dd>
        <dt>Émis le</dt><dd>{dateHeure(c.emis_at)} par {c.emis_par}</dd>
      </dl>
      <p className="discret">
        Pour vérifier ce certificat : DocuFlow › Archivage › Vérifier un certificat, avec son numéro et son empreinte.
        Une empreinte qui ne correspond pas signale un certificat modifié après son émission.
      </p>
    </section>
  </article>
);

const CertificatPage = () => {
  const { id } = useParams();
  useTitrePage("Certificat d'archivage");
  const [cert, setCert] = useState(null);
  const [erreur, setErreur] = useState(null);
  const emis = useRef(false);

  useEffect(() => {
    // Une émission par ouverture (le mode strict de React rejoue les effets).
    if (emis.current) return;
    emis.current = true;
    archivesService.emettreCertificat(id).then(setCert).catch((err) => setErreur(err.response?.data?.message || 'Émission du certificat impossible'));
  }, [id]);

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[920px] mx-auto">
      <div className="flex items-center justify-between gap-3 mb-5">
        <Link to={`/documents/liste?doc=${id}`} className="text-sm font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"><ArrowLeft size={15} /> Retour au document</Link>
        <button type="button" onClick={() => window.print()} disabled={!cert} className="btn btn-primary"><Printer size={16} /> Imprimer</button>
      </div>
      {erreur ? (
        <div className="glass-card-premium p-10 text-center text-sm text-red-600 font-semibold">{erreur}</div>
      ) : !cert ? (
        <div className="glass-card-premium p-16 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto mb-3" /> Émission du certificat…</div>
      ) : (
        <div className="certificat-ecran">
          <Certificat c={cert} />
        </div>
      )}
      {cert && createPortal(
        <div className="portail-impression portail-portrait">
          <style>{'@media print { @page { size: A4 portrait; margin: 14mm; } }'}</style>
          <Certificat c={cert} />
        </div>,
        document.body,
      )}
    </div>
  );
};

export default CertificatPage;
