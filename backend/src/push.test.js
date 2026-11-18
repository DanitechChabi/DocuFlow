// ============================================================================
// push.test.js — notifications poussées sur les appareils (058).
// L'envoi Web Push est simulé : aucun appel réseau.
// Exécution : npm run test:push
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);

(async () => {
  const webpush = require('web-push');
  const envoyes = [];
  let reponse = 201;
  webpush.sendNotification = async (abo, corps) => {
    if (reponse !== 201) { const e = new Error('expiré'); e.statusCode = reponse; throw e; }
    envoyes.push({ endpoint: abo.endpoint, ...JSON.parse(corps) });
    return { statusCode: 201 };
  };
  const push = require('./services/pushService');
  console.log('\n1. Règles (sans base)');
  ok(push.TYPES.request_created === '/demandes/a-traiter' && push.TYPES.loan_handover === '/demandes/mes-demandes', 'actions importantes et écran ouvert');
  ok(!push.TYPES.loan_returned && !push.TYPES.echeance, 'le reste ne dérange pas');
  const routes = require('./routes/pushRoutes');
  ok(['/cle', '/abonnement', '/essai'].every((p) => routes.stack.some((l) => l.route?.path === p)), 'routes déclarées');

  if (!avecBase) { console.log('\n2. Sur PostgreSQL — SAUTÉ'); } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test push ${s}`, `test-push-${s}`])).rows[0].id;
    const nouveau = async (n) => (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $2, $3, 'demandeur') RETURNING id, tenant_id", [t, `${n}-${s}`, `${n}-${s}@exemple.test`])).rows[0];
    const a = await nouveau('a');
    const b = await nouveau('b');
    ok(/^[A-Za-z0-9_-]{80,}$/.test((await push.clePublique()).cle), 'clé publique VAPID');
    let refus = null; try { await push.abonner(a, { endpoint: 'http://x' }); } catch (e) { refus = e.statut; }
    ok(refus === 400, 'abonnement invalide : 400');
    const abo = { endpoint: `https://push.exemple.test/${s}`, keys: { p256dh: 'BP'.padEnd(87, 'x'), auth: 'auth' } };
    await push.abonner(a, abo, 'Chrome · Windows');
    await push.relayer();
    const notif = (type, u, titre) => db.query('INSERT INTO notifications (tenant_id, id_user, title, message, type) VALUES ($1, $2, $3, $4, $5)', [t, u.id, titre, 'détail', type]);
    await notif('request_created', a, 'Nouvelle demande');
    await notif('loan_returned', a, 'Retour enregistré');
    await notif('loan_handover', b, 'Pour B, sans appareil');
    await db.query("INSERT INTO notifications (tenant_id, id_user, title, type, created_at) VALUES ($1, $2, 'Ancienne', 'request_created', now() - interval '1 hour')", [t, a.id]);
    envoyes.length = 0;
    await push.relayer();
    ok(envoyes.length === 1 && envoyes[0].titre === 'Nouvelle demande' && envoyes[0].lien === '/demandes/a-traiter', 'seule l\'action importante récente part, vers le bon écran');
    ok((await db.query('SELECT count(*)::int n FROM notifications WHERE tenant_id = $1 AND poussee_le IS NULL', [t])).rows[0].n === 0, 'toutes marquées traitées');
    envoyes.length = 0;
    await push.relayer();
    ok(envoyes.length === 0, 'rien n\'est envoyé deux fois');
    await push.abonner(b, abo, 'Chrome · Windows');
    ok((await db.query('SELECT user_id FROM push_abonnements WHERE endpoint = $1', [abo.endpoint])).rows[0].user_id === b.id, 'un autre compte sur le même appareil : l\'abonnement le suit');
    reponse = 410;
    await push.envoyer(t, b.id, { titre: 'x' });
    ok((await db.query('SELECT count(*)::int n FROM push_abonnements WHERE endpoint = $1', [abo.endpoint])).rows[0].n === 0, 'abonnement expiré oublié');
    await db.query('DELETE FROM tenants WHERE id = $1', [t]).catch(() => {});
  }
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
