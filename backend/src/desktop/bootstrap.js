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
 * Crée le superadmin par défaut sur le tenant 1 (DocuFlow) si aucun n'existe.
 * Identifiants surchargeables : ADMIN_USERNAME / ADMIN_PASSWORD.
 */
async function seedAdmin() {
  const pool = new Pool(DB);
  try {
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = 1 AND role = 'superadmin'"
    );
    if (rows[0].n > 0) {
      console.log('[desktop] Superadmin existant — seed ignoré.');
      return;
    }
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'Admin123!';
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (tenant_id, username, password_hash, full_name, email, role)
       VALUES (1, $1, $2, 'Administrateur DocuFlow', $3, 'superadmin')`,
      [username, hash, `${username}@docuflow.local`]
    );
    console.log(`[desktop] Superadmin créé : ${username} / ${password}`);
  } finally {
    await pool.end();
  }
}

module.exports = { ensureDatabase, runMigrations, seedAdmin };
