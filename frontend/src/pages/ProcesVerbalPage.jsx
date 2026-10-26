import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { Printer, Loader2, ArrowLeft, ShieldCheck, ShieldAlert } from 'lucide-react';
import { archivageService, dateFr, taille } from '../services/archivageService';
import { empreinteGroupee } from '../services/archivesService';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Procès-verbal d'élimination (migration 032) : la seule mémoire de ce qui a
 * été détruit — documents, fichiers et leurs empreintes, intervenants, dates.
 * Son empreinte, figée à l'exécution, est recalculée à chaque édition.
 * Imprimable (portail, voir index.css), au format portrait.
 */
const Pv = ({ pv }) => {
  const b = pv.bordereau;
  return (
    <article className="certificat">
      <header className="certificat-entete">
        <div>
          <p className="certificat-surtitre">{pv.organisation}{pv.adresse ? ` — ${pv.adresse}` : ''}</p>
          <h1>Procès-verbal d'élimination</h1>
          <p className="certificat-numero">Bordereau {b.numero} — {b.intitule}</p>
        </div>
      </header>
      <p className="certificat-texte">
        Les documents ci-dessous, parvenus au terme de leur durée d'utilité administrative et dont le sort final est
        l'élimination, ont été détruits le {dateFr(b.execute_at)} : {pv.totaux.elimines} document(s), {pv.totaux.fichiers} fichier(s), {taille(pv.totaux.volume_octets)}.
      </p>
      <section>
        <h2>Intervenants</h2>
        <dl className="certificat-grille">
          <dt>Proposé par</dt><dd>{b.propose_par_nom || '—'} le {dateFr(b.propose_at)}</dd>
          <dt>Validé par</dt><dd>{b.valide_par_nom || '—'} le {dateFr(b.valide_at)}</dd>
          <dt>Exécuté par</dt><dd>{b.execute_par_nom || '—'} le {dateFr(b.execute_at)}</dd>
        </dl>
      </section>
      <section>
        <h2>Documents ({pv.lignes.length})</h2>
        <table>
          <thead><tr><th>#</th><th>Document</th><th>Échéance</th><th>Fichiers et empreintes SHA-256</th><th>Résultat</th></tr></thead>
          <tbody>
            {pv.lignes.map((l) => (
              <tr key={l.ordre}>
                <td>{l.ordre}</td>
                <td>{l.masque ? 'Document hors de votre périmètre' : <>{l.reference}<br /><span className="discret">{l.intitule}{l.classe ? ` · ${l.classe}` : ''}</span></>}</td>
                <td>{dateFr(l.echeance)}</td>
                <td className="mono empreinte">{(l.fichiers || []).map((f) => <div key={f.version}>v{f.version} {f.empreinte_sha256 ? empreinteGroupee(f.empreinte_sha256) : '—'}</div>)}</td>
                <td>{l.resultat === 'elimine' ? 'Éliminé' : `Écarté${l.motif_ecart ? ` : ${l.motif_ecart}` : ''}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="certificat-sceau">
        <h2>Scellement</h2>
        <dl className="certificat-grille">
          <dt>Empreinte du procès-verbal</dt><dd className="mono">{empreinteGroupee(pv.empreinte.enregistree)}</dd>
          <dt>Contrôle</dt><dd>{pv.empreinte.conforme ? 'Conforme : le bordereau n\'a pas été modifié depuis l\'exécution' : 'NON CONFORME'}</dd>
          {pv.journal && (<><dt>Journal chaîné</dt><dd className="mono">maillon n° {pv.journal.rang}</dd></>)}
          <dt>Édité le</dt><dd>{new Date(pv.edite_at).toLocaleString('fr-FR')}</dd>
        </dl>
      </section>
      <section>
        <h2>Signatures</h2>
        <dl className="certificat-grille"><dt>L'archiviste</dt><dd>&nbsp;</dd><dt>Le valideur</dt><dd>&nbsp;</dd></dl>
      </section>
    </article>
  );
};

const ProcesVerbalPage = () => {
  const { id } = useParams();
  useTitrePage("Procès-verbal d'élimination");
  const [pv, setPv] = useState(null);
  const [erreur, setErreur] = useState(null);
  useEffect(() => { archivageService.pv(id).then(setPv).catch((e) => setErreur(e.response?.data?.message || 'Procès-verbal indisponible')); }, [id]);
  return (
    <div className="px-4 sm:px-8 py-6 max-w-[920px] mx-auto">
      <div className="flex items-center justify-between gap-3 mb-5">
        <Link to={`/documents/archivage?onglet=eliminations&bordereau=${id}`} className="text-sm font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"><ArrowLeft size={15} /> Bordereau</Link>
        <span className="flex items-center gap-3">
          {pv && (pv.empreinte.conforme ? <span className="text-xs text-emerald-700 flex items-center gap-1"><ShieldCheck size={14} /> Empreinte conforme</span> : <span className="text-xs text-red-700 flex items-center gap-1"><ShieldAlert size={14} /> Empreinte non conforme</span>)}
          <button type="button" onClick={() => window.print()} disabled={!pv} className="btn btn-primary"><Printer size={16} /> Imprimer</button>
        </span>
      </div>
      {erreur ? <div className="glass-card-premium p-10 text-center text-sm text-red-600 font-semibold">{erreur}</div>
        : !pv ? <div className="glass-card-premium p-16 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto" /></div>
          : <div className="certificat-ecran"><Pv pv={pv} /></div>}
      {pv && createPortal(
        <div className="portail-impression portail-portrait">
          <style>{'@media print { @page { size: A4 portrait; margin: 14mm; } }'}</style>
          <Pv pv={pv} />
        </div>,
        document.body,
      )}
    </div>
  );
};

export default ProcesVerbalPage;
