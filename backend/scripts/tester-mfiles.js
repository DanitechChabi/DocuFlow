// ============================================================================
// tester-mfiles.js — vérifie le raccordement à M-Files depuis le serveur :
// connexion (jeton), puis une recherche d'essai.
//   node scripts/tester-mfiles.js [mot à chercher]
// (la configuration vient des variables d'environnement : MFILES_…)
// ============================================================================
const mfiles = require('../src/services/mfilesApiService');

(async () => {
  const e = await mfiles.etat(null);
  if (!e.raccorde) throw new Error('MFILES_REST_URL, MFILES_VAULT_GUID, MFILES_USERNAME et MFILES_PASSWORD ne sont pas tous renseignés.');
  console.log(`API ${e.adresse} · coffre ${e.coffre}`);
  if (!e.joignable) throw new Error(e.erreur);
  console.log('Connexion à M-Files : OK');
  const q = process.argv[2] || 'CBE';
  const r = await mfiles.rechercher(null, q, { limite: 5 });
  console.log(`Recherche « ${q} » : ${r.resultats.length}${r.plus ? '+' : ''} résultat(s)`);
  for (const o of r.resultats) console.log(`  - ${o.titre} (${o.fichiers.map((f) => f.nom).join(', ') || 'sans fichier'})`);
  process.exit(0);
})().catch((err) => { console.error(`Échec : ${err.message}`); process.exit(1); });
