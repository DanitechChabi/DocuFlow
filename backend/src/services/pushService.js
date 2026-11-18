// ============================================================================
// Notifications sur l'ordinateur ou le téléphone (058, Web Push).
// Chaque appareil s'abonne depuis l'application (navigateur ou application
// installée). Un relais reprend toutes les dix secondes les notifications
// importantes créées par l'application et les envoie aux appareils de leur
// destinataire — même application fermée. Aucun service ne change : ils
// continuent d'écrire dans `notifications`.
// ============================================================================

const webpush = require('web-push');
const db = require('../config/db');

// Les actions importantes, et l'écran qu'ouvre un clic.
const TYPES = {
  request_created: '/demandes/a-traiter',     // une demande arrive à l'archive
  status_update: '/demandes/mes-demandes',    // la demande avance
  loan_handover: '/demandes/mes-demandes',    // le dossier est transmis
  delivered: '/demandes/mes-demandes',        // le document est envoyé
  complement: '/demandes/mes-demandes',       // un complément est demandé / reçu
  loan_overdue: '/demandes/prets',            // un dossier est en retard
  loan_reported: '/demandes/prets',           // un retour est signalé
  courrier: '/courrier',
  circuits: '/',
  mention: '/',
};
const INTERVALLE = 10 * 1000;

let cles = null;
/** Clés VAPID : variables d'environnement, sinon une paire créée une fois et gardée en base. */
async function clesVapid() {
  if (cles) return cles;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cles = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const neuves = webpush.generateVAPIDKeys();
    await db.query("INSERT INTO cles_serveur (nom, valeur) VALUES ('vapid', $1) ON CONFLICT (nom) DO NOTHING", [JSON.stringify(neuves)]);
    cles = JSON.parse((await db.query("SELECT valeur FROM cles_serveur WHERE nom = 'vapid'")).rows[0].valeur);
  }
  const site = String(process.env.FRONTEND_URL || '').split(',')[0].trim();
  webpush.setVapidDetails(/^https:\/\//.test(site) ? site : 'https://afgc.vercel.app', cles.publicKey, cles.privateKey);
  return cles;
}

async function clePublique() { return { cle: (await clesVapid()).publicKey }; }

function erreur(statut, message) { const e = new Error(message); e.statut = statut; return e; }

async function abonner(user, abonnement, appareil) {
  const a = abonnement || {};
  if (!/^https:\/\//.test(a.endpoint || '') || !a.keys?.p256dh || !a.keys?.auth) throw erreur(400, 'Abonnement invalide.');
  await db.query(
    `INSERT INTO push_abonnements (tenant_id, user_id, endpoint, p256dh, auth, appareil) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET tenant_id = $1, user_id = $2, p256dh = $4, auth = $5, appareil = $6`,
    [user.tenant_id, user.id, a.endpoint, a.keys.p256dh, a.keys.auth, String(appareil || '').slice(0, 255) || null]
  );
  return { abonne: true };
}

async function desabonner(user, endpoint) {
  await db.query('DELETE FROM push_abonnements WHERE tenant_id = $1 AND user_id = $2 AND endpoint = $3', [user.tenant_id, user.id, String(endpoint || '')]);
  return { abonne: false };
}

/** Envoie un message à tous les appareils d'un utilisateur ; oublie les abonnements expirés. */
async function envoyer(tenantId, userId, message) {
  await clesVapid();
  const r = await db.query('SELECT id, endpoint, p256dh, auth FROM push_abonnements WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
  let envoyes = 0;
  for (const a of r.rows) {
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, JSON.stringify(message), { TTL: 24 * 3600, urgency: 'high' });
      envoyes += 1;
      await db.query('UPDATE push_abonnements SET dernier_envoi = now() WHERE id = $1', [a.id]);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await db.query('DELETE FROM push_abonnements WHERE id = $1', [a.id]);
      else console.error('[push] envoi :', err.statusCode || '', err.message);
    }
  }
  return envoyes;
}

async function essai(user) {
  const n = await envoyer(user.tenant_id, user.id, { titre: 'Notifications activées', texte: 'Vous serez prévenu ici des actions importantes.', lien: '/' });
  if (!n) throw erreur(404, 'Aucun appareil abonné.');
  return { envoyes: n };
}

/** Le relais : les notifications importantes pas encore poussées (dix dernières minutes). */
async function relayer() {
  const r = await db.query(
    `UPDATE notifications SET poussee_le = now()
      WHERE id IN (SELECT id FROM notifications WHERE poussee_le IS NULL ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED)
      RETURNING id, tenant_id, id_user, title, message, type, lien, created_at`
  );
  const recentes = r.rows.filter((n) => n.id_user && TYPES[n.type] && Date.now() - new Date(n.created_at).getTime() < 10 * 60 * 1000);
  if (!recentes.length) return 0;
  const abonnes = new Set((await db.query('SELECT DISTINCT tenant_id, user_id FROM push_abonnements')).rows.map((x) => `${x.tenant_id}:${x.user_id}`));
  let n = 0;
  for (const x of recentes) {
    if (!abonnes.has(`${x.tenant_id}:${x.id_user}`)) continue;
    n += await envoyer(x.tenant_id, x.id_user, {
      titre: x.title, texte: String(x.message || '').slice(0, 300), tag: `n${x.id}`,
      lien: x.lien && x.lien.startsWith('/') ? x.lien : TYPES[x.type],
    });
  }
  return n;
}

let minuterie = null;
function demarrer() {
  if (minuterie) return;
  const tour = () => relayer().catch((err) => console.error('[push] relais :', err.message));
  clesVapid().catch((err) => console.error('[push] clés :', err.message));
  minuterie = setInterval(tour, INTERVALLE);
  minuterie.unref?.();
}

module.exports = { TYPES, clePublique, abonner, desabonner, envoyer, essai, relayer, demarrer };
