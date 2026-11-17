// ============================================================================
// comptes.test.js — gestion des comptes (054) et dossiers servis par M-Files.
// Exécution : npm run test:comptes (base de TEST : organisation jetable).
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const rejette = async (p, statut, nom) => {
  try { await p; ok(false, `${nom} (aucune erreur)`); } catch (err) { ok(err.statut === statut, `${nom}${err.statut === statut ? '' : ` (obtenu ${err.statut || err.message})`}`); }
};
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);

(async () => {
  const mf = require('./services/mfilesService');
  console.log('\n1. Règles (sans base)');
  ok(mf.lireAnnees('2025, 2024;x 1800').join() === '2025,2024' && mf.lireAnnees('').length === 0, 'années numérisées lues');
  const routes = require('./routes/comptesRoutes');
  ok(['/', '/:id', '/:id/desactivation', '/:id/reactivation', '/:id/mot-de-passe'].every((p) => routes.stack.some((l) => l.route?.path === p)), 'routes des comptes');

  if (!avecBase) { console.log('\n2. Sur PostgreSQL — SAUTÉ'); } else {
    console.log('\n2. Comptes (PostgreSQL)');
    const db = require('./config/db');
    const bcrypt = require('bcryptjs');
    const c = require('./services/comptesService');
    const roleService = require('./services/roleService');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test comptes ${s}`, `test-comptes-${s}`])).rows[0].id;
    await roleService.provisionRoles(t);
    const compte = async (role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, full_name, role, tenant_id",
      [t, `${nom}-${s}`, await bcrypt.hash('Ancien1234!', 4), nom, `${nom.toLowerCase()}-${s}@exemple.test`, role])).rows[0];
    const admin = await compte('admin', 'Admin');
    const agent = await compte('demandeur', 'Nadia');
    const autre = await compte('demandeur', 'Marc');

    const l = await c.lister(t);
    ok(l.comptes.length === 3 && l.roles.some((r) => r.cle === 'archiviste') && !l.roles.some((r) => r.cle === 'superadmin'), 'liste des comptes et rôles attribuables (sans superadmin)');
    await c.modifier(t, admin, agent.id, { role: 'archiviste', section: 'DE — Engagement' });
    const lu = (await db.query('SELECT role, section, token_version FROM users WHERE id = $1', [agent.id])).rows[0];
    ok(lu.role === 'archiviste' && lu.section === 'DE — Engagement' && lu.token_version >= 1, 'rôle et département changés ; sessions renouvelées');
    await rejette(c.modifier(t, admin, admin.id, { role: 'demandeur' }), 400, 'son propre rôle : 400');
    await rejette(c.modifier(t, admin, agent.id, { role: 'inconnu' }), 400, 'rôle inconnu : 400');
    await rejette(c.modifier(t, admin, agent.id, { email: 'pas-une-adresse' }), 400, 'adresse invalide : 400');
    await rejette(c.modifier(t, admin, agent.id, { email: `marc-${s}@exemple.test` }), 409, 'adresse déjà prise : 409');

    roleService.invalidateUser(autre.id);
    ok((await roleService.getUserAuth(autre.id)) !== null, 'compte actif : session acceptée');
    await c.activer(t, admin, autre.id, false);
    ok((await roleService.getUserAuth(autre.id)) === null, 'désactivé : sessions refusées');
    const auth = require('./controllers/authController');
    const appel = (h, req) => new Promise((resolve) => { const res = { code: 200, status(x) { this.code = x; return this; }, json(b) { resolve({ code: this.code, body: b }); } }; h(req, res); });
    const refus = await appel(auth.login, { body: { username: `Marc-${s}`, password: 'Ancien1234!', tenant_slug: `test-comptes-${s}` } });
    ok(refus.code === 403 && refus.body.code === 'COMPTE_DESACTIVE', 'désactivé : connexion refusée avec un message clair');
    ok((await c.lister(t)).comptes.at(-1).id === autre.id, 'désactivés en fin de liste');
    await c.activer(t, admin, autre.id, true);
    const acces = await appel(auth.login, { body: { username: `Marc-${s}`, password: 'Ancien1234!', tenant_slug: `test-comptes-${s}` } });
    ok(acces.code === 200 && acces.body.token, 'réactivé : il se reconnecte');
    await rejette(c.activer(t, admin, admin.id, false), 400, 'se désactiver soi-même : 400');

    const { mot_de_passe: mdp } = await c.motDePasseProvisoire(t, admin, autre.id);
    const h = (await db.query('SELECT password_hash FROM users WHERE id = $1', [autre.id])).rows[0].password_hash;
    ok(mdp.length === 10 && !/[0O1lI]/.test(mdp) && await bcrypt.compare(mdp, h) && !(await bcrypt.compare('Ancien1234!', h)), 'mot de passe provisoire : lisible, remplace l\'ancien');

    console.log('\n3. Servi par M-Files');
    const demande = async (statut = 'en attente') => (await db.query(
      "INSERT INTO requests (id_user, nom_entreprise, annee, motif, statut, tenant_id) VALUES ($1, 'Agro Fictive', 2025, 'Consultation', $2, $3) RETURNING id",
      [autre.id, statut, t])).rows[0].id;
    const d1 = await demande();
    const r = await mf.servir(t, admin, d1, { note: 'Envoyé à 10 h' });
    ok(r.statut === 'livré' && (await db.query('SELECT statut, date_livraison FROM requests WHERE id = $1', [d1])).rows[0].date_livraison, 'servie : demande close');
    ok((await db.query("SELECT 1 FROM notifications WHERE id_user = $1 AND request_id = $2", [autre.id, d1])).rowCount === 1, 'le demandeur est prévenu');
    await rejette(mf.servir(t, admin, d1), 409, 'déjà servie : 409');
    await rejette(mf.servir(t, admin, await demande('a completer')), 409, 'à compléter : 409');
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'mfiles_annees', '2025, 2024')", [t]);
    require('./services/settingsService').invalidate(t);
    ok((await mf.annees(t)).join() === '2025,2024', 'réglage des années numérisées');
  }
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
