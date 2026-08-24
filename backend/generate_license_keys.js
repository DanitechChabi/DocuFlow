// ============================================================================
// generate_license_keys.js — fabrique la paire de clés Ed25519 qui signe les
// licences de bureau.
//
// À N'EXÉCUTER QU'UNE FOIS, à la mise en place. Regénérer une paire alors que des
// licences circulent les invalide TOUTES instantanément : les postes clients
// vérifient avec la clé publique livrée dans leur installation, et une nouvelle
// clé publique ne reconnaît plus aucun artefact signé par l'ancienne. La procédure
// de rotation correcte est décrite dans src/config/licensePublicKey.js.
//
// CE QUE FAIT CE SCRIPT
//   1. il affiche la clé PUBLIQUE, à recopier dans src/config/licensePublicKey.js
//      (elle est versionnée : son rôle est d'être livrée à chaque client) ;
//   2. il écrit la clé PRIVÉE dans license-keys-GENERATED.txt à la racine du
//      dépôt — fichier listé dans .gitignore. Elle n'est PAS affichée à l'écran :
//      un terminal est recopié, capturé, partagé. Cette clé seule permet d'émettre
//      des licences valides ; sa fuite rend le produit gratuit.
//
// FORME ATTENDUE PAR RENDER
// La variable DESKTOP_LICENSE_PRIVATE_KEY doit contenir le PEM sur UNE SEULE
// LIGNE, sauts de ligne écrits « \n » littéralement, et SANS guillemets
// englobants — Render stocke la valeur telle quelle, et des guillemets rendent la
// clé indécodable (« DECODER routines::unsupported »). Le fichier produit ici
// donne donc la valeur brute, prête à coller.
//
// Exécution : node backend/generate_license_keys.js
// ============================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// À la racine du dépôt (un niveau au-dessus de backend/), là où .gitignore
// l'attend explicitement.
const FICHIER_SORTIE = path.join(__dirname, '..', 'license-keys-GENERATED.txt');

// Refus d'écraser : le fichier existant contient peut-être la clé qui signe les
// licences en production. L'écraser sans le dire couperait toute la chaîne, et
// l'ancienne clé serait irrécupérable.
if (fs.existsSync(FICHIER_SORTIE)) {
  console.error(`\n❌ ${path.basename(FICHIER_SORTIE)} existe déjà.`);
  console.error('   Il contient probablement la clé qui signe les licences en production.');
  console.error('   Regénérer une paire invaliderait TOUTES les licences en circulation.');
  console.error('   Pour repartir de zéro en toute connaissance de cause : supprimez');
  console.error('   ce fichier à la main, puis relancez ce script.\n');
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

const pemPrive = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pemPublic = publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();

// Forme Render : une ligne, « \n » littéraux, sans guillemets.
const uneLigne = pemPrive.replace(/\r?\n/g, '\\n');

// Vérification immédiate : signer puis vérifier, pour ne pas découvrir un vice de
// forme au premier client. On refait le trajet complet, y compris le passage par
// la forme « une ligne » telle que Render la restituera.
const rejoue = crypto.createPrivateKey(uneLigne.replace(/\\n/g, '\n'));
const message = Buffer.from('docuflow-verification-de-la-paire');
const signature = crypto.sign(null, message, rejoue);
const valide = crypto.verify(null, message, publicKey, signature);
if (!valide) {
  console.error('\n❌ La paire générée ne se vérifie pas elle-même. Rien n\'a été écrit.\n');
  process.exit(1);
}

fs.writeFileSync(FICHIER_SORTIE, [
  'CLE PRIVEE — valeur a coller dans la variable Render DESKTOP_LICENSE_PRIVATE_KEY.',
  'Une seule ligne, sans guillemets, telle quelle :',
  '',
  uneLigne,
  '',
  'CLE PRIVEE (meme cle, format PEM lisible — pour archivage hors ligne)',
  pemPrive.trim(),
  '',
  'CLE PUBLIQUE (a recopier dans backend/src/config/licensePublicKey.js)',
  pemPublic,
  '',
].join('\n'), { encoding: 'utf8', mode: 0o600 });

console.log('\n✅ Paire Ed25519 générée et vérifiée.\n');
console.log('CLÉ PUBLIQUE — à recopier dans backend/src/config/licensePublicKey.js :\n');
console.log(pemPublic);
console.log(`\nCLÉ PRIVÉE — écrite dans ${FICHIER_SORTIE}`);
console.log('   (volontairement pas affichée ici : un terminal se recopie et se partage)\n');
console.log('ÉTAPES SUIVANTES');
console.log('  1. recopier la clé publique ci-dessus dans src/config/licensePublicKey.js ;');
console.log('  2. coller la valeur « une seule ligne » du fichier dans la variable Render');
console.log('     DESKTOP_LICENSE_PRIVATE_KEY, SANS guillemets ;');
console.log('  3. redéployer, puis vérifier que POST /api/licenses/activate ne répond');
console.log('     plus 503 SIGNING_UNAVAILABLE ;');
console.log('  4. conserver ce fichier hors du dépôt (il est déjà dans .gitignore).\n');
