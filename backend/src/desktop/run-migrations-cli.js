// ============================================================================
// CLI de migrations/setup de la base — appelée par l'installateur (setup.bat)
// et utilisable manuellement :
//   node backend/src/desktop/run-migrations-cli.js
// Charge backend/.env, puis crée la base (si absente), applique le schéma et
// les migrations, et crée le superadmin par défaut (admin / Admin123!).
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const { ensureDatabase, runMigrations, seedAdmin } = require('./bootstrap');

(async () => {
  await ensureDatabase();
  await runMigrations();
  await seedAdmin();
  console.log('[OK] Base de données initialisée.');
  process.exit(0);
})().catch((err) => {
  console.error('[ERREUR]', err.message);
  process.exit(1);
});
