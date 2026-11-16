// ============================================================================
// entrees.test.js — entrée des dossiers aux archives (049).
// 1. Sans base : semaine de production, n° d'acte, lettre, Pâques, gardes.
// 2. Avec base (DB_HOST/DATABASE_URL) : import sans doublon, semaines et jours
//    fériés, classement par lettre, recherche. Organisation jetable.
// Exécution : npm run test:entrees
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);

(async () => {
  const e = require('./services/entreeService');
  console.log('\n1. Règles (sans base)');
  ok(e.semaineDe('2026-01-02') === '2026-01-02' && e.semaineDe('2026-01-08') === '2026-01-02', 'semaine du vendredi au jeudi');
  ok(e.semaineDe('2026-01-09') === '2026-01-09' && e.semaineDe('2026-01-10') === '2026-01-09', 'un vendredi ouvre la semaine suivante ; le samedi la suit');
  ok(e.semaineDe('2026-02-30') === null, 'date impossible : pas de semaine');
  ok(e.actesDe('1963-1964-1965').join() === '1963,1964,1965', 'actes séparés par des tirets');
  ok(e.actesDe('71 à 74').join() === '71,72,73,74', 'plage « 71 à 74 »');
  ok(e.actesDe('2026/58').join() === '58' && e.actesDe(16638).join() === '16638', '« 2026/58 » : l\'année n\'est pas un acte');
  ok(e.lettreDe('Éts Lumière') === 'E' && e.lettreDe('2HR') === '#' && e.lettreDe('') === null, 'lettre de classement');
  ok(e.paques(2026).toISOString().slice(0, 10) === '2026-04-05' && e.paques(2025).toISOString().slice(0, 10) === '2025-04-20', 'Pâques');
  const routes = require('./routes/entreeRoutes');
  ok(routes.stack.some((l) => l.route?.path === '/import') && routes.stack.some((l) => l.route?.path === '/recherche'), 'routes déclarées');
  ok(e.nomSimple('Éts Agro-Fictive SARL') === 'agro fictive' && e.nomSimple('SA') === 'sa', 'nom simplifié : accents, ponctuation, forme juridique');
  ok(e.acteDemande('2026/58').annee === 2026 && e.acteDemande('2026/58').numeros.join() === '58' && e.acteDemande('71 à 72').numeros.join() === '71,72', 'n° d\'acte demandé');
  ok(e.acteDemande('CBE-2026-0058').numeros.join() === '58' && e.acteDemande('CBE-2026-0058').annee === 2026 && e.acteDemande('1963-1964').numeros.join() === '1963,1964', 'acte « CBE-2026-0058 » : 58 de 2026 ; « 1963-1964 » : deux actes');
  const presenceRoute = routes.stack.findIndex((l) => l.route?.path === '/presence');
  const garde = routes.stack.findIndex((l) => !l.route);
  ok(presenceRoute >= 0 && presenceRoute < garde, 'présence : ouverte aux demandeurs, avant la garde de l\'archive');

  if (!avecBase) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test entrées ${s}`, `test-entrees-${s}`])).rows[0].id;
    const u = (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Archiviste', $3, 'archiviste') RETURNING id, full_name", [t, `a-${s}`, `a-${s}@exemple.test`])).rows[0];
    const lignes = [
      { date: '2026-01-02', rubrique: 'Cautions et garanties', ordre: 1, actes: '1963-1964', denomination: 'Zénith Fictif', type: 'CBE', montant: 2300000, agent: 'Aline' },
      { date: '2026-01-05', rubrique: 'Cautions et garanties', ordre: 1, actes: '71 à 73', denomination: 'agro fictive', type: 'CM/S+ATT', agent: 'Rosalie' },
      { date: '2026-01-08', rubrique: 'Attestations / opérations banalisées', ordre: 2, actes: '58', denomination: 'Bâtiments Fictifs', type: 'ATT', agent: 'ALINE' },
      { date: '2026-01-09', rubrique: 'Attestations / opérations banalisées', ordre: 1, actes: '90', denomination: 'Cabinet Fictif', type: 'ATT' },
      { date: '2026-01-09', ordre: 9 },
      { date: 'pas une date', denomination: 'X' },
    ];
    const r1 = await e.importer(t, u, { fichier: 'point.xlsx', lignes });
    ok(r1.ajoutees === 4 && r1.rejetees === 2, 'import : 4 dossiers, 2 lignes sans nom ni acte ou sans date écartées');
    const r2 = await e.importer(t, u, { fichier: 'point.xlsx', lignes });
    ok(r2.ajoutees === 0 && r2.deja === 4, 'réimport : rien en double');
    const sem = await e.semaines(t, { annee: 2026 });
    ok(sem.map((x) => `${x.semaine}:${x.dossiers}`).join() === '2026-01-09:1,2026-01-02:3', 'deux semaines de production, comptes justes');
    const premiere = sem.find((x) => x.semaine === '2026-01-02');
    ok(premiere.au === '2026-01-08' && premiere.jours_ouvres.join() === '2026-01-02,2026-01-05,2026-01-06,2026-01-07,2026-01-08', 'jours ouvrés du vendredi au jeudi');
    const w = await e.semaine(t, '2026-01-07');
    ok(w.semaine === '2026-01-02' && w.dossiers.map((d) => d.denomination).join('|') === 'agro fictive|Bâtiments Fictifs|Zénith Fictif', 'classement par lettre, n\'importe quel jour de la semaine');
    ok((await e.rechercher(t, { q: '72' })).map((d) => d.denomination).join() === 'agro fictive', 'acte 72 retrouvé dans « 71 à 73 »');
    ok((await e.rechercher(t, { q: '96' })).length === 0 && (await e.rechercher(t, { q: '1964' })).length === 1, 'un numéro : l\'acte exact seulement');
    ok((await e.rechercher(t, { q: '2026/58' })).length === 1 && (await e.rechercher(t, { q: '2025/58' })).length === 0, 'acte « 2026/58 » : année et numéro');
    ok((await e.rechercher(t, { q: 'fictif' })).length === 3 && (await e.rechercher(t, { agent: 'aline' })).length === 2, 'recherche par nom et par agent');
    ok((await e.rechercher(t, { type: 'ATT', du: '2026-01-09' })).length === 1, 'recherche par type et période');
    let refus = null; try { await e.rechercher(t, {}); } catch (err) { refus = err.statut; }
    ok(refus === 400, 'recherche vide : 400');
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'jours_feries', '01-06')", [t]);
    require('./services/settingsService').invalidate(t);
    ok((await e.semaines(t, { annee: 2026 })).find((x) => x.semaine === '2026-01-02').feries.join() === '2026-01-06', 'jour férié réglé : retiré des jours ouvrés');
    ok((await e.feriesDe(t, 2026)).has('2026-04-06'), 'lundi de Pâques compté d\'office');
    ok((await e.filtres(t)).types.length === 3, 'filtres : types présents');

    console.log('\n3. Présence d\'un dossier demandé');
    const p1 = await e.presence(t, { nom_entreprise: 'Agro Fictive', num_acte: '2026/72' });
    ok(p1.total === 1 && p1.entrees[0].semaine === '2026-01-02' && p1.entrees[0].au === '2026-01-08' && p1.entrees[0].date_point === '2026-01-05' && p1.entrees[0].nom_concorde, 'acte 2026/72 : semaine du 2 au 8 janvier, point du 5');
    ok(p1.entrees[0].montant === undefined && p1.entrees[0].agent === undefined, 'ni montant ni agent rendus au demandeur');
    const p2 = await e.presence(t, { nom_entreprise: 'ETS ZENITH FICTIF SARL' });
    ok(p2.total === 1 && p2.entrees[0].denomination === 'Zénith Fictif', 'par nom : accents, majuscules et forme juridique ignorés');
    ok((await e.presence(t, { nom_entreprise: 'Zenit Fictif' })).total === 1, 'par nom : une faute de frappe tolérée');
    ok((await e.presence(t, { nom_entreprise: 'Zénith Fictif', annee: '2024' })).total === 0, 'année : 2024 ne ramène pas un point de 2026');
    ok((await e.presence(t, { nom_entreprise: 'Zénith Fictif', annee: '2025' })).total === 1, 'année : l\'acte de 2025 retiré en 2026 est retrouvé');
    ok((await e.presence(t, { num_acte: '2024/72' })).total === 0 && (await e.presence(t, { num_acte: '2026/96' })).total === 0, 'acte d\'une autre année ou inconnu : absent');
    const p3 = await e.presence(t, { nom_entreprise: 'Société Inconnue', num_acte: '58' });
    ok(p3.total === 1 && p3.entrees[0].nom_concorde === false, 'acte trouvé sous un autre nom : signalé');
    ok((await e.presence(t, { nom_entreprise: 'Inexistante Holding' })).total === 0, 'nom absent : non trouvé');
    const p4 = await e.presence(t, { nom_entreprise: 'Cabinet Fictif', num_acte: '58' });
    ok(p4.total === 1 && p4.entrees[0].denomination === 'Cabinet Fictif' && p4.entrees[0].nom_concorde, 'acte sous un autre nom mais nom présent : le nom l\'emporte');
    ok((await e.presence(t, { nom_entreprise: 'ab' })).recherche === false, 'trop peu pour chercher');
    const lot = await e.presences(t, [{ cle: 'a', num_acte: '1964' }, { cle: 'b', nom_entreprise: 'Cabinet Fictif' }]);
    ok(lot.a.total === 1 && lot.b.entrees[0].semaine === '2026-01-09', 'plusieurs d\'un coup');
    let trop = null; try { await e.presences(t, Array(e.MAX_PRESENCES + 1).fill({})); } catch (err) { trop = err.statut; }
    ok(trop === 400, 'au plus 200 dossiers à la fois');
  }
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
