import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { ScrollText, Printer, Loader2, AlertTriangle, BellRing, CheckCircle2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { toast } from '../components/Toast';
import { outilsService } from '../services/outilsService';

/**
 * Outils de gestion des documents : politique, plan de classement, tableau de
 * gestion, charte de nommage. Aucun n'est rédigé à la main : chacun est lu
 * dans la configuration de l'organisation, et dit donc ce que DocuFlow
 * applique réellement. Ils s'impriment pour être signés, affichés ou remis à
 * un nouvel agent. Les campagnes d'archivage périodiques se suivent ici.
 */
const VUES = [
  ['politique', 'Politique'], ['plan', 'Plan de classement'], ['tableau', 'Tableau de gestion'], ['nommage', 'Charte de nommage'], ['campagnes', 'Campagnes'],
];
const PAYSAGE = new Set(['tableau', 'nommage']);
const dateFr = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

const Entete = ({ r, titre, detail }) => (
  <header className="certificat-entete">
    <div>
      <p className="certificat-surtitre">{r.organisation.nom || ''}</p>
      <h1>{titre}</h1>
      <p className="certificat-numero">{detail ? `${detail} · ` : ''}établi le {dateFr(r.etabli_at)}</p>
    </div>
  </header>
);

const Politique = ({ r }) => (
  <article className="certificat">
    <Entete r={r} titre="Politique de gestion des documents" />
    {r.politique.map((a, i) => (
      <section key={a.titre}>
        <h2>Article {i + 1} — {a.titre}</h2>
        {(a.paragraphes || []).map((p) => <p key={p} className="certificat-texte" style={{ marginTop: 8 }}>{p}</p>)}
        {a.etapes && (
          <ol style={{ margin: '8px 0 0', paddingLeft: 20, listStyle: 'decimal' }}>
            {a.etapes.map(([nom, texte]) => <li key={nom} style={{ marginTop: 5 }}><strong>{nom}.</strong> {texte}</li>)}
          </ol>
        )}
      </section>
    ))}
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginTop: 34, breakInside: 'avoid' }}>
      <div>
        <p className="discret">Le responsable des archives</p>
        <p style={{ fontWeight: 700, marginTop: 30 }}>{r.responsable.nom || '…………………………………………'}</p>
      </div>
      <div style={{ textAlign: 'right' }}>
        <p className="discret">Approbation</p>
        <p style={{ fontWeight: 700, marginTop: r.approbation ? 6 : 30 }}>{r.approbation || '…………………………………………'}</p>
      </div>
    </div>
  </article>
);

const PlanClassement = ({ r }) => (
  <article className="certificat">
    <Entete r={r} titre="Plan de classement" detail={pluriel(r.plan.rubriques.length, 'rubrique', 'rubriques')} />
    <p className="certificat-texte">Chaque document a une place et une seule, dans la rubrique de l'activité qui l'a produit. Les classes de documents indiquées se rangent d'elles-mêmes dans leur rubrique.</p>
    {r.plan.rubriques.length === 0 ? <p className="certificat-texte"><strong>Le plan de classement est vide.</strong> Installez un modèle de plan, ou créez vos dossiers.</p> : (
      <table style={{ marginTop: 14 }}>
        <thead><tr><th style={{ width: '9%' }}>Code</th><th style={{ width: '43%' }}>Rubrique</th><th>Classes de documents rangées ici</th><th style={{ width: '11%', textAlign: 'right' }}>Documents</th></tr></thead>
        <tbody>
          {r.plan.rubriques.map((x) => (
            <tr key={x.id}>
              <td className="mono" style={{ fontWeight: 700 }}>{x.code || ''}</td>
              <td style={{ paddingLeft: 6 + x.profondeur * 18, fontWeight: x.profondeur === 0 ? 800 : 500 }}>
                {x.intitule}{x.par_annee && <span className="discret"> · classée par année</span>}
              </td>
              <td>{x.classes.join(', ')}</td>
              <td style={{ textAlign: 'right' }}>{x.nb_documents || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    {r.plan.masques > 0 && <p className="discret" style={{ marginTop: 8 }}>{pluriel(r.plan.masques, 'rubrique à accès restreint n\'est pas montrée', 'rubriques à accès restreint ne sont pas montrées')} : elle{r.plan.masques > 1 ? 's sont' : ' est'} hors de votre périmètre.</p>}
  </article>
);

const duree = (c) => {
  if (!c) return null;
  if (c.dua_annees === 0) return 'Aucune durée';
  return `${pluriel(c.dua_annees, 'an', 'ans')}${c.point_depart_libelle ? ` à compter de ${c.point_depart_libelle}` : ''}`;
};

const TableauGestion = ({ r }) => (
  <article className="certificat">
    <Entete r={r} titre="Tableau de gestion" detail={pluriel(r.classes.length, 'classe de documents', 'classes de documents')} />
    <p className="certificat-texte">Pour chaque classe de documents : combien de temps elle est conservée, ce qu'elle devient ensuite, et quand elle peut être communiquée. {r.avertissement_conservation}</p>
    <table style={{ marginTop: 14 }}>
      <thead><tr><th style={{ width: '6%' }}>Code</th><th style={{ width: '17%' }}>Classe</th><th style={{ width: '15%' }}>Durée de conservation</th><th style={{ width: '11%' }}>Sort final</th><th style={{ width: '21%' }}>Communicabilité</th><th>Justification</th></tr></thead>
      <tbody>
        {r.classes.map((c) => (
          <tr key={c.id}>
            <td className="mono" style={{ fontWeight: 700 }}>{c.code || ''}</td>
            <td style={{ fontWeight: 700 }}>{c.nom}</td>
            <td>{duree(c.conservation) || (c.referentiel ? <span className="discret">Référentiel de travail : pas de durée</span> : <strong style={{ color: '#b45309' }}>À définir</strong>)}</td>
            <td>{c.conservation?.sort_final_libelle || ''}</td>
            <td>{c.communicabilite ? <>{c.communicabilite.libelle} <span className="discret">({c.communicabilite.reference})</span></> : ''}</td>
            <td>{c.conservation?.reference || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {r.organisation.autorite && <p className="discret" style={{ marginTop: 10 }}>Autorité d'archives compétente : {r.organisation.autorite}.</p>}
  </article>
);

const CharteNommage = ({ r }) => (
  <article className="certificat">
    <Entete r={r} titre="Charte de nommage" />
    <p className="certificat-texte">Le nom d'un document ne se saisit pas : il est calculé à partir de ses propriétés, selon le modèle de sa classe. La charte s'applique donc d'elle-même, à chaque enregistrement et à chaque correction. Entre accolades, <span className="mono">{'{année}'}</span>, <span className="mono">{'{code}'}</span>, <span className="mono">{'{compteur}'}</span> ou le nom d'une propriété ; une propriété vide disparaît du nom avec son séparateur.</p>
    <table style={{ marginTop: 14 }}>
      <thead><tr><th style={{ width: '6%' }}>Code</th><th style={{ width: '15%' }}>Classe</th><th style={{ width: '25%' }}>Modèle du nom</th><th style={{ width: '24%' }}>Exemple</th><th>Propriétés (* obligatoire)</th></tr></thead>
      <tbody>
        {r.classes.map((c) => (
          <tr key={c.id}>
            <td className="mono" style={{ fontWeight: 700 }}>{c.code || ''}</td>
            <td style={{ fontWeight: 700 }}>{c.nom}</td>
            <td className="mono">{c.modele_nom || <strong style={{ color: '#b45309', fontFamily: 'inherit' }}>Pas de modèle : le document porte le nom de sa classe</strong>}</td>
            <td>{c.exemple || <span className="discret">Aucun document encore</span>}</td>
            <td>{c.proprietes.map((p) => `${p.libelle}${p.obligatoire ? ' *' : ''}`).join(' · ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {r.communes.length > 0 && <p className="certificat-texte"><strong>Propriétés communes à tous les documents :</strong> {r.communes.map((p) => `${p.libelle}${p.obligatoire ? ' *' : ''}`).join(' · ')}.</p>}
  </article>
);

const COLONNES_BILAN = [
  ['agents_prevenus', 'Agents invités'], ['a_decrire', 'À décrire'], ['sans_classe', 'Sans classe'], ['sans_dossier', 'Hors du plan'],
  ['courants_anciens', 'Courants depuis plus de 2 ans'], ['echus', 'Durée échue'],
];

const Campagnes = ({ r, onLancee }) => {
  const [envoi, setEnvoi] = useState(false);
  const derniere = r.campagnes[0];
  const lancer = async () => {
    setEnvoi(true);
    try {
      const c = await outilsService.lancerCampagne();
      toast.success(c.nouvelle ? `Campagne lancée : ${c.libelle}` : `Rappel envoyé : ${c.libelle}`);
      onLancee();
    } catch (err) { toast.error(err.response?.data?.message || 'Lancement impossible'); } finally { setEnvoi(false); }
  };
  return (
    <div className="space-y-4">
      <section className="glass-card-premium p-5 flex flex-wrap items-start gap-4">
        <BellRing size={22} className="text-docuflow-secondary mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-[240px]">
          <h2 className="font-bold text-slate-800">
            {r.procedure.campagne === 'aucune' ? "Aucune campagne d'archivage périodique" : `Une campagne d'archivage ${r.procedure.campagne_libelle.toLowerCase()}`}
          </h2>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            À chaque campagne, toute personne qui peut déposer des documents est invitée à verser ceux de ses dossiers clos — ceux qui dorment sur un poste, dans une messagerie ou dans une armoire. Les gestionnaires des archives reçoivent le bilan de ce qui reste à décrire, à classer et à trier.
          </p>
          {r.droits.configurer && <Link to="/admin-portal?onglet=configuration&reglage=Campagne" className="text-sm font-bold text-docuflow-secondary hover:underline mt-1 inline-block">Changer la périodicité</Link>}
        </div>
        {r.droits.lancer_campagne && (
          <button type="button" disabled={envoi} onClick={lancer} className="btn btn-primary">
            {envoi ? <Loader2 size={16} className="animate-spin" /> : <BellRing size={16} />} {derniere ? 'Relancer la campagne en cours' : 'Lancer la campagne'}
          </button>
        )}
      </section>
      {r.campagnes.length === 0 ? (
        <div className="glass-card-premium p-10 text-center text-sm text-slate-500">Aucune campagne n'a encore eu lieu.</div>
      ) : (
        <div className="glass-card-premium overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="p-3 font-bold">Campagne</th>
                {COLONNES_BILAN.map(([k, nom]) => <th key={k} className="p-3 font-bold text-right whitespace-nowrap">{nom}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.campagnes.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 first:border-t-0">
                  <td className="p-3">
                    <strong className="text-slate-800 first-letter:uppercase inline-block">{c.libelle}</strong>
                    <p className="text-xs text-slate-500">Lancée le {dateFr(c.lancee_at)}{c.lancee_par ? ` par ${c.lancee_par}` : ' par DocuFlow'}{c.rappels ? ` · ${pluriel(c.rappels, 'rappel', 'rappels')}` : ''}</p>
                  </td>
                  {COLONNES_BILAN.map(([k]) => <td key={k} className={`p-3 text-right tabular-nums ${k !== 'agents_prevenus' && c.bilan[k] ? 'font-bold text-amber-700' : 'text-slate-600'}`}>{c.bilan[k] ?? '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.campagnes.length > 1 && <p className="text-xs text-slate-500 px-1">D'une campagne à l'autre, les colonnes de droite doivent baisser : c'est le retard qui se résorbe.</p>}
    </div>
  );
};

const LIENS_MANQUES = {
  responsable: ['/admin-portal?onglet=configuration&reglage=Responsable%20des%20archives', 'Le désigner', true], plan: ['/documents/classes', 'Installer un plan', false],
  conservation: ['/documents/classes', 'Fixer les durées', false], nommage: ['/documents/classes', 'Définir les modèles', false],
  campagne: ['/admin-portal?onglet=configuration&reglage=Campagne', 'La planifier', true],
};

const OutilsGestionPage = () => {
  const [params, setParams] = useSearchParams();
  const vue = VUES.some(([k]) => k === params.get('vue')) ? params.get('vue') : 'politique';
  const [r, setR] = useState(null);
  const [erreur, setErreur] = useState(null);
  const charger = useCallback(() => outilsService.referentiel().then(setR).catch((e) => setErreur(e.response?.data?.message || 'Outils indisponibles')), []);
  useEffect(() => { charger(); }, [charger]);

  const outil = !r ? null
    : vue === 'politique' ? <Politique r={r} /> : vue === 'plan' ? <PlanClassement r={r} />
      : vue === 'tableau' ? <TableauGestion r={r} /> : vue === 'nommage' ? <CharteNommage r={r} /> : null;

  return (
    <div className="px-4 sm:px-8 pt-6 pb-24 max-w-[1200px] mx-auto">
      <PageHeader title="Outils de gestion" subtitle="La politique, le plan de classement, le tableau de gestion et la charte de nommage, tels que DocuFlow les applique"
        icon={ScrollText} breadcrumb={[{ label: 'Accueil', to: '/' }, { label: 'Documents', to: '/documents' }, { label: 'Outils de gestion' }]}
        actions={outil && <button type="button" onClick={() => window.print()} className="btn btn-primary"><Printer size={16} /> Imprimer</button>} />

      {erreur ? <div className="glass-card-premium p-10 text-center text-sm text-red-600 font-semibold">{erreur}</div>
        : !r ? <div className="glass-card-premium p-16 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto" /></div> : (
          <>
            {r.manques.length > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-4 text-sm">
                <p className="font-bold text-amber-900 flex items-center gap-2"><AlertTriangle size={15} /> Ces outils disent ce qui est : il leur manque encore</p>
                <ul className="mt-1.5 space-y-0.5 text-amber-900">
                  {r.manques.map((m) => {
                    const [lien, action, reglage] = LIENS_MANQUES[m.cle] || [];
                    return <li key={m.cle}>{m.texte}{lien && (!reglage || r.droits.configurer) && <> <Link to={lien} className="font-bold underline">{action}</Link></>}</li>;
                  })}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-emerald-700 font-semibold flex items-center gap-2 mb-4"><CheckCircle2 size={16} /> Responsable désigné, plan de classement, durées, chartes de nommage et campagnes : tout est en place.</p>
            )}
            <div className="segmented mb-5 max-w-full overflow-x-auto">
              {VUES.map(([k, nom]) => <button key={k} type="button" aria-pressed={vue === k} onClick={() => setParams(k === 'politique' ? {} : { vue: k }, { replace: true })}>{nom}</button>)}
            </div>
            {outil ? <div className="certificat-ecran overflow-x-auto">{outil}</div> : <Campagnes r={r} onLancee={charger} />}
            {outil && createPortal(
              <div className={`portail-impression${PAYSAGE.has(vue) ? '' : ' portail-portrait'}`}>
                <style>{`@media print { @page { size: A4 ${PAYSAGE.has(vue) ? 'landscape' : 'portrait'}; margin: 14mm; } }`}</style>
                {outil}
              </div>, document.body)}
          </>
        )}
    </div>
  );
};

export default OutilsGestionPage;
