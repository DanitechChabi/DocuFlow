// ============================================================================
// douchette.test.js — étiquettes à code-barres, sorties et retours (053).
// 1. Sans base : code d'étiquette.
// 2. Avec base : un scan retrouve les demandes qui visent le dossier (même
//    acte, ou même nom), transmet, puis retrouve le prêt au retour.
// Exécution : npm run test:douchette
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const rejette = async (p, statut, nom) => {
  try { await p; ok(false, `${nom} (aucune erreur)`); } catch (err) { ok(err.statut === statut, `${nom}${err.statut === statut ? '' : ` (obtenu ${err.statut || err.message})`}`); }
};
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);

(async () => {
  const d = require('./services/douchetteService');
  console.log('\n1. Code d\'étiquette (sans base)');
  ok(d.codeDe(1234) === 'D0001234' && d.lireCode('D0001234') === 1234 && d.lireCode(' d0001234 ') === 1234, 'D0001234 ⇄ 1234 (minuscules et espaces tolérés)');
  ok(d.lireCode('2479') === null && d.lireCode('DX12') === null && d.lireCode('') === null, 'un n° d\'acte n\'est pas une étiquette');
  const routes = require('./routes/entreeRoutes');
  ok(['/douchette', '/douchette/sortie', '/douchette/retour'].every((p) => routes.stack.some((l) => l.route?.path === p)), 'routes déclarées');

  if (!avecBase) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ');
  } else {
    console.log('\n2. Scan, sortie, retour (PostgreSQL)');
    const db = require('./config/db');
    const e = require('./services/entreeService');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test douchette ${s}`, `test-douchette-${s}`])).rows[0].id;
    await require('./services/roleService').provisionRoles(t);
    const compte = async (role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, full_name, role, tenant_id",
      [t, `${nom}-${s}`, nom, `${nom.toLowerCase()}-${s}@exemple.test`, role])).rows[0];
    const archiviste = await compte('archiviste', 'Carine');
    const agent = await compte('demandeur', 'Nadia');
    await e.importer(t, archiviste, { fichier: 'point.xlsx', lignes: [
      { date: '2026-01-05', ordre: 1, actes: '58', denomination: 'AGRO FICTIVE SARL', type: 'CBE' },
      { date: '2026-01-06', ordre: 2, actes: '71 à 73', denomination: 'Bravo Fictif' },
      { date: '2025-03-03', ordre: 1, actes: '58', denomination: 'Autre Fictif' },
    ] });
    const ids = Object.fromEntries((await db.query('SELECT id, denomination FROM dossiers_entres WHERE tenant_id = $1', [t])).rows.map((x) => [x.denomination, x.id]));
    const demande = async (champs) => (await db.query(
      "INSERT INTO requests (id_user, nom_entreprise, num_acte, motif, statut, tenant_id) VALUES ($1, $2, $3, 'Consultation', 'en attente', $4) RETURNING id",
      [agent.id, champs.nom || null, champs.acte || null, t])).rows[0].id;
    const r1 = await demande({ nom: 'Agro Fictive', acte: '2026/58' });
    const r2 = await demande({ nom: 'Bravo Fictif' });
    const r3 = await demande({ nom: 'Agro Fictive', acte: '99' });
    await demande({ nom: 'Société Inconnue' });

    const codeAgro = d.codeDe(ids['AGRO FICTIVE SARL']);
    const l1 = await d.lire(t, codeAgro);
    ok(l1.dossier.denomination === 'AGRO FICTIVE SARL' && l1.dossier.code === codeAgro && l1.dossier.semaine === '2026-01-02', 'scan : le dossier, sa semaine, son code');
    ok(l1.demandes.map((x) => x.id).join() === String(r1) && l1.sorties.length === 0, 'demande visée par le même acte ; une demande au même nom mais à un AUTRE acte écartée');
    ok(!l1.demandes.some((x) => x.id === r3), 'acte contradictoire : autre dossier');
    const l2 = await d.lire(t, d.codeDe(ids['Bravo Fictif']));
    ok(l2.demandes.map((x) => x.id).join() === String(r2), 'sans acte : la demande au même nom');
    const choix = await d.lire(t, '58');
    ok(choix.choix && choix.choix.length === 2, 'acte tapé à la main présent dans deux dossiers : la liste pour choisir');
    ok((await d.lire(t, '2026/58')).dossier.id === ids['AGRO FICTIVE SARL'], '« 2026/58 » : le bon dossier');
    await rejette(d.lire(t, 'D9999999'), 404, 'étiquette inconnue : 404');
    await rejette(d.lire(t, 'n\'importe quoi'), 400, 'code illisible : 400');

    await rejette(d.sortir(t, archiviste, { dossier_entre_id: ids['Bravo Fictif'], request_id: r1 }), 409, 'demande qui ne vise pas ce dossier : 409');
    const sortie = await d.sortir(t, archiviste, { dossier_entre_id: ids['AGRO FICTIVE SARL'], request_id: r1 });
    ok(sortie.pret && sortie.pret.date_retour_prevue, 'transmis : prêt créé avec sa date de retour');
    const l3 = await d.lire(t, codeAgro);
    ok(l3.sorties.length === 1 && l3.sorties[0].id === r1 && l3.sorties[0].dossier_entre_id === ids['AGRO FICTIVE SARL'] && l3.demandes.length === 0, 'rescan : dossier sorti, chez qui');
    await rejette(d.sortir(t, archiviste, { dossier_entre_id: ids['AGRO FICTIVE SARL'], request_id: r1 }), 409, 'déjà sorti : 409');
    await d.rentrer(t, archiviste, { request_id: r1 });
    ok((await d.lire(t, codeAgro)).sorties.length === 0, 'retour : le dossier n\'est plus sorti');

    // Sorti sans la douchette (« Transmettre » dans À traiter) : retrouvé au scan par le nom.
    await require('./services/loanService').remettre(t, r2, archiviste, {});
    const l4 = await d.lire(t, d.codeDe(ids['Bravo Fictif']));
    ok(l4.sorties.length === 1 && l4.sorties[0].id === r2, 'sortie faite sans douchette : retrouvée au scan');
    await d.rentrer(t, archiviste, { request_id: r2 });
    ok((await d.lire(t, d.codeDe(ids['Bravo Fictif']))).sorties.length === 0, 'et rentrée à la douchette');

    console.log('\n3. Tableau de bord');
    const tb = require('./services/tableauBordService');
    const aujourdHui = new Date().toISOString().slice(0, 10);
    const r = await tb.tableau(t, { du: '2025-01-01', au: aujourdHui });
    ok(r.demandes.recues === 4 && r.demandes.servies === 2 && r.demandes.en_attente === 2, 'demandes : 4 reçues, 2 servies, 2 en attente');
    ok(r.departements.length === 1 && r.departements[0].n === 4 && r.motifs[0].nom === 'Consultation', 'par département et par motif');
    ok(r.delai.n === 2 && r.delai.en_24h === 2, 'délai de traitement : 2 sorties, toutes en moins de 24 h');
    ok(r.entrees_total === 3 && r.entrees_par_semaine.length === 2, 'dossiers entrés par semaine de production');
    ok(r.demandes_par_semaine.reduce((n, x) => n + x.n, 0) === 4, 'demandes par semaine : le total retombe juste');
    ok(Array.isArray(r.retards) && r.retards.length === 0, 'aucun retard');
    let inv = null; try { tb.periode({ du: '2026-02-01', au: '2026-01-01' }); } catch (err) { inv = err.statut; }
    ok(inv === 400 && tb.periode({}, new Date('2026-11-16T10:00:00Z')).du === '2026-11-01', 'période inversée : 400 ; par défaut : le mois en cours');
  }
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
