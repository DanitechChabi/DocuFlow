import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, Loader2, Send } from 'lucide-react';
import { archivothequeService, STATUTS_PIECE } from '../../services/archivothequeService';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../Toast';

/**
 * Carte « Archivothèque » de la fiche (migration 045) : proposer le document
 * à la vitrine publique. Trois conditions, dites ici : le document doit être
 * communicable (le serveur le vérifie), ne porter aucune donnée personnelle
 * (celui qui propose le déclare), et sa publication doit être autorisée.
 */
const PUBLIABLES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

const ArchivothequeCarte = ({ documentId, titre = '', fichiers = [] }) => {
  const { can, charge } = usePermissions();
  const peutProposer = charge && can('archives.manage');
  const [piece, setPiece] = useState(undefined);
  const [formulaire, setFormulaire] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [saisie, setSaisie] = useState({ titre: '', notice: '', date_affichee: '', theme: '', fichier_id: '', sans_donnees_personnelles: false });
  const publiables = useMemo(() => fichiers.filter((f) => PUBLIABLES.has(f.mime_type)), [fichiers]);
  const charger = useCallback(() => archivothequeService.pourDocument(documentId).then(setPiece).catch(() => setPiece(null)), [documentId]);
  useEffect(() => { charger(); }, [charger]);

  const ouvrir = () => {
    setSaisie({
      titre: piece?.titre || titre || '', notice: piece?.notice || '', date_affichee: piece?.date_affichee || '', theme: piece?.theme || '',
      fichier_id: '', sans_donnees_personnelles: false,
    });
    setFormulaire(true);
  };
  const proposer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      setPiece(await archivothequeService.proposer(documentId, { ...saisie, fichier_id: saisie.fichier_id ? Number(saisie.fichier_id) : undefined }));
      setFormulaire(false);
      toast.success('Pièce proposée : elle sera en ligne une fois autorisée');
    } catch (err) { toast.error(err.response?.data?.message || 'Proposition impossible', 9000); } finally { setEnvoi(false); }
  };

  // Rien à montrer à qui ne peut pas proposer, tant que le document n'est pas une pièce.
  if (piece === undefined || (!piece && !peutProposer)) return null;
  const champ = (cle) => ({ value: saisie[cle], onChange: (e) => setSaisie((s) => ({ ...s, [cle]: e.target.value })) });

  return (
    <div className="glass-card-premium p-5 space-y-3">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5"><Landmark size={14} /> Archivothèque</span>
        {piece && <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold normal-case tracking-normal ${STATUTS_PIECE[piece.statut][1]}`}>{STATUTS_PIECE[piece.statut][0]}</span>}
      </h3>

      {piece && !formulaire && (
        <div className="text-sm text-slate-600 space-y-1">
          <p className="font-bold text-slate-800">{piece.titre}</p>
          <p className="text-xs">
            Proposée par {piece.propose_par || '—'} le {dateFr(piece.propose_at)}
            {piece.autorise_par && ` · autorisée par ${piece.autorise_par} le ${dateFr(piece.autorise_at)}`}
            {piece.statut === 'retiree' && ` · retirée le ${dateFr(piece.retire_at)}${piece.retire_motif ? ` (${piece.retire_motif})` : ''}`}
            {piece.statut === 'publiee' && ` · ${piece.vues} consultation${piece.vues > 1 ? 's' : ''}`}
          </p>
          {piece.statut === 'proposee' && <p className="text-xs text-amber-700">En attente de l'autorisation d'une personne habilitée.</p>}
          <Link to="/documents/archivotheque" className="text-xs font-bold text-docuflow-secondary hover:underline">Gérer l'archivothèque</Link>
        </div>
      )}

      {!formulaire && peutProposer && (!piece || piece.statut !== 'publiee') && (
        publiables.length === 0
          ? <p className="text-xs text-slate-500">Seuls les PDF et les images se publient. Numérisez ce document pour pouvoir le montrer.</p>
          : (
            <>
              {!piece && <p className="text-xs text-slate-500">Montrer ce document au public, dans la vitrine en ligne de l'organisation.</p>}
              <button type="button" onClick={ouvrir} className="btn btn-secondary btn-sm"><Send size={14} /> {piece ? 'Proposer de nouveau' : "Proposer à l'archivothèque"}</button>
            </>
          )
      )}

      {formulaire && (
        <form onSubmit={proposer} className="space-y-2.5">
          <label className="block text-xs font-bold text-slate-600">Titre affiché au public
            <input className="input-premium mt-1" maxLength={300} required {...champ('titre')} />
          </label>
          <label className="block text-xs font-bold text-slate-600">Notice <span className="font-normal text-slate-400">(contexte, intérêt de la pièce)</span>
            <textarea className="input-premium mt-1" rows={3} maxLength={3000} {...champ('notice')} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-bold text-slate-600">Date affichée
              <input className="input-premium mt-1" maxLength={60} placeholder="1962, vers 1970…" {...champ('date_affichee')} />
            </label>
            <label className="block text-xs font-bold text-slate-600">Thème
              <input className="input-premium mt-1" maxLength={120} placeholder="Histoire de la commune" {...champ('theme')} />
            </label>
          </div>
          {publiables.length > 1 && (
            <label className="block text-xs font-bold text-slate-600">Fichier publié
              <select className="input-premium mt-1" {...champ('fichier_id')}>
                <option value="">Dernière version</option>
                {publiables.map((f) => <option key={f.id} value={f.id}>v{f.version} — {f.original_name}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={saisie.sans_donnees_personnelles} onChange={(e) => setSaisie((s) => ({ ...s, sans_donnees_personnelles: e.target.checked }))} />
            <span>Je certifie que cette pièce ne porte aucune donnée personnelle, ou qu'elles ont été masquées sur le fichier publié.</span>
          </label>
          <p className="text-[11px] text-slate-500">Le fichier est figé à la proposition : une version déposée plus tard ne part pas en ligne. La pièce sera visible après autorisation.</p>
          <div className="flex gap-2">
            <button type="submit" disabled={envoi || !saisie.sans_donnees_personnelles} className="btn btn-primary btn-sm">{envoi ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Proposer</button>
            <button type="button" onClick={() => setFormulaire(false)} className="btn btn-ghost btn-sm">Annuler</button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ArchivothequeCarte;
