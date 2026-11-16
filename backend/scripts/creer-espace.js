// ============================================================================
// creer-espace.js — crée l'espace d'une organisation et son administrateur
// sur un serveur neuf (installation interne, deploiement/windows-server).
//
// Utilisé par installer.ps1 quand la base est vide et qu'aucune base en ligne
// n'est transférée. Les valeurs arrivent par variables d'environnement — rien
// n'est écrit en dur, aucun mot de passe dans un fichier :
//   ESPACE_CODE          code de l'organisation (afgc : celui que l'édition attend)
//   ESPACE_NOM           nom affiché
//   ADMIN_IDENTIFIANT    identifiant de connexion de l'administrateur
//   ADMIN_NOM            nom complet
//   ADMIN_EMAIL          adresse professionnelle
//   ADMIN_MOT_DE_PASSE   mot de passe (8 caractères au moins)
// L'espace reçoit la configuration complète (réglages, groupes…) puis, si
// une édition porte ce code (config/editions.js), ses motifs, typologies et
// départements. Sans effet si l'espace existe déjà.
//
// Exécution (base déjà migrée : le serveur a démarré une fois) :
//   node scripts/creer-espace.js
// ============================================================================
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const tenantProvisioningService = require('../src/services/tenantProvisioningService');
const { EDITIONS } = require('../src/config/editions');

async function principal() {
  const code = String(process.env.ESPACE_CODE || '').trim().toLowerCase();
  const nom = String(process.env.ESPACE_NOM || EDITIONS[code]?.nom || '').trim();
  const identifiant = String(process.env.ADMIN_IDENTIFIANT || '').trim();
  const nomAdmin = String(process.env.ADMIN_NOM || '').trim();
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const motDePasse = String(process.env.ADMIN_MOT_DE_PASSE || '');
  if (!/^[a-z0-9-]{2,50}$/.test(code)) throw new Error('ESPACE_CODE invalide (lettres minuscules, chiffres, tirets).');
  if (!nom || !identifiant || !nomAdmin || !email) throw new Error('ESPACE_NOM, ADMIN_IDENTIFIANT, ADMIN_NOM et ADMIN_EMAIL sont requis.');
  if (motDePasse.length < 8) throw new Error('ADMIN_MOT_DE_PASSE : 8 caractères au moins.');

  const existe = (await db.query('SELECT id FROM tenants WHERE slug = $1', [code])).rows[0];
  if (existe) {
    console.log(`L'espace « ${code} » existe déjà (n° ${existe.id}) : rien n'est modifié.`);
    return;
  }

  const client = await db.pool.connect();
  let tenantId;
  let admin;
  try {
    await client.query('BEGIN');
    tenantId = (await client.query(
      "INSERT INTO tenants (name, slug, contact_email, status) VALUES ($1, $2, $3, 'active') RETURNING id",
      [nom, code, email]
    )).rows[0].id;
    admin = (await client.query(
      `INSERT INTO users (tenant_id, username, password_hash, full_name, email, role)
       VALUES ($1, $2, $3, $4, $5, 'superadmin') RETURNING id, full_name, role, tenant_id`,
      [tenantId, identifiant, await bcrypt.hash(motDePasse, 10), nomAdmin, email]
    )).rows[0];
    const rapport = await tenantProvisioningService.provisionTenant(tenantId, { client, companyName: nom, ownerId: admin.id });
    await client.query('COMMIT');
    if (rapport.failed.length) console.warn('Configuration partielle :', rapport.failed);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (EDITIONS[code]) {
    const r = await require('../src/services/editionService').appliquer(tenantId, admin, code);
    console.log(`Configuration « ${EDITIONS[code].nom} » installée : ${r.motifs} motifs, ${r.departements_ajoutes} départements.`);
  }
  console.log(`Espace « ${nom} » (${code}) créé. Administrateur : ${identifiant}.`);
}

principal()
  .then(() => process.exit(0))
  .catch((err) => { console.error(`ÉCHEC : ${err.message}`); process.exit(1); });
