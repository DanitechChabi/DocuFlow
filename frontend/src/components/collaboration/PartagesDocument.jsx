import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, Copy, Ban, Lock, Plus } from 'lucide-react';
import { collaborationService } from '../../services/collaborationService';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../Toast';

/**
 * Carte « Liens de partage » de la fiche (migration 033) : lien public vers
 * le document, à durée limitée, éventuellement protégé par mot de passe et
 * borné en téléchargements. Le lien n'est montré qu'à sa création : la base
 * n'en garde que l'empreinte.
 */
const ETATS = {
  actif: ['Actif', 'bg-emerald-50 text-emerald-700'],
  expire: ['Expiré', 'bg-slate-100 text-slate-500'],
  revoque: ['Révoqué', 'bg-slate-100 text-slate-500'],
  epuise: ['Épuisé', 'bg-amber-50 text-amber-700'],
  version_retiree: ['Version retirée', 'bg-slate-100 text-slate-500'],
};
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

const copier = async (texte) => {
  try {
    await navigator.clipboard.writeText(texte);
    toast.success('Lien copié');
  } catch {
    toast.info(texte, 15000);
  }
};

const PartagesDocument = ({ documentId, fichiers = [] }) => {
  const { can } = usePermissions();
  const [etat, setEtat] = useState(null);
  const [formulaire, setFormulaire] = useState(false);
  const [options, setOptions] = useState({ duree_jours: '', mot_de_passe: '', max_telechargements: '', fichier_id: '', libelle: '' });
  const [envoi, setEnvoi] = useState(false);
  const [nouveau, setNouveau] = useState(null);

  const charger = useCallback(() => {
    collaborationService.partages(documentId).then(setEtat).catch(() => setEtat({ indisponible: true }));
  }, [documentId]);
  useEffect(() => { if (can('documents.share')) charger(); }, [charger, can]);

  if (!can('documents.share') || etat?.indisponible) return null;

  const creer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const corps = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== ''));
      if (corps.duree_jours) corps.duree_jours = Number(corps.duree_jours);
      if (corps.max_telechargements) corps.max_telechargements = Number(corps.max_telechargements);
      const r = await collaborationService.creerPartage(documentId, corps);
      const url = `${window.location.origin}${r.chemin}`;
      setNouveau(url);
      copier(url);
      setFormulaire(false);
      setOptions({ duree_jours: '', mot_de_passe: '', max_telechargements: '', fichier_id: '', libelle: '' });
      charger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Création du lien impossible');
    } finally {
      setEnvoi(false);
    }
  };

  const revoquer = async (p) => {
    if (!window.confirm('Révoquer ce lien ? Il cessera immédiatement de fonctionner.')) return;
    try {
      await collaborationService.revoquerPartage(documentId, p.id);
      toast.success('Lien révoqué');
      charger();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Révocation impossible');
    }
  };

  const champ = (cle) => ({ value: options[cle], onChange: (e) => setOptions({ ...options, [cle]: e.target.value }) });
  const reglages = etat?.reglages;
  return (
    <div className="glass-card-premium p-5 space-y-3">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5"><Link2 size={14} /> Liens de partage</span>
        {reglages?.actif && !formulaire && (
          <button type="button" onClick={() => setFormulaire(true)} disabled={!fichiers.length}
            className="text-[11px] font-bold text-docuflow-secondary flex items-center gap-1 normal-case tracking-normal disabled:opacity-40"><Plus size={12} /> Nouveau lien</button>
        )}
      </h3>
      {!etat ? <div className="h-12 skeleton rounded-xl" /> : (
        <>
          {!reglages.actif && <p className="text-xs text-slate-500">Le partage public est désactivé par votre organisation.</p>}
          {nouveau && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs space-y-1.5">
              <p className="font-bold text-emerald-800">Lien créé et copié. Il ne sera plus affiché : conservez-le.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate bg-white rounded px-2 py-1 border border-emerald-100">{nouveau}</code>
                <button type="button" onClick={() => copier(nouveau)} className="btn btn-secondary btn-sm"><Copy size={12} /></button>
              </div>
            </div>
          )}
          {formulaire && (
            <form onSubmit={creer} className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2 text-xs">
              <input className="input-premium text-sm" maxLength={120} placeholder="Destinataire ou objet (facultatif)" {...champ('libelle')} />
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1"><span className="font-semibold text-slate-600">Valable (jours)</span>
                  <input type="number" min={1} max={reglages.duree_max_jours} className="input-premium text-sm" placeholder={String(reglages.duree_jours)} {...champ('duree_jours')} /></label>
                <label className="space-y-1"><span className="font-semibold text-slate-600">Téléchargements max.</span>
                  <input type="number" min={1} max={1000} className="input-premium text-sm" placeholder="Illimité" {...champ('max_telechargements')} /></label>
              </div>
              <label className="block space-y-1"><span className="font-semibold text-slate-600">Mot de passe{reglages.mot_de_passe_obligatoire ? ' (obligatoire)' : ' (facultatif)'}</span>
                <input type="password" autoComplete="new-password" minLength={6} required={reglages.mot_de_passe_obligatoire} className="input-premium text-sm" {...champ('mot_de_passe')} /></label>
              <label className="block space-y-1"><span className="font-semibold text-slate-600">Version partagée</span>
                <select className="input-premium text-sm" {...champ('fichier_id')}>
                  <option value="">Toujours la version courante</option>
                  {fichiers.map((f) => <option key={f.id} value={f.id}>Version {f.version} — {f.original_name}</option>)}
                </select></label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setFormulaire(false)} className="btn btn-secondary btn-sm">Annuler</button>
                <button type="submit" disabled={envoi} className="btn btn-primary btn-sm">{envoi && <Loader2 size={13} className="animate-spin" />} Créer le lien</button>
              </div>
            </form>
          )}
          {etat.partages.length === 0 ? <p className="text-xs text-slate-500">Aucun lien. Un lien public permet de transmettre ce document à une personne sans compte.</p> : (
            <ul className="space-y-2">
              {etat.partages.map((p) => {
                const [libelle, classe] = ETATS[p.etat] || ETATS.expire;
                return (
                  <li key={p.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700 truncate">{p.libelle || `Lien du ${date(p.created_at)}`}{p.protege && <Lock size={11} className="inline ml-1 text-slate-400" />}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${classe}`}>{libelle}</span>
                    </div>
                    <p className="text-slate-500">
                      {p.version_mode === 'fixe' ? `Version ${p.version}` : 'Version courante'} · jusqu'au {date(p.expire_at)} · {p.nb_consultations} consultation(s), {p.nb_telechargements}{p.max_telechargements ? `/${p.max_telechargements}` : ''} téléchargement(s)
                    </p>
                    <div className="flex items-center justify-between gap-2 text-slate-400">
                      <span>Par {p.cree_par || '—'}{p.revoque_at ? ` · révoqué par ${p.revoque_par || '—'}` : ''}</span>
                      {p.etat === 'actif' && <button type="button" onClick={() => revoquer(p)} className="font-bold text-red-600 flex items-center gap-1"><Ban size={11} /> Révoquer</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export default PartagesDocument;
