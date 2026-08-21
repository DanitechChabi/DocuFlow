// ============================================================================
// Script de migration : exécute les migrations SQL
// Usage : node migrate.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'docs', 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.log('✅ Aucun dossier migrations trouvé, rien à faire.');
    await pool.end();
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('✅ Aucune migration à exécuter.');
    await pool.end();
    return;
  }

  // Créer une table de suivi des migrations si elle n'existe pas
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const file of files) {
    // Vérifier si déjà exécutée
    const { rows } = await pool.query('SELECT id FROM migrations WHERE filename = $1', [file]);
    if (rows.length > 0) {
      console.log(`⏭️  ${file} déjà exécutée.`);
      continue;
    }

    console.log(`🔄 Exécution de ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    // Chaque migration s'exécute dans SA transaction, sur une connexion dédiée,
    // et l'enregistrement dans `migrations` en fait partie. Sans cela, une
    // migration interrompue en son milieu laissait la base à moitié transformée
    // ET non enregistrée : la reprise la rejouait depuis le début, sur un schéma
    // déjà partiellement modifié. Les migrations sont idempotentes, ce qui rend
    // cette reprise possible, mais l'atomicité évite d'avoir à en dépendre.
    //
    // Le corollaire : aucun fichier de migration ne doit contenir son propre
    // BEGIN/COMMIT. PostgreSQL n'imbrique pas les transactions — un COMMIT dans
    // le fichier refermerait celle ouverte ici, et les instructions suivantes
    // s'exécuteraient hors transaction, hors de portée du ROLLBACK.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✅ ${file} exécutée avec succès.`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`❌ Erreur sur ${file}:`, err.message);
      console.error('   Aucune modification n\'a été conservée pour ce fichier.');
      client.release();
      await pool.end();
      process.exit(1);
    }
    client.release();
  }

  console.log('🎉 Toutes les migrations sont à jour.');
  await pool.end();
}

runMigrations().catch(err => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
