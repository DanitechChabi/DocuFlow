import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, Loader2, ExternalLink, Copy, Check, EyeOff, Eye } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { toast } from '../components/Toast';
import { archivothequeService, STATUTS_PIECE } from '../services/archivothequeService';

/**
 * Gestion de l'archivothèque (migration 045) : les pièces proposées,
 * celles qui sont en ligne, celles qu'on a retirées. On propose une pièce
 * depuis la fiche d'un document ; on l'autorise et on la retire ici.
 */
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

const ArchivothequeGestionPage = () => {
  const [a, setA] = useState(null);
  const [envoi, setEnvoi] = useState(null);
  const charger = useCallback(() => archivothequeService.lister().then(setA).catch((e) => { toast.error(e.response?.data?.message || 'Chargement impossible'); setA({ pieces: [], droits: {} }); }), []);
  useEffect(() => { charger(); }, [charger]);
  const lien = a?.slug ? `${window.location.origin}/archivotheque/${a.slug}` : null;

  const agir = async (p, geste) => {
    let motif = '';
    if (geste === 'retirer') {
      motif = window.prompt(`Retirer « ${p.titre} » de l'archivothèque ? Motif (facultatif) :`, '');
      if (motif === null) return;
    }
    setEnvoi(p.id);
    try {
      if (geste === 'autoriser') { await archivothequeService.autoriser(p.id); toast.success('Pièce publiée'); } else { await archivothequeService.retirer(p.id, motif); toast.success('Pièce retirée'); }
      await charger();
    } catch (e) { toast.error(e.response?.data?.message || 'Action impossible'); } finally { setEnvoi(null); }
  };
  const copier = async () => { try { await navigator.clipboard.writeText(lien); toast.success('Adresse copiée'); } catch { toast.info(lien, 15000); } };

  const groupes = a ? [
    ['proposee', 'À autoriser', "Ces pièces attendent l'autorisation d'une personne habilitée."],
    ['publiee', 'En ligne', null], ['retiree', 'Retirées', null],
  ].map(([statut, titre, aide]) => ({ statut, titre, aide, pieces: a.pieces.filter((p) => p.statut === statut) })).filter((g) => g.pieces.length) : [];

  return (
    <div className="px-4 sm:px-8 pt-6 pb-24 max-w-[1100px] mx-auto">
      <PageHeader title="Archivothèque" subtitle="Quelques pièces choisies, montrées au public : communicables, sans donnée personnelle, publiées sur autorisation"
        icon={Landmark} breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Archivothèque' }]} />
      {a === null ? <div className="h-40 skeleton rounded-2xl" /> : (
        <div className="space-y-5">
          <section className={`rounded-2xl border p-4 flex flex-wrap items-center gap-3 ${a.active ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
            {a.active ? <Eye size={20} className="text-emerald-700 flex-shrink-0" /> : <EyeOff size={20} className="text-slate-400 flex-shrink-0" />}
            <div className="flex-1 min-w-[220px]">
              <p className="font-bold text-slate-800">{a.active ? "L'archivothèque est ouverte au public" : "L'archivothèque n'est pas ouverte au public"}</p>
              {a.active && lien ? <p className="text-sm text-slate-600 break-all">{lien}</p>
                : <p className="text-sm text-slate-600">Vous pouvez préparer les pièces dès maintenant : rien n'est visible tant qu'elle n'est pas activée.</p>}
            </div>
            {a.active && lien && (
              <>
                <button type="button" onClick={copier} className="btn btn-secondary btn-sm"><Copy size={14} /> Copier l'adresse</button>
                <a href={lien} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm"><ExternalLink size={14} /> Voir la page publique</a>
              </>
            )}
            {a.droits.configurer && <Link to="/admin-portal?onglet=configuration&reglage=archivoth" className="btn btn-secondary btn-sm">{a.active ? 'Réglages' : "Activer l'archivothèque"}</Link>}
          </section>

          {a.pieces.length === 0 ? (
            <div className="glass-card-premium p-12 text-center">
              <Landmark size={34} className="mx-auto text-slate-300 mb-2" />
              <p className="font-bold text-slate-800">Aucune pièce pour l'instant</p>
              <p className="text-sm text-slate-500 mt-1 max-w-xl mx-auto">Ouvrez la fiche d'un document numérisé (PDF ou image), section « Communication et suivi », carte « Archivothèque » : donnez-lui un titre et une notice, puis proposez-le.</p>
              <Link to="/documents/liste" className="btn btn-primary btn-sm mt-4 inline-flex">Choisir un document</Link>
            </div>
          ) : groupes.map((g) => (
            <section key={g.statut}>
              <h2 className="font-bold text-slate-800 mb-1">{g.titre} <span className="text-slate-400 font-semibold">({g.pieces.length})</span></h2>
              {g.aide && <p className="text-sm text-slate-500 mb-2">{g.aide}</p>}
              <ul className="glass-card-premium divide-y divide-slate-100">
                {g.pieces.map((p) => (
                  <li key={p.id} className="p-4 flex flex-wrap items-start gap-3">
                    <div className="flex-1 min-w-[240px]">
                      <p className="font-bold text-slate-900">{p.titre} <span className={`ml-1 align-middle text-[11px] px-2 py-0.5 rounded-full font-bold ${STATUTS_PIECE[p.statut][1]}`}>{STATUTS_PIECE[p.statut][0]}</span></p>
                      <p className="text-sm text-slate-500">{[p.date_affichee, p.theme, p.fichier && (p.fichier.type === 'application/pdf' ? 'PDF' : 'Image')].filter(Boolean).join(' · ')}</p>
                      {p.notice && <p className="text-sm text-slate-600 mt-1 line-clamp-2">{p.notice}</p>}
                      <p className="text-xs text-slate-500 mt-1.5">
                        <Link to={`/documents/liste?doc=${p.document_id}`} className="font-bold text-docuflow-secondary hover:underline">{p.reference}</Link>
                        {' · '}proposée par {p.propose_par || '—'} le {dateFr(p.propose_at)}
                        {p.autorise_par && ` · autorisée par ${p.autorise_par} le ${dateFr(p.autorise_at)}`}
                        {p.statut === 'retiree' && ` · retirée par ${p.retire_par || '—'} le ${dateFr(p.retire_at)}${p.retire_motif ? ` (${p.retire_motif})` : ''}`}
                        {p.statut === 'publiee' && ` · ${p.vues} consultation${p.vues > 1 ? 's' : ''}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p.statut === 'proposee' && a.droits.autoriser && (
                        <button type="button" disabled={envoi === p.id} onClick={() => agir(p, 'autoriser')} className="btn btn-primary btn-sm">{envoi === p.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Autoriser la publication</button>
                      )}
                      {p.statut !== 'retiree' && (a.droits.proposer || a.droits.autoriser) && (
                        <button type="button" disabled={envoi === p.id} onClick={() => agir(p, 'retirer')} className="btn btn-secondary btn-sm"><EyeOff size={14} /> Retirer</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default ArchivothequeGestionPage;
