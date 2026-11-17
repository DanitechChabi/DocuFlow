// ============================================================================
// Télécharge les modèles de l'aide automatique (iaService) dans le dossier
// des modèles, pour un serveur sans accès à Internet.
//   node scripts/telecharger-modeles.js [dossier]
// Dossier par défaut : IA_MODELES_DIR, sinon backend/.modeles.
// ============================================================================
const path = require('path');

(async () => {
  if (process.argv[2]) process.env.IA_MODELES_DIR = path.resolve(process.argv[2]);
  process.env.IA_LOCALE = 'oui';
  const ia = require('../src/services/iaService');
  console.log(`Modèles dans ${ia.dossierModeles()}`);
  for (const nom of Object.keys(ia.MODELES)) {
    process.stdout.write(`- ${nom} (${ia.MODELES[nom].id})… `);
    const p = await ia.charger(nom);
    if (!p) { console.log('ÉCHEC'); process.exit(1); }
    console.log('prêt');
  }
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
