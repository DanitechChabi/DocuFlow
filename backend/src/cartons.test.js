// ============================================================================
// cartons.test.js — dossiers en cartons (057), plan de classement et
// calendrier de conservation, grille de transmission.
// 1. Sans base : lecture des actes, statuts, cartons ; plan ; durées par motif ;
//    DocuBot reconnaît les questions de conservation.
// 2. Avec base (DB_HOST/DATABASE_URL) : import sans doublon, recherche, liste
//    des cartons, présence (les points d'abord, les cartons en complément),
//    DocuBot. Organisation jetable.
// Exécution : npm run test:cartons
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);

(async () => {
  const c = require('./services/cartonsService');
  const plan = require('./services/planService');
  const { dureeMotif } = require('./services/loanService');
  const bot = require('./services/docubotService');

  console.log('\n1. Règles (sans base)');
  ok(c.actesDe('12877 à 12879').join() === '12877,12878,12879' && c.actesDe('13514-13515').join() === '13514,13515', 'actes : plages « à » et tiret');
  ok(c.actesDe('NEANT').length === 0 && c.actesDe('00208').join() === '208', 'actes : « NEANT » vide, zéros de tête ignorés');
  ok(c.statutDe('Annulé') === 'annule' && c.statutDe('Non retiré') === 'non_retire' && c.statutDe('') === 'non_retire', 'statut');
  ok(c.cartonDe('C3') === 'C3' && c.cartonDe('CARTON 12') === 'Carton 12' && c.cartonDe('CARTON AOVC 05') === 'AOVC 5' && c.cartonDe('') === null, 'carton');
  ok(plan.chercher('combien de temps garder les contrats de travail')[0]?.cote === '2F7', 'plan : contrats de travail → 2F7');
  ok(plan.chercher('cote des ouvertures de compte')[0]?.cote === '1B', 'plan : ouvertures de compte → 1B');
  ok(plan.rubriqueDuFonds('non_retires')?.cote === '2B' && plan.rubriqueDuFonds('ouverture_compte')?.cote === '1B', 'plan : rubrique de chaque fonds');
  ok(plan.lister().rubriques.length > 150 && plan.lister().departements.length >= 10, 'plan : rubriques et départements');
  ok(dureeMotif({ Remboursement: 30, 'Appel à garantie': 'indéterminée' }, 'remboursement') === 30, 'grille : durée du motif, casse ignorée');
  ok(dureeMotif('{"Appel à garantie":"indéterminée"}', 'Appel a garantie') === 365, 'grille : « indéterminée » = suivi un an');
  ok(dureeMotif({ Remboursement: 30 }, 'Autre') === null && dureeMotif('pas du json', 'X') === null && dureeMotif(null, 'X') === null, 'grille : motif absent ou réglage illisible → durée par défaut');
  ok(bot.regleSure('combien de temps conserver les contrats de travail ?') === 'conservation', 'DocuBot : question de conservation reconnue');
  ok(bot.regleSure('où classer les PV du conseil ?') === 'conservation' && bot.regleSure('où est mon dossier ?') !== 'conservation', 'DocuBot : « où classer » oui, « mon dossier » non');
  const routes = require('./routes/cartonsRoutes');
  ok(['/import', '/recherche', '/liste/:fonds', '/fichiers'].every((p) => routes.stack.some((l) => l.route?.path === p)), 'routes déclarées');

  if (!avecBase) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const e = require('./services/entreeService');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test cartons ${s}`, `test-cartons-${s}`])).rows[0].id;
    await require('./services/roleService').provisionRoles(t);
    const u = (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Archiviste', $3, 'archiviste') RETURNING id, tenant_id, role", [t, `a-${s}`, `a-${s}@exemple.test`])).rows[0];
    const nr = [
      { serie: '2024', carton: 'C1', rang: 1, denomination: 'Zénith Fictif', actes: '12877 à 12879', typologie: 'CBE', statut: 'Non retiré', annee: 2024 },
      { serie: '2024', carton: 'C1', rang: 2, denomination: 'Mercure Fictif', actes: '13514-13515', typologie: 'ATT', statut: 'Annulé', annee: 2024 },
      { serie: '2025', carton: 'C2', rang: 1, denomination: 'Agro Fictive', actes: '200', typologie: 'CM', statut: 'Non retiré', annee: 2025 },
      { serie: '2025', carton: '', rang: 2, denomination: 'Sans Carton Fictif', actes: '201', annee: 2025 },
    ];
    const r1 = await c.importer(t, u, { fonds: 'non_retires', fichier: 'non-retires.xlsx', lignes: nr });
    ok(r1.ajoutees === 4, 'import des dossiers non retirés');
    ok((await c.importer(t, u, { fonds: 'non_retires', fichier: 'non-retires.xlsx', lignes: nr })).ajoutees === 0, 'réimport : rien en double');
    const oc = [
      { serie: 'Feuil1', carton: 'CARTON 12', rang: 1, denomination: 'Agro Fictive', matricule: '41020034511' },
      { serie: 'Feuil1', carton: 'CARTON AOVC 5', rang: 1, denomination: 'Delta Fictif', matricule: '5512' },
    ];
    ok((await c.importer(t, u, { fonds: 'ouverture_compte', fichier: 'ouvertures.xlsx', lignes: oc })).ajoutees === 2, 'import des ouvertures de compte');
    let refus = null; try { await c.importer(t, u, { fonds: 'autre', lignes: nr }); } catch (err) { refus = err.statut; }
    ok(refus === 400, 'fonds inconnu : 400');

    ok((await c.rechercher(t, { q: '12878' })).map((d) => d.denomination).join() === 'Zénith Fictif', 'acte 12878 retrouvé dans « 12877 à 12879 »');
    ok((await c.rechercher(t, { q: '41020034511' })).map((d) => d.carton).join() === 'Carton 12', 'matricule long : son carton');
    ok((await c.rechercher(t, { q: 'agro fictive' })).length === 2, 'par nom : dans les deux fonds');
    ok((await c.rechercher(t, { fonds: 'non_retires', carton: 'C1' })).length === 2, 'le contenu d\'un carton');
    const liste = await c.cartons(t, 'non_retires');
    ok(liste.cartons.map((x) => x.carton ?? '-').join() === 'C1,C2,-' && liste.totaux.non_retires === 4 && liste.totaux.ouverture_compte === 2, 'liste des cartons, sans carton en dernier ; totaux');
    const tr = await c.trouver(t, { nom: 'Mercure Fictif', numeros: [] });
    ok(tr.length === 1 && tr[0].libelle_statut === 'Annulé' && tr[0].nom_concorde, 'trouver : par nom, avec son statut');

    console.log('\n3. Présence : les points des dossiers retirés d\'abord');
    await e.importer(t, u, { fichier: 'point.xlsx', lignes: [{ date: '2026-01-05', ordre: 1, actes: '300', denomination: 'Agro Fictive', type: 'CM' }] });
    const p1 = await e.presence(t, { nom_entreprise: 'Agro Fictive' });
    ok(p1.total === 1 && p1.entrees[0].date_point === '2026-01-05', 'le point du dossier retiré est le résultat principal');
    ok(p1.cartons.length >= 1 && p1.cartons.length <= 3, 'les cartons en complément, trois au plus');
    const p2 = await e.presence(t, { nom_entreprise: 'Mercure Fictif' });
    ok(p2.total === 0 && p2.cartons[0]?.carton === 'C1', 'pas de point : le carton est donné');
    ok((await e.presence(t, { nom_entreprise: 'Inexistante Holding' })).cartons.length === 0, 'nom absent : aucun carton');

    console.log('\n4. DocuBot');
    const rc = await bot.repondre(u, 'combien de temps conserver les contrats de travail ?');
    ok(/2F7/.test(rc.texte) && /conserv|archiv/i.test(rc.texte), 'conservation : cote et règle');
    const rf = await bot.repondre(u, 'où est le dossier Mercure Fictif ?');
    ok(/C1|carton/i.test(rf.texte + JSON.stringify(rf.elements || [])), 'fiche : le dossier en carton est signalé');

    ok((await c.supprimerFichier(t, u, { fonds: 'non_retires', fichier: 'non-retires.xlsx' })).supprimees === 4, 'classeur supprimé');
    await db.query('DELETE FROM tenants WHERE id = $1', [t]).catch(() => {});
    await db.end?.();
  }
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
