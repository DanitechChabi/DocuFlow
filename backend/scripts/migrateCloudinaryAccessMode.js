// ============================================================================
// migrateCloudinaryAccessMode.js
//
// Bascule access_mode: 'authenticated' sur tous les assets Cloudinary déjà
// référencés en base (document_files, request_files, message_attachments).
// Nécessaire parce que `storageService.saveFile` ne pose cet attribut QUE sur
// les nouveaux uploads (voir Phase A/B du chantier sécurité GED) — les
// fichiers versés avant ce chantier restent en access_mode 'public' (livrables
// par leur secure_url brute, sans passer par notre contrôle d'accès) tant que
// ce script n'a pas tourné.
//
// ⚠️  NE LANCER QU'APRÈS AVOIR DÉPLOYÉ le code qui sait générer des URL
//     signées (storageService.signedCloudinaryUrl, utilisé par les trois
//     routes de téléchargement protégées). Basculer l'access_mode avant le
//     déploiement du code rend tous les documents déjà versés inaccessibles
//     — y compris par l'application elle-même — jusqu'à ce que le code
//     déployé sache générer l'URL signée qui les débloque.
//
// Idempotent : relancer sur un asset déjà basculé en 'authenticated' est sans
// effet nuisible (Cloudinary applique la même valeur).
//
// Usage : cd backend && node scripts/migrateCloudinaryAccessMode.js
// ============================================================================

require('../src/services/storageService'); // configure cloudinary.config() (effet de bord au require)
const cloudinary = require('cloudinary').v2;
const db = require('../src/config/db');
const { resourceTypeFromMime } = require('../src/services/storageService');

// Séquentiel, avec un court délai entre appels : l'API Admin Cloudinary est
// soumise à un quota horaire — une rafale sur une base de plusieurs milliers
// de fichiers le saturerait et ferait échouer la fin du lot pour une raison
// qui n'a rien à voir avec les fichiers eux-mêmes.
const DELAY_MS = 150;

const SOURCES = [
  { table: 'document_files', label: 'documents (GED)' },
  { table: 'request_files', label: 'pièces jointes de demandes' },
  { table: 'message_attachments', label: 'pièces jointes de messages' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    console.error(
      'Cloudinary non configuré (CLOUDINARY_CLOUD_NAME absent) — ce script ne concerne que le mode Cloudinary, rien à migrer ici.'
    );
    process.exit(1);
  }

  let total = 0;
  let ok = 0;
  const echecs = [];

  for (const { table, label } of SOURCES) {
    const { rows } = await db.query(
      `SELECT id, cloudinary_public_id, mime_type FROM ${table} WHERE cloudinary_public_id IS NOT NULL`
    );
    console.log(`\n[${label}] ${rows.length} fichier(s) à vérifier/migrer…`);

    for (const row of rows) {
      total++;
      const resourceType = resourceTypeFromMime(row.mime_type);
      try {
        await cloudinary.api.update(row.cloudinary_public_id, {
          resource_type: resourceType,
          type: 'upload',
          access_mode: 'authenticated',
        });
        ok++;
      } catch (err) {
        echecs.push({ table, id: row.id, publicId: row.cloudinary_public_id, message: err.message });
        console.warn(`  ✗ ${table}#${row.id} (${row.cloudinary_public_id}) : ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
  }

  console.log('\n--- Résumé ---');
  console.log(`${ok}/${total} asset(s) basculé(s) en access_mode: authenticated.`);
  if (echecs.length > 0) {
    console.log(`${echecs.length} échec(s) — à reprendre manuellement :`);
    echecs.forEach((e) => console.log(`  - ${e.table}#${e.id} (${e.publicId}) : ${e.message}`));
  }

  await db.pool.end();
}

run().catch((err) => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
