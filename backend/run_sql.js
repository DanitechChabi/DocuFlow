/**
 * run_sql.js — Exécute un fichier SQL (ou une requête inline) sur la base
 * réellement utilisée par l'application.
 *
 * IMPORTANT : ce script réutilise `src/config/db.js`, donc exactement la même
 * résolution de connexion que le serveur (DATABASE_URL/Neon prioritaire sur les
 * variables DB_* locales, SSL inclus). Une version antérieure chargeait un
 * chemin .env inexistant et retombait silencieusement sur localhost, ce qui
 * faisait porter les migrations et diagnostics sur la mauvaise base.
 *
 * Usage :
 *   node run_sql.js <chemin/fichier.sql>
 *   node run_sql.js -c "SELECT count(*) FROM documents"
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = require('./src/config/db');

function describeTarget() {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname} (DATABASE_URL)`;
    } catch {
      return 'DATABASE_URL (non analysable)';
    }
  }
  return `${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'docuflow_afgc'} (DB_*)`;
}

async function run(sql, label) {
  console.log(`→ Cible : ${describeTarget()}`);
  try {
    const result = await db.query(sql);
    const results = Array.isArray(result) ? result : [result];
    for (const r of results) {
      if (r && r.rows && r.rows.length) {
        console.table(r.rows);
      } else if (r && r.command) {
        console.log(`   ${r.command} — ${r.rowCount ?? 0} ligne(s)`);
      }
    }
    console.log(`✅ Exécuté : ${label}`);
    process.exitCode = 0;
  } catch (err) {
    console.error(`❌ Échec (${label}) : ${err.message}`);
    if (err.detail) console.error(`   detail : ${err.detail}`);
    if (err.hint) console.error(`   hint   : ${err.hint}`);
    if (err.position) console.error(`   position : ${err.position}`);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

const [arg1, arg2] = process.argv.slice(2);

if (arg1 === '-c' || arg1 === '--command') {
  if (!arg2) {
    console.error('Usage : node run_sql.js -c "<requête SQL>"');
    process.exit(1);
  }
  run(arg2, 'requête inline');
} else if (arg1) {
  const filePath = path.resolve(arg1);
  if (!fs.existsSync(filePath)) {
    console.error(`Fichier introuvable : ${filePath}`);
    process.exit(1);
  }
  run(fs.readFileSync(filePath, 'utf-8'), filePath);
} else {
  console.error('Usage :\n  node run_sql.js <fichier.sql>\n  node run_sql.js -c "<requête SQL>"');
  process.exit(1);
}
