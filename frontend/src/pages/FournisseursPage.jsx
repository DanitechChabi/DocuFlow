import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Search, Download, AlertTriangle, X, FileText, Fingerprint, Type, HelpCircle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { conformiteService, NATURES, montant } from '../services/conformiteService';
import { useTitrePage } from '../hooks/useTitrePage';
import { toast } from '../components/Toast';

/**
 * Fournisseurs — la vue CRM tirée des documents analysés.
 *
 * Regroupement par identifiant d'entreprise (IFU, SIREN) quand il est lu,
 * sinon par nom, sinon « inconnu ». Pour chacun : documents, total TTC (devis
 * exclus), alertes ouvertes, et l'historique de ses documents.
 */
const GROUPES = {
  identifiant: { libelle: 'Par identifiant', icone: Fingerprint },
  nom: { libelle: 'Par nom', icone: Type },
  inconnu: { libelle: 'Inconnus', icone: HelpCircle },
};

const FournisseursPage = () => {
  useTitrePage('Fournisseurs');
  const [fiches, setFiches] = useState(null);
  const [recherche, setRecherche] = useState('');
  const [groupe, setGroupe] = useState('tous');
  const [choisi, setChoisi] = useState(null);
  const [documents, setDocuments] = useState(null);

  useEffect(() => {
    conformiteService.fournisseurs().then(setFiches).catch((err) => {
      toast.error(err.response?.data?.message || 'Chargement des fournisseurs impossible');
      setFiches([]);
    });
  }, []);

  useEffect(() => {
    if (!choisi) return;
    setDocuments(null);
    conformiteService.documentsFournisseur(choisi.cle).then(setDocuments).catch(() => setDocuments([]));
  }, [choisi]);

  const visibles = useMemo(() => (fiches || []).filter((f) => (groupe === 'tous' || f.groupe === groupe)
    && (!recherche || `${f.nom} ${f.identifiant || ''}`.toLowerCase().includes(recherche.toLowerCase()))), [fiches, groupe, recherche]);

  const exporter = async () => {
    try { await conformiteService.exporterFournisseurs(); } catch { toast.error('Export impossible'); }
  };

  const compte = (g) => (fiches || []).filter((f) => f.groupe === g).length;

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Fournisseurs"
        subtitle="Les tiers de vos documents, regroupés par identifiant d'entreprise ou par nom"
        icon={Building2}
        breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Fournisseurs' }]}
        actions={<button type="button" onClick={exporter} disabled={!fiches?.length} className="btn btn-secondary"><Download size={16} /> Exporter (CSV)</button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="glass-card-premium p-4"><p className="text-3xl font-black text-slate-900">{fiches ? fiches.length : '—'}</p><p className="text-xs text-slate-500">fournisseurs</p></div>
        {Object.entries(GROUPES).map(([g, d]) => (
          <div key={g} className="glass-card-premium p-4"><p className="text-3xl font-black text-slate-900">{fiches ? compte(g) : '—'}</p><p className="text-xs text-slate-500 flex items-center gap-1"><d.icone size={12} /> {d.libelle.toLowerCase()}</p></div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input-premium pl-10" placeholder="Rechercher par nom ou identifiant…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </div>
        <div className="segmented">
          <button type="button" aria-pressed={groupe === 'tous'} onClick={() => setGroupe('tous')}>Tous</button>
          {Object.entries(GROUPES).map(([g, d]) => <button key={g} type="button" aria-pressed={groupe === g} onClick={() => setGroupe(g)}>{d.libelle}</button>)}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_minmax(360px,0.9fr)] gap-5 items-start">
        <div className="glass-card-premium overflow-hidden">
          {fiches === null ? (
            <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 skeleton rounded-xl" />)}</div>
          ) : visibles.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">Aucun fournisseur. Ils apparaissent quand des documents sont analysés.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr><th className="text-left px-4 py-3">Fournisseur</th><th className="text-right px-3 py-3">Documents</th><th className="text-right px-4 py-3">Total TTC</th></tr>
              </thead>
              <tbody>
                {visibles.map((f) => (
                  <tr key={f.cle} onClick={() => setChoisi(f)} className={`border-t border-slate-100 cursor-pointer hover:bg-blue-50/40 ${choisi?.cle === f.cle ? 'bg-blue-50/60' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800 flex items-center gap-2">{f.nom}{f.a_des_alertes && <AlertTriangle size={14} className="text-orange-500" aria-label="Alertes ouvertes" />}</p>
                      <p className="text-xs text-slate-500">{f.identifiant ? <span className="font-mono">{f.identifiant}</span> : GROUPES[f.groupe].libelle} · {f.natures.map((n) => NATURES[n] || n).join(', ')}</p>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold">{f.nombre_documents}</td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{montant(f.total_ttc, f.devise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="glass-card-premium p-5 lg:sticky lg:top-6" aria-label="Fiche du fournisseur">
          {!choisi ? (
            <p className="text-sm text-slate-500 text-center py-10">Choisissez un fournisseur pour voir ses documents.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-black text-slate-900">{choisi.nom}</h2>
                  <p className="text-xs text-slate-500">{choisi.identifiant ? <>Identifiant <span className="font-mono">{choisi.identifiant}</span></> : GROUPES[choisi.groupe].libelle}</p>
                </div>
                <button type="button" onClick={() => setChoisi(null)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400" aria-label="Fermer"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                <div className="rounded-xl bg-slate-50 p-2"><p className="text-lg font-black">{choisi.nombre_documents}</p><p className="text-[10px] text-slate-500">documents</p></div>
                <div className="rounded-xl bg-slate-50 p-2"><p className="text-sm font-black mt-1">{montant(choisi.total_ttc, choisi.devise)}</p><p className="text-[10px] text-slate-500">total TTC</p></div>
                <div className={`rounded-xl p-2 ${choisi.nombre_alertes ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}><p className="text-lg font-black">{choisi.nombre_alertes}</p><p className="text-[10px]">alerte(s)</p></div>
              </div>
              {documents === null ? <div className="h-24 skeleton rounded-xl" /> : (
                <ul className="space-y-2">
                  {documents.map((d) => (
                    <li key={d.id}>
                      <Link to={`/documents/liste?doc=${d.id}`} className="block rounded-xl border border-slate-100 p-3 hover:border-docuflow-secondary/40">
                        <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><FileText size={13} className="text-slate-400" /> {d.titre}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {NATURES[d.nature] || d.nature}
                          {d.donnees.montant_ttc ? ` · ${montant(d.donnees.montant_ttc, d.donnees.devise)}` : ''}
                          {d.donnees.date_emission ? ` · ${new Date(d.donnees.date_emission).toLocaleDateString('fr-FR')}` : ''}
                          {d.alertes ? <span className="text-orange-600 font-semibold"> · {d.alertes} alerte(s)</span> : null}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
};

export default FournisseursPage;
