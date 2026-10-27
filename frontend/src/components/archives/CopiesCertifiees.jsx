import React, { useCallback, useEffect, useState } from 'react';
import { Stamp, Download, Loader2, X } from 'lucide-react';
import { serviceArchivesService } from '../../services/serviceArchivesService';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../Toast';

/**
 * Copies certifiées conformes d'un document (décret n° 2007-532, art. 36 ;
 * Code du numérique, art. 272). La copie reproduit la version choisie, dont
 * l'intégrité est vérifiée au moment de la délivrance, et se termine par
 * l'attestation du signataire. Chaque copie entre au registre.
 */
const CopiesCertifiees = ({ documentId, fichiers = [] }) => {
  const { can } = usePermissions();
  const peutDelivrer = can('archives.communicate');
  const [copies, setCopies] = useState(null);
  const [form, setForm] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [besoinAutorisation, setBesoinAutorisation] = useState(null);

  const charger = useCallback(() => {
    serviceArchivesService.copiesDocument(documentId).then(setCopies).catch(() => setCopies([]));
  }, [documentId]);
  useEffect(() => { charger(); }, [charger]);

  const reproductibles = fichiers.filter((f) => /^(application\/pdf|image\/(jpeg|png))/.test(f.mime_type || '') || /\.(pdf|jpe?g|png)$/i.test(f.original_name || ''));
  const ouvrir = () => {
    setBesoinAutorisation(null);
    setForm({ file_id: reproductibles[reproductibles.length - 1]?.id || '', destinataire: '', motif: '', qualite: '', lieu: '', autorisation: '' });
  };
  const delivrer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const c = await serviceArchivesService.delivrer(documentId, { ...form, file_id: form.file_id || undefined });
      toast.success(`Copie ${c.numero} délivrée : ${c.pages} page(s)`);
      await serviceArchivesService.telecharger(c.numero);
      setForm(null);
      charger();
    } catch (err) {
      const d = err.response?.data || {};
      if (d.code === 'NON_COMMUNICABLE') setBesoinAutorisation(d.message);
      else toast.error(d.message || 'Délivrance impossible');
    } finally {
      setEnvoi(false);
    }
  };

  if (copies === null) return null;
  if (!copies.length && !peutDelivrer) return null;
  const champ = (cle) => ({ value: form[cle], onChange: (e) => setForm({ ...form, [cle]: e.target.value }) });

  return (
    <div className="glass-card-premium p-5 space-y-3">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between">
        <span className="flex items-center gap-1.5"><Stamp size={14} /> Copies certifiées conformes{copies.length ? ` (${copies.length})` : ''}</span>
      </h3>
      {copies.length > 0 && (
        <ul className="space-y-1.5">
          {copies.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="min-w-0">
                <span className="font-bold text-slate-700">{c.numero}</span>
                <span className="block text-slate-500 truncate">{c.destinataire} · {new Date(c.delivre_at).toLocaleDateString('fr-FR')} · v{c.version}</span>
              </span>
              {peutDelivrer && (
                <button type="button" onClick={() => serviceArchivesService.telecharger(c.numero).catch(() => toast.error('Téléchargement impossible'))} className="text-slate-400 hover:text-docuflow-secondary" title="Exemplaire du registre"><Download size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {peutDelivrer && !form && (
        reproductibles.length
          ? <button type="button" onClick={ouvrir} className="btn-secondary w-full flex items-center justify-center gap-2"><Stamp size={15} /> Délivrer une copie certifiée</button>
          : <p className="text-[11px] text-slate-400">Aucune version en PDF ou en image : faites d'abord une copie de conservation PDF/A pour pouvoir certifier.</p>
      )}
      {form && (
        <form onSubmit={delivrer} className="space-y-2 p-3 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-700">Nouvelle copie certifiée conforme</p>
            <button type="button" onClick={() => setForm(null)} className="text-slate-400 hover:text-slate-600" aria-label="Fermer"><X size={14} /></button>
          </div>
          {reproductibles.length > 1 && (
            <label className="block text-[11px] font-semibold text-slate-500">Version reproduite
              <select className="input-premium mt-1" {...champ('file_id')}>
                {reproductibles.map((f) => <option key={f.id} value={f.id}>v{f.version} — {f.original_name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-[11px] font-semibold text-slate-500">Délivrée à *
            <input className="input-premium mt-1" required placeholder="Nom de la personne ou de l'administration" {...champ('destinataire')} />
          </label>
          <label className="block text-[11px] font-semibold text-slate-500">Motif
            <input className="input-premium mt-1" placeholder="Ex. : dossier de passeport" {...champ('motif')} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] font-semibold text-slate-500">Votre qualité
              <input className="input-premium mt-1" placeholder="archiviste" {...champ('qualite')} />
            </label>
            <label className="block text-[11px] font-semibold text-slate-500">Fait à
              <input className="input-premium mt-1" placeholder="Ville" {...champ('lieu')} />
            </label>
          </div>
          {besoinAutorisation && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 space-y-1.5">
              <p>{besoinAutorisation}</p>
              <input className="input-premium" required placeholder="Ex. : personne concernée, pièce d'identité vérifiée ; décision n° …" {...champ('autorisation')} />
            </div>
          )}
          <button type="submit" disabled={envoi} className="btn-primary w-full flex items-center justify-center gap-2">
            {envoi ? <Loader2 size={15} className="animate-spin" /> : <Stamp size={15} />} Vérifier l'original et délivrer
          </button>
          <p className="text-[10px] text-slate-400">L'intégrité de l'original est contrôlée avant la délivrance. La copie (PDF) est enregistrée au registre et téléchargée.</p>
        </form>
      )}
    </div>
  );
};

export default CopiesCertifiees;
