// ============================================================================
// Bootstrap de la base de données pour l'app de bureau (Electron).
// Appelé par desktop/main.js AVANT le démarrage du backend Express.
//   1. ensureDatabase : crée la base (CREATE DATABASE) si absente.
//   2. runMigrations  : applique docs/setup_db.sql (idempotent) puis les
//                       migrations docs/migrations/*.sql (table de suivi).
//   3. seedAdmin      : crée le superadmin par défaut (admin / Admin123!)
//                       si aucun superadmin n'existe sur le tenant 1.
//
// Placé dans backend/src pour résoudre require('pg') / require('bcryptjs')
// depuis backend/node_modules (y compris dans le paquet Electron packagé).
// ============================================================================
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const DB = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
};

// backend/src/desktop/bootstrap.js → ../../.. = racine (dev) ou resources/app (packagé)
const ROOT = path.join(__dirname, '..', '..', '..');
const DOCS_DIR = path.join(ROOT, 'docs');

/**
 * Crée la base cible si elle n'existe pas (connexion à la base de maintenance
 * `postgres`). Le nom est échappé (uniquement [a-zA-Z0-9_]) car CREATE DATABASE
 * n'accepte pas de paramètre SQL.
 */
async function ensureDatabase() {
  const maintenance = new Pool({ ...DB, database: 'postgres' });
  try {
    const { rows } = await maintenance.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [DB.database]
    );
    if (rows.length === 0) {
      const safe = String(DB.database).replace(/[^a-zA-Z0-9_]/g, '');
      await maintenance.query(`CREATE DATABASE "${safe}"`);
      console.log(`[desktop] Base "${safe}" créée.`);
    } else {
      console.log(`[desktop] Base "${DB.database}" existante.`);
    }
  } finally {
    await maintenance.end();
  }
}

/**
 * Schéma de base (setup_db.sql) puis migrations SQL non encore exécutées.
 */
async function runMigrations() {
  const pool = new Pool(DB);
  try {
    // Schéma de base — idempotent (CREATE TABLE IF NOT EXISTS)
    const setupFile = path.join(DOCS_DIR, 'setup_db.sql');
    if (fs.existsSync(setupFile)) {
      await pool.query(fs.readFileSync(setupFile, 'utf-8'));
      console.log('[desktop] setup_db.sql appliqué.');
    }

    // Table de suivi des migrations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrationsDir = path.join(DOCS_DIR, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const { rows } = await pool.query('SELECT id FROM migrations WHERE filename = $1', [file]);
        if (rows.length > 0) {
          console.log(`[desktop] ${file} déjà exécutée.`);
          continue;
        }
        console.log(`[desktop] Migration ${file}...`);
        // Simple query protocol (pas de paramètres) → les fichiers multi-commandes
        // sont exécutés dans une transaction implicite PostgreSQL.
        await pool.query(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'));
        await pool.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
        console.log(`[desktop] Migration ${file} appliquée.`);
      }
    } else {
      console.warn('[desktop] Dossier migrations introuvable, aucune migration appliquée.');
    }
  } finally {
    await pool.end();
  }
}

/**
 * Crée l'administrateur par défaut sur le tenant 1 si aucun n'existe.
 * Identifiants surchargeables : ADMIN_USERNAME / ADMIN_PASSWORD.
 *
 * RÔLE 'admin' ET NON 'superadmin' — c'est une correction de sécurité.
 * platformOwnerMiddleware reconnaît le propriétaire de la plateforme au couple
 * (role = 'superadmin', tenant_id = 1). Ce seed créait exactement ce couple sur
 * CHAQUE poste client, avec un mot de passe publié dans desktop/README.md :
 * n'importe quel acheteur ouvrait le portail éditeur et pouvait s'émettre des
 * licences. Le rôle 'admin' donne tous les droits utiles sur l'entreprise
 * (utilisateurs, sections, documents, configuration) sans ouvrir ce portail.
 *
 * Les postes DÉJÀ installés sont rattrapés par rétrogradation ci-dessous : le
 * seed ne suffit pas, il ne s'exécute que si la table est vide.
 *
 * LE GARDE-FOU PORTE SUR L'IDENTIFIANT, PAS SUR LE RÔLE — c'est la correction
 * d'une panne totale de démarrage. La version précédente décidait d'insérer en
 * comptant les comptes d'un certain RÔLE, alors que la table contraint
 * UNIQUE (tenant_id, username) et UNIQUE (tenant_id, email). Les deux critères
 * ne coïncident pas : il suffisait qu'un compte « admin » existe avec un rôle
 * hors de la liste attendue (une rétrogradation, un changement de rôle par
 * l'administrateur lui-même) pour que le test conclue « aucun administrateur »
 * et lance un INSERT que la base refusait — « duplicate key value violates
 * unique constraint "users_tenant_id_username_key" ». L'exception remontait à
 * desktop/main.js, qui affichait « La préparation des données a échoué » et
 * quittait : l'application ne s'ouvrait plus du tout, pour un compte par défaut
 * qui existait déjà et dont personne n'avait besoin.
 */
async function seedAdmin() {
  const pool = new Pool(DB);
  try {
    // Rétrogradation des installations existantes. Bornée au mode bureau
    // (SERVE_FRONTEND) : sur le SaaS Render, le superadmin du tenant 1 est le
    // véritable éditeur et ne doit surtout pas être touché.
    if (process.env.SERVE_FRONTEND === 'true') {
      const { rowCount } = await pool.query(
        "UPDATE users SET role = 'admin' WHERE tenant_id = 1 AND role = 'superadmin'"
      );
      if (rowCount > 0) {
        console.log(`[desktop] ${rowCount} compte(s) « superadmin » rétrogradé(s) en « admin » (portail éditeur retiré).`);
      }
    }

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = 1 AND role IN ('admin', 'superadmin')"
    );
    if (rows[0].n > 0) {
      console.log('[desktop] Administrateur existant — seed ignoré.');
      return;
    }
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'Admin123!';
    const email = `${username}@docuflow.local`;

    // Second contrôle, sur les colonnes RÉELLEMENT contraintes. Le test de rôle
    // ci-dessus répond à « faut-il un administrateur ? » ; celui-ci répond à
    // « l'insertion est-elle possible ? ». Les deux sont nécessaires : un compte
    // « admin » de rôle « demandeur » rend la première réponse « oui » et la
    // seconde « non ».
    const { rows: pris } = await pool.query(
      'SELECT username, email, role FROM users WHERE tenant_id = 1 AND (username = $1 OR email = $2)',
      [username, email]
    );
    if (pris.length > 0) {
      // On ne touche NI au mot de passe NI au rôle d'un compte existant : ce
      // serait réinitialiser à chaque démarrage un compte que le client a
      // peut-être renommé, ou dont il a changé le mot de passe.
      //
      // Le message nomme la colonne RÉELLEMENT en cause et le compte qui bloque.
      // Dire « l'identifiant admin est pris » quand c'est l'e-mail qui l'est, sur
      // un compte portant un tout autre nom, enverrait le support chercher au
      // mauvais endroit.
      const bloquant = pris[0];
      const cause = bloquant.username === username
        ? `l'identifiant « ${username} » est déjà pris`
        : `l'adresse « ${email} » est déjà prise (compte « ${bloquant.username} »)`;
      console.warn(
        `[desktop] Compte administrateur par défaut non créé : ${cause} sur cette `
        + `base, et aucun compte n'y a le rôle administrateur. `
        + `Attribuez le rôle « admin » au compte « ${bloquant.username} » `
        + `(rôle actuel : « ${bloquant.role} ») pour retrouver les droits d'administration.`
      );
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    // ON CONFLICT DO NOTHING : filet de dernier recours. Les contrôles ci-dessus
    // couvrent les cas connus, mais deux processus lancés simultanément peuvent
    // les passer tous les deux avant d'insérer. Un démarrage ne doit pas échouer
    // sur une course entre deux fenêtres.
    const { rowCount } = await pool.query(
      `INSERT INTO users (tenant_id, username, password_hash, full_name, email, role)
       VALUES (1, $1, $2, 'Administrateur DocuFlow', $3, 'admin')
       ON CONFLICT DO NOTHING`,
      [username, hash, email]
    );
    if (rowCount === 0) {
      console.warn('[desktop] Compte administrateur déjà présent — création ignorée.');
      return;
    }
    console.log(`[desktop] Administrateur créé : ${username} / ${password}`);
  } finally {
    await pool.end();
  }
}

module.exports = { ensureDatabase, runMigrations, seedAdmin };
