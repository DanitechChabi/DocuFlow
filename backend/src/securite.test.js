// ============================================================================
// securite.test.js — sécurité des comptes et réponses d'erreur (061).
// Démarre le serveur sur un port libre et l'interroge comme un navigateur.
// Exécution : npm run test:securite (base requise pour la partie 2).
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);

(async () => {
  console.log('\n1. Règles (sans serveur)');
  const settings = require('./services/settingsService');
  const pol = { validate: (await settings.getPasswordPolicy(null).catch(() => null))?.validate };
  if (!pol.validate) {
    // Base absente : la politique par défaut (8 caractères) est construite sans réglages.
    pol.validate = (await settings.getPasswordPolicy(0)).validate;
  }
  ok(/identifiant/.test(pol.validate('l.mensah2026', { identifiant: 'l.mensah' }) || ''), 'mot de passe contenant l\'identifiant refusé');
  ok(/nom/.test(pol.validate('Laurent!2026x', { identifiant: 'l.m', nom: 'Laurent Collins' }) || ''), 'mot de passe contenant le nom refusé');
  ok(/courant/.test(pol.validate('azertyuiop') || '') && /courant/.test(pol.validate('aaaaaaaaa') || ''), 'mots de passe courants refusés');
  ok(pol.validate('Mon-cafe-de-7h30', { identifiant: 'l.mensah', nom: 'Laurent Mensah' }) === null, 'une phrase personnelle acceptée');
  const t = require('./helpers/tentativesConnexion');
  const req = { ip: '10.0.0.9', headers: {}, socket: {} };
  for (let i = 0; i < 4; i += 1) t.echec(req, 'x.test');
  ok(t.bloque(req, 'x.test') === 0, '4 échecs : pas encore bloqué');
  t.echec(req, 'x.test');
  ok(t.bloque(req, 'x.test') === 15 && t.bloque(req, 'autre') === 0, '5e échec : identifiant bloqué 15 min, pas les autres');
  ok(t.bloque({ ...req, ip: '10.0.0.10' }, 'x.test') === 0, 'depuis une autre adresse : pas bloqué');
  t._echecs.clear();

  if (!avecBase) { console.log('\n2. Serveur — SAUTÉ (pas de base)'); } else {
    console.log('\n2. Serveur');
    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';
    const { server } = require('./app');
    await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const appel = async (m, chemin, corps, jeton) => {
      const r = await fetch(base + chemin, { method: m, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) }, body: corps ? JSON.stringify(corps) : undefined });
      return { statut: r.status, entetes: r.headers, corps: await r.json().catch(() => null) };
    };
    const db = require('./config/db');
    const bcrypt = require('bcryptjs');
    const s = Date.now();
    const slug = `test-secu-${s}`;
    const tid = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test sécurité ${s}`, slug])).rows[0].id;
    await require('./services/roleService').provisionRoles(tid);
    const ident = `p.essai${s}`;
    await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, $3, 'Paul Essai', $4, 'demandeur')",
      [tid, ident, await bcrypt.hash(ident, 10), `${ident}@exemple.test`]);

    const h = await appel('GET', '/health');
    ok(h.entetes.get('x-content-type-options') === 'nosniff' && !h.entetes.get('x-powered-by'), 'en-têtes de sécurité, sans « X-Powered-By »');
    const inconnu = await appel('GET', '/nimporte-quoi');
    ok(inconnu.statut === 404 && inconnu.corps?.code === 'ADRESSE_INCONNUE', 'adresse d\'API inconnue : 404 en clair');

    // Mot de passe = identifiant : connexion, puis changement exigé.
    const c1 = await appel('POST', '/auth/login', { username: ident, password: ident, tenant_slug: slug });
    ok(c1.statut === 200 && c1.corps.user.mdp_a_changer === true, 'mot de passe égal à l\'identifiant : à changer');
    const jeton = c1.corps.token;
    const bloque = await appel('GET', '/requests/my-requests', null, jeton);
    ok(bloque.statut === 403 && bloque.corps.code === 'MDP_A_CHANGER', 'avant le changement : le reste est fermé');
    const faible = await appel('PUT', '/users/profile/password', { current_password: ident, new_password: `${ident}!` }, jeton);
    ok(faible.statut === 400 && /identifiant/.test(faible.corps.message), 'nouveau mot de passe trop proche de l\'identifiant : refusé');
    const bon = await appel('PUT', '/users/profile/password', { current_password: ident, new_password: 'Mon-cafe-de-7h30' }, jeton);
    ok(bon.statut === 200, 'mot de passe personnel accepté');
    ok((await appel('GET', '/requests/my-requests', null, jeton)).statut === 200, 'après le changement : l\'application s\'ouvre');
    const c2 = await appel('POST', '/auth/login', { username: ident, password: 'Mon-cafe-de-7h30', tenant_slug: slug });
    ok(c2.statut === 200 && c2.corps.user.mdp_a_changer === false, 'reconnexion : plus rien à changer');

    // Essais répétés.
    let dernier;
    for (let i = 0; i < 5; i += 1) dernier = await appel('POST', '/auth/login', { username: ident, password: `faux-${i}`, tenant_slug: slug });
    const apres = await appel('POST', '/auth/login', { username: ident, password: 'Mon-cafe-de-7h30', tenant_slug: slug });
    ok(dernier.statut === 400 && apres.statut === 429 && /15 minutes/.test(apres.corps.message), 'cinq échecs : connexion bloquée 15 minutes, même avec le bon mot de passe');
    const expire = await appel('GET', '/requests/my-requests', null, 'jeton.faux.x');
    ok(expire.statut === 401 && expire.corps.code === 'SESSION_EXPIREE', 'jeton invalide : 401 « session expirée »');

    // Rappel la veille du retour prévu : une fois, à l'agent qui a le dossier.
    const uid = (await db.query('SELECT id FROM users WHERE username = $1', [ident])).rows[0].id;
    const rq = (await db.query("INSERT INTO requests (tenant_id, id_user, nom_entreprise, motif, statut) VALUES ($1, $2, 'Fictive Delta', 'Consultation', 'livré') RETURNING id", [tid, uid])).rows[0].id;
    await db.query('INSERT INTO request_loans (tenant_id, request_id, emprunteur_id, date_retour_prevue) VALUES ($1, $2, $3, CURRENT_DATE + 1)', [tid, rq, uid]);
    const loans = require('./services/loanService');
    ok(await loans.rappelerEcheances(tid) === 1 && await loans.rappelerEcheances(tid) === 0, 'rappel « à rendre demain » envoyé une seule fois');
    ok((await db.query("SELECT count(*)::int n FROM notifications WHERE id_user = $1 AND type = 'loan_due_soon'", [uid])).rows[0].n === 1, 'l\'agent est prévenu');
    // « Je l'ai rapporté » : annoncé par l'agent, l'archive prévenue, pas encore retourné.
    const arch = (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Archiviste Essai', $3, 'archiviste') RETURNING id", [tid, `a.${s}`, `a${s}@exemple.test`])).rows[0].id;
    const an = await loans.annoncerRetour(tid, rq, { id: uid, tenant_id: tid, full_name: 'Paul Essai' });
    ok(an.pret.rapporte_annonce_at && !an.pret.retourne_at, 'retour annoncé par l\'agent, en attente de l\'archive');
    ok((await db.query("SELECT count(*)::int n FROM notifications WHERE id_user = $1 AND type = 'loan_reported'", [arch])).rows[0].n === 1, 'l\'archive est prévenue');
    ok((await loans.annoncerRetour(tid, rq, { id: uid, tenant_id: tid })).deja === true, 'annonce répétée : sans double notification');
    // Déblocage par l'administrateur.
    const tent = require('./helpers/tentativesConnexion');
    ok(tent.blocageDe(ident) === 15, 'l\'administrateur voit le blocage');
    tent.debloquer(ident);
    ok(tent.blocageDe(ident) === 0 && (await appel('POST', '/auth/login', { username: ident, password: 'Mon-cafe-de-7h30', tenant_slug: slug })).statut === 200, 'débloqué : la connexion repart');
    await db.query('DELETE FROM tenants WHERE id = $1', [tid]).catch(() => {});
    server.close();
  }
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies.`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
