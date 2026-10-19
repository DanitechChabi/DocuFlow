// ============================================================================
// migrationRunner — applique au démarrage les migrations SQL manquantes.
//
// POURQUOI
// Les migrations de docs/migrations/ s'appliquaient À LA MAIN sur la base de
// production (éditeur SQL de Neon, psql). Une migration oubliée laissait le
// code nouveau tourner sur un schéma ancien : fonctions indisponibles, ou
// erreurs 500 (voir 024). Désormais, le serveur s'en charge à chaque
// démarrage — donc à chaque déploiement Render.
//
// COMMENT
// - Table de suivi `migrations` (la même que backend/migrate.js et que
//   l'application de bureau) : une migration n'est exécutée qu'une fois.
// - Une base installée à la main n'a pas cette table : toutes les migrations
//   y sont alors rejouées. Elles sont écrites pour être rejouables sans effet
//   (IF NOT EXISTS, ON CONFLICT DO NOTHING…) — et c'est éprouvé : rejouer
//   001 → 025 sur une base qui les a déjà reçues à la main ne change rien.
// - Chaque fichier s'exécute dans SA transaction, avec son inscription dans
//   `migrations` : une migration interrompue ne laisse rien à moitié fait.
// - Verrou consultatif PostgreSQL : deux instances qui démarrent ensemble ne
//   migrent pas en même temps.
// - Un échec ARRÊTE la chaîne (les suivantes peuvent dépendre de celle qui a
//   échoué) mais n'empêche PAS le serveur de démarrer : le code tolère un
//   schéma en retard (replis 42P01 / 42703), et l'erreur est journalisée.
// - Désactivable : AUTO_MIGRATE=false.
//
// Les scripts de retour arrière (docs/migrations/down/) ne sont jamais
// exécutés ici : ils sont hors du dossier parcouru.
// ============================================================================
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

const DOSSIER = path.join(__dirname, '..', '..', '..', 'docs', 'migrations');
const SCHEMA_DE_BASE = path.join(__dirname, '..', '..', '..', 'docs', 'setup_db.sql');
// Clé arbitraire mais fixe du verrou consultatif (« DOCUFLOW » en hexadécimal tronqué).
const CLE_VERROU = 0x0d0cf10;

/** Fichiers de migration, dans l'ordre d'application. */
function listerMigrations(dossier = DOSSIER) {
  if (!fs.existsSync(dossier)) return [];
  return fs.readdirSync(dossier).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
}

/**
 * Applique les migrations manquantes.
 * @returns {Promise<{appliquees: string[], echec: ?{fichier: string, message: string}, ignore?: string}>}
 */
async function appliquerMigrations({ dossier = DOSSIER, journal = console } = {}) {
  if (String(process.env.AUTO_MIGRATE).toLowerCase() === 'false') {
    return { appliquees: [], echec: null, ignore: 'AUTO_MIGRATE=false' };
  }
  const fichiers = listerMigrations(dossier);
  if (!fichiers.length) return { appliquees: [], echec: null, ignore: 'aucun fichier de migration' };

  const client = await db.pool.connect();
  const appliquees = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [CLE_VERROU]);

    // Base vierge (aucune table) : le schéma de base d'abord.
    const vierge = await client.query("SELECT to_regclass('public.tenants') IS NULL AS vierge");
    if (vierge.rows[0].vierge && fs.existsSync(SCHEMA_DE_BASE)) {
      journal.log('[migrations] base vierge — schéma de base (setup_db.sql)');
      await client.query(fs.readFileSync(SCHEMA_DE_BASE, 'utf-8'));
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const faites = new Set((await client.query('SELECT filename FROM migrations')).rows.map((r) => r.filename));

    for (const fichier of fichiers) {
      if (faites.has(fichier)) continue;
      const sql = fs.readFileSync(path.join(dossier, fichier), 'utf-8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING', [fichier]);
        await client.query('COMMIT');
        appliquees.push(fichier);
        journal.log(`[migrations] ${fichier} appliquée`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        journal.error(`[migrations] ÉCHEC de ${fichier} — les suivantes ne sont pas appliquées : ${err.message}`);
        return { appliquees, echec: { fichier, message: err.message } };
      }
    }
    return { appliquees, echec: null };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [CLE_VERROU]).catch(() => {});
    client.release();
  }
}

module.exports = { appliquerMigrations, listerMigrations };
