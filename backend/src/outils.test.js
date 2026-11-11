// ============================================================================
// outils.test.js — outils de gestion des documents (migration 044).
// Plan de classement (rubriques codées, sous-dossiers d'année repliés,
// périmètre de lecture), politique composée à partir des réglages réels,
// tableau de gestion et charte de nommage, responsable des archives ;
// campagnes d'archivage périodiques (période, bilan, invitations, rappel,
// tour de garde).
// Exécution : npm run test:outils
// ============================================================================
const outils = require('./services/outilsService');
const campagnes = require('./services/campagneService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

(async () => {
  console.log('\n1. Sans base');
  const r = outils.lireRubrique;
  ok(r('410 Factures fournisseurs').code === '410' && r('410 Factures fournisseurs').intitule === 'Factures fournisseurs' && r('1.2 - Paie').code === '1.2' && r('A12 Marchés').code === 'A12',
    'rubrique du plan : code et intitulé séparés (410, 1.2, A12)');
  ok(r('Contrats').code === null && r('Contrats').intitule === 'Contrats' && r('2024').code === null && r('3 collines').code === '3', 'nom sans code : laissé entier');
  const dossiers = [
    { id: 1, parent_id: null, name: '400 Finances', nb_documents: 1 }, { id: 2, parent_id: 1, name: '420 Marchés', nb_documents: 2 },
    { id: 3, parent_id: 2, name: '2019', nb_documents: 5 }, { id: 4, parent_id: 2, name: '2020', nb_documents: 3 },
    { id: 5, parent_id: null, name: '100 Cabinet', nb_documents: 0 }, { id: 6, parent_id: 5, name: '190 Confidentiel', nb_documents: 9 },
    { id: 7, parent_id: null, name: '2021', nb_documents: 4 },
  ];
  const plan = outils.construirePlan(dossiers, [{ name: 'Dossier de marché public', dossier_defaut_id: 2 }]);
  ok(plan.rubriques.map((x) => x.code || x.nom).join() === '100,190,400,420,2021', `plan trié par code, rubrique mère avant ses filles (${plan.rubriques.map((x) => x.code || x.nom).join()})`);
  const marches = plan.rubriques.find((x) => x.code === '420');
  ok(marches.nb_documents === 10 && marches.par_annee && marches.profondeur === 1 && marches.classes.join() === 'Dossier de marché public',
    'sous-dossiers d\'année repliés dans leur rubrique : documents comptés, « classée par année », classe rangée là');
  ok(plan.rubriques.some((x) => x.nom === '2021') && plan.masques === 0, 'un dossier « 2021 » à la racine reste une rubrique');
  const borne = outils.construirePlan(dossiers, [], new Set([1, 2, 3, 4, 5, 7]));
  ok(!borne.rubriques.some((x) => x.code === '190') && borne.masques === 1, 'rubrique hors du périmètre de lecture : comptée, jamais nommée');

  const base = {
    organisation: { nom: 'Mairie de Test', autorite: 'Direction des Archives Nationales (DAN)' }, responsable: { nom: null, acte: null }, classes: [{}, {}],
    procedure: { visa_requis: true, horodatage: false, integrite_jours: 30, scellement: true, partage_public: true, courrier_delai_jours: 15,
      campagne: 'trimestrielle', campagne_libelle: 'Chaque trimestre', circuits: 0, boites: 0, roles: [{ nom: 'Archiviste' }] },
  };
  const texte = (pol) => pol.map((a) => [a.titre, ...(a.paragraphes || []), ...(a.etapes || []).map((e) => e.join(' : '))].join('\n')).join('\n');
  const p1 = texte(outils.politique(base));
  ok(/reste à désigner/.test(p1) && /visa de l'autorité d'archives/.test(p1) && /chaque trimestre/.test(p1) && !/horodatés/.test(p1) && !/circuit de validation/.test(p1),
    'politique : dit ce qui est — pas de responsable, visa exigé, campagne trimestrielle, ni horodatage ni circuit');
  const p2 = texte(outils.politique({ ...base, responsable: { nom: 'Mme Aïcha DOSSOU, archiviste', acte: 'Note de service n° 12 du 3 mars 2026' },
    procedure: { ...base.procedure, visa_requis: false, horodatage: true, partage_public: false, campagne: 'aucune', circuits: 2, boites: 12 } }));
  ok(/Mme Aïcha DOSSOU, archiviste \(Note de service n° 12 du 3 mars 2026\)/.test(p2) && !/visa de l'autorité/.test(p2) && /horodatés par une autorité tierce/.test(p2)
    && /désactivés/.test(p2) && /Aucune campagne/.test(p2) && /2 circuits définis/.test(p2) && /12 boîtes décrites/.test(p2),
    'politique : suit les réglages — responsable nommé, horodatage, partage coupé, circuits, boîtes');
  ok(outils.politique(base).map((a) => a.titre).join('|') === "Objet et champ d'application|Responsabilités|Le parcours d'un document|Documents papier|Archivage périodique|Confidentialité et traçabilité|Formation|Révision",
    'politique : huit articles, de l\'objet à la révision');

  const d = new Date('2026-11-11T10:00:00');
  ok(campagnes.periodeDe(d, 'mensuelle') === '2026-11' && campagnes.periodeDe(d, 'trimestrielle') === '2026-T4' && campagnes.periodeDe(d, 'semestrielle') === '2026-S2'
    && campagnes.periodeDe(d, 'annuelle') === '2026' && campagnes.periodeDe(d, 'aucune') === null && campagnes.periodeDe(new Date('2026-03-31T23:00:00'), 'trimestrielle') === '2026-T1',
    'période en cours selon la périodicité');
  ok(campagnes.libellePeriode('2026-T4') === '4e trimestre 2026' && campagnes.libellePeriode('2026-T1') === '1er trimestre 2026' && campagnes.libellePeriode('2026-11') === 'novembre 2026'
    && campagnes.libellePeriode('2026-S2') === '2e semestre 2026' && campagnes.libellePeriode('2026') === 'année 2026', 'période en clair');
  ok(/3 agents invités/.test(campagnes.messageBilan({ agents_prevenus: 3, a_decrire: 2, sans_classe: 0, sans_dossier: 1, courants_anciens: 0, echus: 4 }))
    && /2 documents à décrire ; 1 document hors du plan de classement ; 4 documents dont la durée de conservation est échue/.test(campagnes.messageBilan({ agents_prevenus: 3, a_decrire: 2, sans_classe: 0, sans_dossier: 1, courants_anciens: 0, echus: 4 }))
    && /Rien n'attend/.test(campagnes.messageBilan({ agents_prevenus: 1, a_decrire: 0, sans_classe: 0, sans_dossier: 0, courants_anciens: 0, echus: 0 })),
    'bilan en clair : seulement ce qui reste à faire');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const roleService = require('./services/roleService');
    const classeService = require('./services/classeService');
    const aclService = require('./services/aclService');
    const settingsService = require('./services/settingsService');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Outils ${s}`, `outils-${s}`])).rows[0].id;
    const t2 = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Ailleurs ${s}`, `outils-ailleurs-${s}`])).rows[0].id;
    await roleService.provisionRoles(t);
    await roleService.provisionRoles(t2);
    const utilisateur = async (tenant, role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username, full_name",
      [tenant, `${nom.toLowerCase()}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const archi = await utilisateur(t, 'archiviste', 'Archi');
    const agent = await utilisateur(t, 'agent', 'Agent');
    const agent2 = await utilisateur(t, 'agent', 'Agentdeux');
    const lecteur = await utilisateur(t, 'lecteur', 'Lecteur');
    await utilisateur(t2, 'archiviste', 'Autre');

    await classeService.installerPlan(t, 'commune', archi.id);
    await classeService.installerClasses(t, ['MP', 'FACF', 'NS']);
    await classeService.appliquerReferentiel(t, archi);
    await db.query("INSERT INTO metadata_schemas (tenant_id, name, code) VALUES ($1, 'Classe sans règle', 'ZZ')", [t]);
    const doc = async (createur, plus = {}) => (await db.query(
      `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by, description, classe_id, dossier_id, date_document)
       VALUES ($1, $2, 'D', 'A', 'X', 2020, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [t, `O-${s}-${Math.random()}`, plus.statut || 'disponible', createur.id, plus.description || null, plus.classe_id || null, plus.dossier_id || null, plus.date || null])).rows[0].id;
    const mp = (await db.query("SELECT id, dossier_defaut_id FROM metadata_schemas WHERE tenant_id = $1 AND code = 'MP'", [t])).rows[0];
    await doc(archi, { classe_id: mp.id, dossier_id: mp.dossier_defaut_id, description: 'MP-2019-AOO-001 — Pistes rurales' });
    await doc(agent, { statut: 'à indexer' });
    await doc(agent, { statut: 'à indexer' });
    await doc(agent2, { classe_id: mp.id, date: '2015-06-01' });

    // --- Outils -------------------------------------------------------------------
    let ref = await outils.referentiel(t, archi);
    ok(ref.organisation.nom === `Outils ${s}` && ref.responsable.nom === null && ref.manques.some((m) => m.cle === 'responsable'), 'organisation et responsable : ce qui manque est dit');
    ok(ref.plan.rubriques.length > 10 && ref.plan.rubriques[0].code === '100' && ref.plan.rubriques.every((x) => !/^\d{4}$/.test(x.nom)), 'plan de classement : rubriques codées, sans sous-dossier d\'année');
    const classeMp = ref.classes.find((c) => c.code === 'MP');
    ok(classeMp.conservation.dua_annees === 10 && classeMp.conservation.sort_final_libelle === 'Tri' && classeMp.conservation.point_depart_libelle && /OHADA/.test(classeMp.conservation.reference)
      && classeMp.communicabilite.libelle && classeMp.nb_documents === 2, 'tableau de gestion : durée, point de départ, sort final, justification, communicabilité');
    ok(classeMp.modele_nom === 'MP-{année}-{Référence du dossier} — {Objet du marché}' && classeMp.exemple === 'MP-2019-AOO-001 — Pistes rurales' && classeMp.proprietes.length === 9
      && classeMp.proprietes[0].type === 'Texte' && classeMp.proprietes[0].obligatoire && classeMp.rangement.par_annee === true && /Marchés/.test(classeMp.rangement.dossier),
      'charte de nommage : modèle, exemple réel, propriétés, rubrique de rangement');
    ok(ref.manques.some((m) => m.cle === 'conservation' && /^1 classe n'a pas/.test(m.texte)) && ref.classes.find((c) => c.code === 'ZZ').conservation === null, 'classe sans durée : signalée');
    ok(ref.droits.lancer_campagne === true && ref.droits.configurer === false && (await outils.referentiel(t, lecteur)).droits.lancer_campagne === false, 'droits : l\'archiviste lance les campagnes, pas le lecteur');
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'archives_responsable', 'Mme Archi, archiviste'), ($1, 'archives_responsable_acte', 'Note de service n° 7')", [t]);
    settingsService.invalidate(t);
    ref = await outils.referentiel(t, archi);
    ok(ref.responsable.nom === 'Mme Archi, archiviste' && !ref.manques.some((m) => m.cle === 'responsable') && /Mme Archi, archiviste \(Note de service n° 7\)/.test(texte(ref.politique)), 'responsable désigné : repris en tête de la politique');
    // Dossier restreint : ni la rubrique ni l'exemple ne sortent du périmètre.
    await aclService.setAcl(t, mp.dossier_defaut_id, { subject_type: 'user', subject_id: archi.id, level: 'manage' }, archi.id);
    aclService.invalidate();
    const vuAgent = await outils.referentiel(t, agent);
    ok(!vuAgent.plan.rubriques.some((x) => x.id === mp.dossier_defaut_id) && vuAgent.plan.masques >= 1 && vuAgent.classes.find((c) => c.code === 'MP').exemple === null
      && vuAgent.classes.find((c) => c.code === 'MP').rangement === null, 'dossier restreint : rubrique, rangement et exemple masqués à qui n\'y a pas accès');
    ok((await outils.referentiel(t2, (await db.query('SELECT id, tenant_id, role FROM users WHERE tenant_id = $1', [t2])).rows[0])).classes.length === 0, 'autre organisation : rien ne passe');

    // --- Campagnes -----------------------------------------------------------------
    const b = await campagnes.bilan(t);
    ok(b.a_decrire === 2 && b.sans_classe === 0 && b.sans_dossier === 3 && b.courants_anciens === 1 && b.echus === 0, `bilan : à décrire, hors plan, courants de plus de deux ans (${JSON.stringify(b)})`);
    const c1 = await campagnes.lancer(t, { date: new Date('2026-11-11T10:00:00') });
    ok(c1.nouvelle && c1.periode === '2026-T4' && c1.libelle === '4e trimestre 2026' && c1.lancee_par === null && c1.bilan.agents_prevenus === 2 && c1.bilan.a_decrire === 2, 'campagne du trimestre lancée par DocuFlow, bilan figé');
    const notifs = async (u) => (await db.query("SELECT title, message, lien FROM notifications WHERE id_user = $1 AND type = 'archives' ORDER BY id", [u.id])).rows;
    const [nAgent, nAgent2, nArchi, nLecteur] = await Promise.all([notifs(agent), notifs(agent2), notifs(archi), notifs(lecteur)]);
    ok(nAgent.length === 1 && /4e trimestre 2026/.test(nAgent[0].title) && /2 documents que vous avez déposés attendent/.test(nAgent[0].message) && nAgent[0].lien === '/documents/liste',
      'agent invité à verser ses dossiers clos, avec le compte de ses documents à décrire');
    ok(nAgent2.length === 1 && !/attend/.test(nAgent2[0].message) && nLecteur.length === 0, 'agent à jour : invitation simple ; un lecteur ne dépose rien : pas invité');
    ok(nArchi.length === 1 && /2 agents invités/.test(nArchi[0].message) && /2 documents à décrire/.test(nArchi[0].message) && nArchi[0].lien === '/documents/outils?vue=campagnes', 'gestionnaire des archives : le bilan');
    const c2 = await campagnes.lancer(t, { user: archi, date: new Date('2026-12-02T10:00:00') });
    ok(!c2.nouvelle && c2.id === c1.id && c2.rappels === 1 && (await notifs(agent)).length === 2 && /^Rappel/.test((await notifs(agent))[1].title), 'relance dans la même période : un rappel, pas une seconde campagne');
    ok((await campagnes.lister(t)).length === 1 && (await campagnes.lister(t2)).length === 0, 'historique par organisation');
    // Tour de garde : seules les organisations vivantes, une fois par période.
    await db.query("DELETE FROM campagnes_archivage WHERE tenant_id = $1", [t]);
    const avant = (await db.query('SELECT count(*)::int AS n FROM campagnes_archivage WHERE tenant_id = ANY($1)', [[t, t2]])).rows[0].n;
    await campagnes.tour(new Date('2027-01-05T08:00:00'), [t, t2]);
    await campagnes.tour(new Date('2027-01-20T08:00:00'), [t, t2]);
    const apres = (await db.query('SELECT tenant_id, periode FROM campagnes_archivage WHERE tenant_id = ANY($1)', [[t, t2]])).rows;
    ok(avant === 0 && apres.length === 1 && apres[0].tenant_id === t && apres[0].periode === '2027-T1', 'tour de garde : une campagne par période, aucune pour une organisation sans document');
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'archivage_campagne', 'aucune')", [t]);
    settingsService.invalidate(t);
    await campagnes.tour(new Date('2027-04-02T08:00:00'), [t, t2]);
    ok((await campagnes.lister(t)).length === 1 && (await attendreErreur(() => campagnes.lancer(t, { date: new Date('2027-04-02') })))?.status === 409
      && (await campagnes.lancer(t, { user: archi, date: new Date('2027-04-02T09:00:00') })).periode === '2027-T2', 'campagnes désactivées : plus de rendez-vous automatique, le lancement à la main reste possible');
    ok(/Aucune campagne/.test(texte((await outils.referentiel(t, archi)).politique)) && (await outils.referentiel(t, archi)).campagnes.length === 2, 'la politique suit le réglage ; les campagnes passées restent consultables');

    const cx = await db.pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query("SET LOCAL docuflow.audit_override = 'on'");
      await cx.query('DELETE FROM tenants WHERE id = ANY($1)', [[t, t2]]);
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { cx.release(); }
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Outils de gestion cohérents — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
