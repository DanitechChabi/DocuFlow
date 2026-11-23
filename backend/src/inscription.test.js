// ============================================================================
// inscription.test.js — inscription et connexion dans un espace (édition AFGC).
//
// 1. SANS BASE : routes déclarées, contrôles de saisie avant toute requête.
// 2. AVEC BASE (si DB_HOST ou DATABASE_URL est défini) : départements publics
//    d'un espace, adresses professionnelles admises, département créé en
//    s'inscrivant (si l'organisation le permet), connexion par l'adresse.
//    Une organisation jetable est créée à chaque exécution — à lancer sur une
//    base de TEST, jamais de production.
//
// Exécution : npm run test:inscription
// ============================================================================
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret-de-test';

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => {
  verifs += 1;
  console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`);
  if (!cond) echecs += 1;
};

const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);

/** Appelle un contrôleur Express et rend { code, body }. */
const appel = (handler, req) => new Promise((resolve) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(body) { resolve({ code: this.code, body }); } };
  Promise.resolve(handler({ params: {}, query: {}, ip: '127.0.0.1', ...req }, res)).catch((e) => resolve({ code: 'exception', body: e }));
});

(async () => {
  const auth = require('./controllers/authController');

  console.log('\n1. Routes et contrôles de saisie (sans base)');
  {
    const routes = require('./routes/authRoutes');
    const chemin = (m, p) => routes.stack.find((l) => l.route && l.route.path === p && l.route.methods[m]);
    ok(Boolean(chemin('get', '/company/:slug/departements')), 'route publique GET /auth/company/:slug/departements');
    ok(chemin('post', '/register')?.route.stack.length === 2, 'inscription : limitée en débit, puis le contrôleur');
    const sans = (corps) => appel(auth.register, { body: { username: 'a.b', full_name: 'A B', email: 'a.b@exemple.test', password: 'Fictif-Sesame-2026', ...corps } });
    ok((await sans({ password: '' })).code === 400, 'sans mot de passe : 400');
    ok((await sans({ username: '  ' })).code === 400, 'sans identifiant : 400');
    const r = await sans({ full_name: ' ' });
    ok(r.code === 400 && /nom complet/.test(r.body.message), 'sans nom complet : 400, message clair');
    ok((await sans({ email: 'pas-une-adresse' })).code === 400, 'adresse invalide : 400');
    ok((await sans({ email: '  ' })).code === 400, 'sans adresse : 400 (et non une erreur de la base)');
  }

  if (!avecBase) {
    console.log('\n2. Inscription et connexion sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Inscription et connexion sur PostgreSQL');
    const db = require('./config/db');
    const settingsService = require('./services/settingsService');
    const s = Date.now();
    const slug = `test-inscription-${s}`;
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test inscription ${s}`, slug])).rows[0].id;
    await db.query("INSERT INTO sections (tenant_id, name) VALUES ($1, 'DE — Engagement'), ($1, 'DC — Commercial'), ($1, 'Contrôle de gestion')", [t]);
    const reglage = async (cle, valeur) => {
      await db.query(
        `INSERT INTO settings (tenant_id, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [t, cle, valeur]
      );
      settingsService.invalidate(t);
    };

    // --- Départements publics ---
    const dep = await appel(auth.departementsPublics, { params: { slug } });
    ok(dep.code === 200 && dep.body.departements.map((d) => d.name).join('|') === 'Contrôle de gestion|DC — Commercial|DE — Engagement',
      'départements de l\'espace, dans l\'ordre alphabétique');
    ok(dep.body.creation === false && dep.body.domaines.length === 0, 'par défaut : pas de création, toute adresse');
    ok(Object.keys(dep.body.departements[0]).sort().join() === 'id,name', 'rien d\'autre que le nom (et l\'identifiant) d\'un département');
    ok((await appel(auth.departementsPublics, { params: { slug: 'espace-inexistant' } })).code === 404, 'espace inconnu : 404');

    // --- Inscription simple ---
    const inscrire = (corps) => appel(auth.register, {
      body: { tenant_slug: slug, password: 'Fictif-Sesame-2026', ...corps },
    });
    const r1 = await inscrire({ username: 'e.kpadonou', full_name: 'Éric Kpadonou', email: 'E.Kpadonou@Exemple-Afgc.test', section: 'DE — Engagement' });
    ok(r1.code === 201 && r1.body.user.role === 'demandeur', 'inscription : compte demandeur créé');
    const u1 = (await db.query('SELECT section, email FROM users WHERE id = $1', [r1.body.user.id])).rows[0];
    ok(u1.section === 'DE — Engagement' && u1.email === 'E.Kpadonou@Exemple-Afgc.test', 'département et adresse enregistrés');
    ok((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE id_user = $1 AND action LIKE 'S''est inscrit (département : DE — Engagement)%'", [r1.body.user.id])).rows[0].n === 1,
      'inscription inscrite au journal d\'audit');
    ok((await inscrire({ username: 'autre', full_name: 'Autre', email: 'e.kpadonou@exemple-afgc.test' })).code === 400, 'adresse déjà utilisée (casse indifférente) : 400');
    ok((await inscrire({ username: 'e.kpadonou', full_name: 'Autre', email: 'x@exemple-afgc.test' })).code === 400, 'identifiant déjà pris : 400');

    // --- Adresses professionnelles ---
    await reglage('registration_email_domains', 'exemple-afgc.test, @afgc-bis.test');
    ok((await appel(auth.departementsPublics, { params: { slug } })).body.domaines.join() === 'exemple-afgc.test,afgc-bis.test', 'domaines admis publiés (sans « @ »)');
    const r2 = await inscrire({ username: 'n.zinsou', full_name: 'Nadia Zinsou', email: 'nadia@gmail.com', section: 'DC — Commercial' });
    ok(r2.code === 400 && /@exemple-afgc\.test ou @afgc-bis\.test/.test(r2.body.message), 'adresse personnelle refusée, domaines rappelés');
    ok((await inscrire({ username: 'n.zinsou', full_name: 'Nadia Zinsou', section: 'DC — Commercial' })).code === 400, 'sans adresse, alors que les domaines sont fixés : 400');
    ok((await inscrire({ username: 'n.zinsou', full_name: 'Nadia Zinsou', email: 'n.zinsou@AFGC-BIS.test', section: 'DC — Commercial' })).code === 201,
      'adresse d\'un domaine admis (casse indifférente) : 201');

    // --- Département créé en s'inscrivant ---
    const r3 = await inscrire({ username: 'm.agossou', full_name: 'Marc Agossou', email: 'm.agossou@exemple-afgc.test', section: 'DSI — Systèmes d\'information', nouveau_departement: true });
    ok(r3.code === 403, 'créer son département sans que l\'organisation le permette : 403');
    ok((await db.query("SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND username = 'm.agossou'", [t])).rows[0].n === 0, 'refus : aucun compte créé');
    await reglage('registration_new_department', 'true');
    ok((await appel(auth.departementsPublics, { params: { slug } })).body.creation === true, 'création permise : annoncée à la page d\'inscription');
    ok((await inscrire({ username: 'm.agossou', full_name: 'Marc Agossou', email: 'm.agossou@exemple-afgc.test', section: ' x ', nouveau_departement: true })).code === 400,
      'nom de département trop court : 400');
    const r4 = await inscrire({ username: 'm.agossou', full_name: 'Marc Agossou', email: 'm.agossou@exemple-afgc.test', section: '  DSI —  Systèmes d\'information ', nouveau_departement: true });
    ok(r4.code === 201, 'département absent créé en s\'inscrivant');
    ok((await db.query("SELECT count(*)::int AS n FROM sections WHERE tenant_id = $1 AND name = 'DSI — Systèmes d''information'", [t])).rows[0].n === 1,
      'le département rejoint la liste (espaces superflus retirés)');
    ok((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE id_user = $1 AND action LIKE '%a créé le département « DSI — Systèmes d''information »'", [r4.body.user.id])).rows[0].n === 1,
      'création du département inscrite au journal');
    const r5 = await inscrire({ username: 'f.houngbo', full_name: 'Fifamè Houngbo', email: 'f.houngbo@exemple-afgc.test', section: 'dsi — systèmes d\'information', nouveau_departement: true });
    ok(r5.code === 201 && (await db.query('SELECT section FROM users WHERE id = $1', [r5.body.user.id])).rows[0].section === 'DSI — Systèmes d\'information',
      'département déjà créé : repris tel qu\'il est écrit, sans doublon');
    ok((await db.query("SELECT count(*)::int AS n FROM sections WHERE tenant_id = $1 AND lower(name) = lower('DSI — Systèmes d''information')", [t])).rows[0].n === 1,
      'un seul département « DSI »');

    // --- Connexion : identifiant ou adresse ---
    const connecter = (username, password = 'Fictif-Sesame-2026', tenant = slug) => appel(auth.login, { body: { username, password, tenant_slug: tenant } });
    const c1 = await connecter('e.kpadonou');
    ok(c1.code === 200 && c1.body.token && c1.body.user.section === 'DE — Engagement', 'connexion par l\'identifiant');
    const c2 = await connecter('  e.KPADONOU@exemple-afgc.test ');
    ok(c2.code === 200 && c2.body.user.username === 'e.kpadonou', 'connexion par l\'adresse professionnelle (casse et espaces indifférents)');
    ok((await connecter('e.kpadonou@exemple-afgc.test', 'mauvais-mdp')).code === 400, 'adresse, mauvais mot de passe : 400');
    ok((await connecter('inconnu@exemple-afgc.test')).code === 400, 'adresse inconnue : 400');
    ok((await appel(auth.login, { body: { username: 'e.kpadonou@exemple-afgc.test', password: 'Fictif-Sesame-2026' } })).code === 400,
      'hors d\'un espace, l\'adresse ne sert pas d\'identifiant');
    // Deux comptes anciens partageant une adresse : on demande l'identifiant.
    await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) SELECT $1, 'double', password_hash, 'Double', 'partage@exemple-afgc.test', 'demandeur' FROM users WHERE id = $2", [t, r1.body.user.id]);
    await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) SELECT $1, 'double2', password_hash, 'Double 2', 'PARTAGE@exemple-afgc.test', 'demandeur' FROM users WHERE id = $2", [t, r1.body.user.id]);
    const c3 = await connecter('partage@exemple-afgc.test');
    ok(c3.code === 400 && /identifiant/.test(c3.body.message), 'adresse partagée par deux comptes : on demande l\'identifiant');

    // --- Préréglage AFGC : la création du département est permise ---
    const t2 = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test préréglage ${s}`, `test-prereglage-${s}`])).rows[0].id;
    const admin = (await db.query(`INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Admin', $3, 'admin') RETURNING id, full_name`, [t2, `adm-${s}`, `adm-${s}@exemple.test`])).rows[0];
    const editionService = require('./services/editionService');
    await editionService.appliquer(t2, admin, 'afgc');
    ok((await settingsService.get(t2, 'registration_new_department', false)) === true, 'configuration AFGC : un agent peut créer son département en s\'inscrivant');
    ok((await settingsService.get(t2, 'registration_email_domains', '')) === 'afgcsa.com', 'configuration AFGC : seules les adresses @afgcsa.com sont admises');
    // Un choix de l'administrateur n'est pas écrasé par une nouvelle application.
    await db.query("UPDATE settings SET value = 'false' WHERE tenant_id = $1 AND key = 'registration_new_department'", [t2]);
    await db.query("UPDATE settings SET value = 'afgcsa.com, afgc-groupe.test' WHERE tenant_id = $1 AND key = 'registration_email_domains'", [t2]);
    settingsService.invalidate(t2);
    await editionService.appliquer(t2, admin, 'afgc');
    ok((await settingsService.get(t2, 'registration_new_department', true)) === false
      && (await settingsService.get(t2, 'registration_email_domains', '')) === 'afgcsa.com, afgc-groupe.test',
      'nouvelle application : les réglages choisis par l\'administrateur restent');
  }

  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
