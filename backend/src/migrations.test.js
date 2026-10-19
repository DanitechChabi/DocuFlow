// ============================================================================
// migrations.test.js — ce que le serveur applique au démarrage
// (services/migrationRunner). Sans base : la liste des fichiers, leur ordre,
// et l'exclusion des scripts de retour arrière. Le rejeu complet 001 → 025
// sur une base migrée à la main est éprouvé sur PostgreSQL (voir le commit
// qui introduit le runner).
// Exécution : npm run test:migrations (ou npm test).
// ============================================================================
const path = require('path');
const fs = require('fs');
const { listerMigrations } = require('./services/migrationRunner');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };

const dossier = path.join(__dirname, '..', '..', 'docs', 'migrations');
const fichiers = listerMigrations(dossier);
ok(fichiers.length >= 25, `migrations trouvées (${fichiers.length})`);
ok(fichiers.every((f) => /^\d{3}_.+\.sql$/.test(f)), 'noms au format NNN_nom.sql');
ok(JSON.stringify(fichiers) === JSON.stringify([...fichiers].sort()), 'ordre numérique');
const numeros = fichiers.map((f) => f.slice(0, 3));
ok(new Set(numeros).size === numeros.length, 'aucun numéro en double');
ok(!fichiers.some((f) => /down/i.test(f)), 'les retours arrière (down/) ne sont jamais appliqués');
ok(fs.existsSync(path.join(dossier, 'down')), 'dossier des retours arrière présent');
// Le runner exécute chaque fichier dans SA transaction : un BEGIN/COMMIT
// explicite dans un fichier la casserait.
const avecTransaction = fichiers.filter((f) => /^\s*(BEGIN|COMMIT)\s*;/mi.test(fs.readFileSync(path.join(dossier, f), 'utf8')));
ok(avecTransaction.length === 0, `aucune migration ne gère sa propre transaction${avecTransaction.length ? ` (${avecTransaction.join(', ')})` : ''}`);
const concurrent = fichiers.filter((f) => /CONCURRENTLY/i.test(fs.readFileSync(path.join(dossier, f), 'utf8')));
ok(concurrent.length === 0, 'aucun CREATE INDEX CONCURRENTLY (impossible en transaction)');

console.log(`\n${echecs === 0 ? '✅' : '❌'} Migrations cohérentes — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
process.exit(echecs ? 1 : 0);
