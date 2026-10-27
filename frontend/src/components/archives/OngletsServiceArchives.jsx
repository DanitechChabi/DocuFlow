import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Loader2, ShieldCheck, ShieldAlert, FileText, Printer } from 'lucide-react';
import { serviceArchivesService, empreinteFichier } from '../../services/serviceArchivesService';
import { usePermissions } from '../../hooks/usePermissions';
import { toast } from '../Toast';

/**
 * Registre des copies certifiées conformes (art. 36) : liste annuelle,
 * téléchargement de l'exemplaire, et vérification d'une copie présentée
 * (son empreinte est calculée dans le navigateur, le fichier ne part pas).
 */
export const OngletCopies = () => {
  const { can } = usePermissions();
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [copies, setCopies] = useState(null);
  const [numero, setNumero] = useState('');
  const [verif, setVerif] = useState(null);
  const [calcul, setCalcul] = useState(false);

  useEffect(() => { setCopies(null); serviceArchivesService.registre(annee).then(setCopies).catch(() => setCopies([])); }, [annee]);

  const verifier = async (fichier) => {
    if (!numero.trim()) { toast.error('Saisissez d\'abord le numéro porté sur la copie.'); return; }
    setCalcul(true);
    try {
      const empreinte = fichier ? await empreinteFichier(fichier) : null;
      setVerif(await serviceArchivesService.verifier(numero.trim(), empreinte));
    } catch { toast.error('Vérification impossible'); } finally { setCalcul(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="glass-card-premium p-5 lg:col-span-2">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-bold text-slate-800">Registre des copies certifiées conformes</h2>
          <select className="input-premium w-auto" value={annee} onChange={(e) => setAnnee(Number(e.target.value))}>
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {copies === null ? <Loader2 size={20} className="animate-spin text-slate-400 mx-auto my-8" />
          : !copies.length ? <p className="text-sm text-slate-500 py-6 text-center">Aucune copie délivrée en {annee}. Une copie se délivre depuis la fiche du document.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100"><th className="p-2">Numéro</th><th className="p-2">Document</th><th className="p-2">Délivrée à</th><th className="p-2">Le</th><th className="p-2">Par</th><th className="p-2" /></tr></thead>
                  <tbody>
                    {copies.map((c) => (
                      <tr key={c.id} className="border-b border-slate-50">
                        <td className="p-2 font-bold text-slate-700 whitespace-nowrap">{c.numero}</td>
                        <td className="p-2"><Link to={`/documents/liste?doc=${c.document_id}`} className="text-docuflow-secondary hover:underline">{c.document_reference}</Link> <span className="text-xs text-slate-400">v{c.version} · {c.pages} p.</span></td>
                        <td className="p-2">{c.destinataire}{c.autorisation_communication && <span className="block text-[11px] text-amber-700">sur autorisation</span>}</td>
                        <td className="p-2 whitespace-nowrap">{new Date(c.delivre_at).toLocaleDateString('fr-FR')}</td>
                        <td className="p-2">{c.delivre_par_nom}</td>
                        <td className="p-2">{can('archives.communicate') && <button type="button" onClick={() => serviceArchivesService.telecharger(c.numero)} className="text-slate-400 hover:text-docuflow-secondary" title="Exemplaire du registre"><Download size={15} /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>
      <div className="glass-card-premium p-5 space-y-3">
        <h2 className="text-sm font-bold text-slate-800">Vérifier une copie présentée</h2>
        <p className="text-xs text-slate-500">Saisissez le numéro porté sur la copie, puis choisissez le fichier PDF reçu : il est comparé à l'exemplaire du registre sans quitter votre poste.</p>
        <input className="input-premium" placeholder="CCC-2026-00001" value={numero} onChange={(e) => setNumero(e.target.value)} />
        <label className="btn-secondary w-full flex items-center justify-center gap-2 cursor-pointer">
          {calcul ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Choisir le PDF reçu
          <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && verifier(e.target.files[0])} />
        </label>
        <button type="button" onClick={() => verifier(null)} className="text-xs font-semibold text-docuflow-secondary hover:underline">Vérifier seulement le numéro</button>
        {verif && (
          !verif.trouve
            ? <p className="p-3 rounded-xl bg-red-50 text-red-700 text-sm font-semibold flex items-center gap-2"><ShieldAlert size={16} /> {verif.motif === 'format' ? 'Numéro mal formé.' : 'Aucune copie de ce numéro au registre.'}</p>
            : (
              <div className={`p-3 rounded-xl text-sm ${verif.conforme === false ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
                <p className="font-bold flex items-center gap-2">
                  {verif.conforme === false ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
                  {verif.conforme === true ? 'Copie authentique : identique à l\'exemplaire du registre.' : verif.conforme === false ? 'Le fichier présenté diffère de la copie délivrée.' : 'Ce numéro figure au registre.'}
                </p>
                <p className="text-xs mt-1">Délivrée le {new Date(verif.copie.delivre_at).toLocaleDateString('fr-FR')} à {verif.copie.destinataire}, par {verif.copie.delivre_par_nom} ({verif.copie.qualite_signataire}) — document {verif.copie.document_reference}, {verif.copie.pages} page(s).</p>
              </div>
            )
        )}
      </div>
    </div>
  );
};

/** Rapport annuel (art. 31) : choix de l'année, ouverture de la version imprimable. */
export const OngletRapport = () => {
  const annees = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  return (
    <div className="glass-card-premium p-6 max-w-2xl space-y-3">
      <h2 className="text-sm font-bold text-slate-800">Rapport annuel sur la gestion des archives</h2>
      <p className="text-sm text-slate-600">
        Le décret n° 2007-532 (art. 31) demande à chaque service producteur d'adresser chaque année à l'autorité d'archives un rapport sur la gestion de ses archives.
        DocuFlow le calcule à partir des données : documents entrés, fonds au 31 décembre, éliminations visées, versements, communications et copies, récolements, état de conservation et points d'attention.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        {annees.map((a) => (
          <Link key={a} to={`/documents/archivage/rapport/${a}`} className={a === annees[0] ? 'btn-primary flex items-center gap-2' : 'btn-secondary flex items-center gap-2'}>
            <Printer size={15} /> {a}{a === annees[0] ? ' (en cours)' : ''}
          </Link>
        ))}
      </div>
    </div>
  );
};
