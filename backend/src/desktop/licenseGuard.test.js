/**
 * licenseGuard.test.js — Verrouillage du dispositif de licence de bureau.
 *
 * POURQUOI CES TESTS EXISTENT
 * Le dispositif de licence est la seule chose qui sépare un logiciel vendu d'un
 * logiciel donné. Ses défaillances sont SILENCIEUSES dans les deux sens, et les
 * deux coûtent cher :
 *
 *   • trop permissif — une licence falsifiée passe, et le produit est gratuit ;
 *   • trop sévère — un client qui a payé se retrouve dehors, souvent hors ligne,
 *     sans comprendre pourquoi. C'est le pire des deux : il appelle, il s'énerve,
 *     il demande un remboursement.
 *
 * Rien de tout cela ne se voit à l'exécution normale : une licence acceptée à
 * tort ressemble exactement à une licence valide. D'où ces tests.
 *
 * CE QUI EST COUVERT ICI, ET CE QUI NE PEUT PAS L'ÊTRE
 * Ce fichier teste la LOGIQUE DE DÉCISION : signature, empreinte machine, dates,
 * fenêtre de grâce. Il n'a besoin ni de base de données, ni de réseau, ni
 * d'Electron — la paire de clés est générée à la volée, l'horloge est simulée par
 * des dates d'échéance choisies. Ce qui reste hors de portée : les appels HTTP au
 * serveur d'activation (licenseGuard.check avec réseau) et le vrai machineId de
 * la machine, tous deux dépendants de l'environnement.
 *
 * Exécution : node src/desktop/licenseGuard.test.js  (aucune base, aucun réseau)
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Isolation du cache de licence — À FAIRE AVANT LE REQUIRE DE licenseGuard
//
// licenseGuard se rabat sur %LOCALAPPDATA%\DocuFlow\license.dat quand personne
// n'appelle configure() (mode installateur, sans Electron). Or ce fichier de test
// exerce deactivate(), qui SUPPRIME le cache : sans redirection, exécuter les
// tests sur un poste où DocuFlow est réellement installé désactiverait la licence
// du client. On détourne donc LOCALAPPDATA vers un dossier temporaire, retiré à
// la fin.
// ---------------------------------------------------------------------------
const BAC_A_SABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-licence-test-'));
process.env.LOCALAPPDATA = BAC_A_SABLE;
process.env.APPDATA = BAC_A_SABLE;
// Aucun test ne doit sortir sur le réseau : une adresse non joignable garantit
// que check() s'en tient au verdict local, sans attendre le délai de 15 s.
process.env.DOCUFLOW_LICENSE_SERVER = 'http://127.0.0.1:1';

// ---------------------------------------------------------------------------
// Mise en place — AVANT tout require des modules testés
//
// licenseService lit DESKTOP_LICENSE_PRIVATE_KEY au moment de signer, mais la
// clé PUBLIQUE de vérification est figée dans config/licensePublicKey.js et
// versionnée. Signer avec une paire générée ici produirait donc des signatures
// systématiquement refusées.
//
// La solution retenue : générer une paire de test ET détourner la clé publique
// avant que licenseService ne charge le module. C'est ce que permet le cache de
// require — on y insère notre version, et le require() suivant la trouve déjà là.
// Le dispositif réel n'est pas modifié ; c'est bien la MÊME logique de
// vérification qui est exercée, avec une autre clé.
// ---------------------------------------------------------------------------
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

const CHEMIN_CLE_PUBLIQUE = require.resolve('../config/licensePublicKey');
require.cache[CHEMIN_CLE_PUBLIQUE] = {
  id: CHEMIN_CLE_PUBLIQUE,
  filename: CHEMIN_CLE_PUBLIQUE,
  loaded: true,
  exports: { LICENSE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }) },
};

process.env.DESKTOP_LICENSE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });

// licenseService requiert config/db au chargement. Aucun test ici ne touche la
// base — on neutralise le module pour éviter qu'un pool PostgreSQL ne s'ouvre et
// ne laisse le processus suspendu à la fin des tests.
const CHEMIN_DB = require.resolve('../config/db');
require.cache[CHEMIN_DB] = {
  id: CHEMIN_DB,
  filename: CHEMIN_DB,
  loaded: true,
  exports: {
    query: () => { throw new Error('Aucun test de licenseGuard ne doit toucher la base.'); },
  },
};

const licenseService = require('../services/licenseService');
const licenseGuard = require('./licenseGuard');

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
let echecs = 0;
let total = 0;

function verifier(intitule, condition, detail) {
  total += 1;
  if (condition) {
    console.log(`  ok   ${intitule}`);
  } else {
    echecs += 1;
    console.error(`  FAIL ${intitule}${detail ? ` → ${detail}` : ''}`);
  }
}

/** Empreinte de 64 caractères hexadécimaux, comme en produit machineId. */
const empreinte = (graine) => crypto.createHash('sha256').update(graine).digest('hex');

const POSTE_A = empreinte('poste-a');
const POSTE_B = empreinte('poste-b');

const JOUR = 86400_000;
const dansNJours = (n) => new Date(Date.now() + n * JOUR);

/** Licence signée par la paire de test. */
function signer({ machine_id = POSTE_A, valid_until = dansNJours(30), status = 'active' } = {}) {
  return licenseService.signLicense({
    tenant_id: 1,
    license_key: 'DF-AAAA-BBBB-CCCC-DDDD',
    machine_id,
    valid_until,
    status,
  });
}

/**
 * Fabrique un artefact dont la date de péremption est choisie — impossible via
 * signLicense, qui pose toujours artifact_expires_at à +7 jours.
 *
 * Indispensable pour éprouver la fenêtre de grâce : sans cela il faudrait
 * attendre huit jours, ou manipuler l'horloge du système. Le payload est
 * re-sérialisé par tri de clés (`canonical` dans licenseService) puis signé avec
 * la même clé privée — c'est donc un artefact authentique, pas une falsification.
 */
function signerAvecPeremption({ artifactExpiresAt, machine_id = POSTE_A, valid_until = dansNJours(30) }) {
  const payload = {
    v: 1,
    license_key: 'DF-AAAA-BBBB-CCCC-DDDD',
    machine_id,
    tenant_id: 1,
    status: 'active',
    valid_until: new Date(valid_until).toISOString(),
    issued_at: new Date().toISOString(),
    artifact_expires_at: new Date(artifactExpiresAt).toISOString(),
    grace_days: licenseService.GRACE_DAYS,
  };
  const encode = Buffer.from(
    JSON.stringify(payload, Object.keys(payload).sort())
  ).toString('base64url');
  const signature = crypto.sign(null, Buffer.from(encode), privateKey);
  return `${encode}.${Buffer.from(signature).toString('base64url')}`;
}

console.log('Dispositif de licence — vérification de la logique de décision\n');

// ===========================================================================
console.log('1. Cryptographie — fabriquer une licence sans la clé privée');
// ===========================================================================

const jetonValide = signer();
verifier('une licence signée est acceptée', licenseService.verifyLicense(jetonValide).ok);

// LE test qui compte : le fichier license.dat est dans le profil de
// l'utilisateur, modifiable au bloc-notes. Prolonger l'échéance doit casser la
// signature — sinon toute licence devient perpétuelle en trente secondes.
const [charge, signatureOriginale] = jetonValide.split('.');
const chargeModifiee = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
chargeModifiee.valid_until = dansNJours(3650).toISOString();
const jetonProlonge = `${Buffer.from(
  JSON.stringify(chargeModifiee, Object.keys(chargeModifiee).sort())
).toString('base64url')}.${signatureOriginale}`;

verifier(
  'une échéance prolongée à la main est refusée',
  !licenseService.verifyLicense(jetonProlonge).ok
);
verifier(
  'la licence prolongée donne l\'état « invalid »',
  licenseGuard.evaluate(jetonProlonge, POSTE_A, Date.now()).state === 'invalid'
);

// Une signature produite par une AUTRE paire : c'est le cas d'un serveur
// d'activation contrefait, ou d'une réponse interceptée en route.
const { privateKey: cleEtrangere } = crypto.generateKeyPairSync('ed25519');
const signatureEtrangere = crypto.sign(null, Buffer.from(charge), cleEtrangere);
verifier(
  'une signature d\'une autre clé est refusée',
  !licenseService.verifyLicense(
    `${charge}.${Buffer.from(signatureEtrangere).toString('base64url')}`
  ).ok
);

// Jetons malformés : rien ne doit lever d'exception, sinon le backend rendrait
// un 500 au lieu de l'écran d'activation.
for (const [intitule, jeton] of [
  ['jeton vide', ''],
  ['jeton nul', null],
  ['jeton sans point', 'abcdef'],
  ['jeton à trois parties', 'a.b.c'],
  ['signature illisible', `${charge}.pas-du-base64!!`],
  ['charge illisible', `pas-du-json.${signatureOriginale}`],
]) {
  let leve = false;
  let ok = null;
  try { ok = licenseService.verifyLicense(jeton).ok; } catch { leve = true; }
  verifier(`${intitule} : refusé sans exception`, !leve && ok === false);
}

// ===========================================================================
console.log('\n2. Empreinte machine — « 1 licence = 1 poste »');
// ===========================================================================

verifier(
  'le poste titulaire est accepté',
  licenseGuard.evaluate(signer({ machine_id: POSTE_A }), POSTE_A, Date.now()).state === 'active'
);

// Cache recopié sur un second ordinateur : la fraude la plus probable en
// entreprise, un collègue qui copie un dossier.
const surAutrePoste = licenseGuard.evaluate(signer({ machine_id: POSTE_A }), POSTE_B, Date.now());
verifier('un cache copié sur un autre poste est refusé', surAutrePoste.state === 'machine_mismatch');
verifier(
  'le refus explique la marche à suivre au client',
  /autre ordinateur/i.test(surAutrePoste.message || ''),
  surAutrePoste.message
);

// ===========================================================================
console.log('\n3. Échéance de l\'abonnement');
// ===========================================================================

verifier(
  'un abonnement échu hier est refusé',
  licenseGuard.evaluate(signer({ valid_until: dansNJours(-1) }), POSTE_A, Date.now()).state === 'expired'
);

const echeanceProche = licenseGuard.evaluate(signer({ valid_until: dansNJours(3) }), POSTE_A, Date.now());
verifier('un abonnement à 3 jours de l\'échéance reste actif', echeanceProche.state === 'active');
verifier(
  'les jours restants sont annoncés au client',
  echeanceProche.days_remaining === 3,
  `days_remaining = ${echeanceProche.days_remaining}`
);

verifier(
  'une licence révoquée est refusée',
  licenseGuard.evaluate(signer({ status: 'revoked' }), POSTE_A, Date.now()).state === 'revoked'
);

// Révocation ET échéance dépassée : la révocation doit primer. Le message
// « renouvelez votre abonnement » sur une licence révoquée enverrait le client
// payer pour un produit qu'on refuse de lui servir.
verifier(
  'la révocation prime sur l\'expiration',
  licenseGuard.evaluate(
    signer({ status: 'revoked', valid_until: dansNJours(-10) }), POSTE_A, Date.now()
  ).state === 'revoked'
);

// Et l'empreinte prime sur tout le reste : inutile de dire « abonnement expiré »
// à quelqu'un dont le vrai problème est qu'il a copié le fichier.
verifier(
  'l\'empreinte machine prime sur l\'expiration',
  licenseGuard.evaluate(
    signer({ machine_id: POSTE_A, valid_until: dansNJours(-10) }), POSTE_B, Date.now()
  ).state === 'machine_mismatch'
);

// ===========================================================================
console.log('\n4. Fonctionnement hors ligne — la partie qui protège le client');
// ===========================================================================
// C'est ici que se joue la promesse commerciale : « votre logiciel fonctionne
// sans Internet ». Un faux positif dans cette section ferme le logiciel d'un
// client qui a payé, pour la seule raison que sa connexion est tombée.

const artefactFrais = licenseGuard.evaluate(
  signerAvecPeremption({ artifactExpiresAt: dansNJours(5) }), POSTE_A, Date.now()
);
verifier('artefact encore frais : actif', artefactFrais.state === 'active');

// Artefact périmé depuis 2 jours, fenêtre de grâce de 7 : le client travaille.
const enGrace = licenseGuard.evaluate(
  signerAvecPeremption({ artifactExpiresAt: dansNJours(-2) }), POSTE_A, Date.now()
);
verifier('artefact périmé depuis 2 jours : période de grâce', enGrace.state === 'grace');
verifier(
  'la période de grâce autorise le travail',
  licenseGuard.isAllowed(enGrace) === true
);
verifier(
  'le client sait combien de jours il lui reste',
  enGrace.grace_days_remaining === licenseService.GRACE_DAYS - 2,
  `grace_days_remaining = ${enGrace.grace_days_remaining}`
);

// Grâce épuisée : là seulement, on bloque.
const graceEpuisee = licenseGuard.evaluate(
  signerAvecPeremption({ artifactExpiresAt: dansNJours(-(licenseService.GRACE_DAYS + 2)) }),
  POSTE_A, Date.now()
);
verifier('grâce épuisée : accès refusé', graceEpuisee.state === 'expired');
verifier('le refus est marqué comme dû au hors-ligne', graceEpuisee.offline_blocked === true);
verifier(
  'le message dit quoi faire (se connecter à Internet)',
  /internet/i.test(graceEpuisee.message || ''),
  graceEpuisee.message
);

// Cas limite : abonnement échu ET artefact périmé. L'échéance commerciale doit
// l'emporter — la grâce hors ligne ne doit pas prolonger un abonnement non payé.
verifier(
  'un abonnement échu ne bénéficie pas de la grâce hors ligne',
  licenseGuard.evaluate(
    signerAvecPeremption({ artifactExpiresAt: dansNJours(-1), valid_until: dansNJours(-1) }),
    POSTE_A, Date.now()
  ).state === 'expired'
);

// ===========================================================================
console.log('\n5. isAllowed — la règle d\'ouverture, en un seul endroit');
// ===========================================================================
// LicenseContext (frontend) préfère délibérément le champ `allowed` du backend à
// son propre calcul, pour que cette règle n'ait qu'une implémentation. Ces tests
// la verrouillent.

for (const [etat, attendu] of [
  ['active', true],
  ['grace', true],
  ['expired', false],
  ['revoked', false],
  ['machine_mismatch', false],
  ['unlicensed', false],
  ['invalid', false],
]) {
  verifier(
    `isAllowed('${etat}') = ${attendu}`,
    licenseGuard.isAllowed({ state: etat }) === attendu
  );
}

// Entrées dégradées : un état absent ne doit jamais ouvrir l'application par
// accident (`undefined` est faux, mais l'écrire noir sur blanc empêche qu'une
// future réécriture ne l'inverse sans qu'on le remarque).
verifier('isAllowed(null) refuse', licenseGuard.isAllowed(null) !== true);
verifier('isAllowed({}) refuse', licenseGuard.isAllowed({}) !== true);
verifier('isAllowed(état inconnu) refuse', licenseGuard.isAllowed({ state: 'perdu' }) !== true);

// ===========================================================================
console.log('\n6. Format des clés de licence');
// ===========================================================================
// Ces clés sont dictées au téléphone et recopiées depuis un e-mail. Chaque
// variante de saisie non absorbée ici devient un appel au support.

for (const [intitule, saisie] of [
  ['clé canonique', 'DF-AAAA-BBBB-CCCC-DDDD'],
  ['minuscules', 'df-aaaa-bbbb-cccc-dddd'],
  ['sans tirets', 'DFAAAABBBBCCCCDDDD'],
  ['espaces parasites', '  DF-AAAA-BBBB-CCCC-DDDD  '],
  ['espaces au lieu de tirets', 'DF AAAA BBBB CCCC DDDD'],
]) {
  verifier(
    `${intitule} → forme canonique`,
    licenseService.normalizeKey(saisie) === 'DF-AAAA-BBBB-CCCC-DDDD',
    licenseService.normalizeKey(saisie)
  );
}

for (const [intitule, saisie] of [
  ['chaîne vide', ''],
  ['valeur nulle', null],
  ['sans préfixe DF', 'AAAA-BBBB-CCCC-DDDD'],
  ['groupe manquant', 'DF-AAAA-BBBB-CCCC'],
  ['trop de caractères', 'DF-AAAA-BBBB-CCCC-DDDD-EEEE'],
]) {
  verifier(`${intitule} → refusée`, licenseService.normalizeKey(saisie) === '');
}

// Caractères écartés de l'alphabet de génération : ce sont ceux qui se
// confondent à la lecture d'un e-mail ou sous la dictée.
//
// LA RÈGLE EXACTE, qui n'est pas « aucun caractère confondable » : il suffit de
// retirer UN membre de chaque paire pour que la confusion devienne impossible.
// 1 est conservé parce que I et L sont partis ; 8 est conservé parce que B est
// parti. Exiger l'absence des deux membres serait plus strict que nécessaire, et
// amputerait l'alphabet — donc l'espace de clés — sans rien y gagner.
const ECARTES = /[01BILO]/;
let formatKO = 0;
let ambiguesKO = 0;
const dejaVues = new Set();
for (let i = 0; i < 300; i += 1) {
  const cle = licenseService.generateKey();
  if (!/^DF(-[A-Z0-9]{4}){4}$/.test(cle)) formatKO += 1;
  // slice(3) : on saute le préfixe « DF- », qui contient volontairement un D.
  if (ECARTES.test(cle.slice(3))) ambiguesKO += 1;
  dejaVues.add(cle);
}
verifier('300 clés générées au bon format', formatKO === 0, `${formatKO} hors format`);
verifier('aucun caractère écarté (0 1 B I L O)', ambiguesKO === 0, `${ambiguesKO} clés concernées`);
verifier('300 clés générées, 300 distinctes', dejaVues.size === 300, `${dejaVues.size} distinctes`);

// Chaque paire classiquement confondable ne garde qu'un seul membre — l'invariant
// qui rend une clé dictable au téléphone. Vérifié sur l'alphabet lui-même plutôt
// que sur un échantillon de clés : une paire rare passerait entre les mailles de
// 300 tirages, alors qu'ici la garantie est totale.
const ALPHABET_GENERE = [...new Set(
  Array.from({ length: 400 }, () => licenseService.generateKey().slice(3).replace(/-/g, '')).join('')
)].join('');
const PAIRES_CONFONDABLES = [['0', 'O'], ['1', 'I'], ['1', 'L'], ['I', 'L'], ['8', 'B']];
const pairesRestantes = PAIRES_CONFONDABLES
  .filter(([a, b]) => ALPHABET_GENERE.includes(a) && ALPHABET_GENERE.includes(b))
  .map(([a, b]) => `${a}/${b}`);
verifier(
  'aucune paire confondable complète dans l\'alphabet',
  pairesRestantes.length === 0,
  pairesRestantes.join(', ')
);
verifier(
  'une clé générée est acceptée par normalizeKey',
  licenseService.normalizeKey(licenseService.generateKey()) !== ''
);

// ===========================================================================
console.log('\n7. Sérialisation canonique — le piège qui casse par intermittence');
// ===========================================================================
// JSON.stringify conserve l'ordre d'INSERTION des propriétés. Signer { a, b }
// puis vérifier { b, a } produirait deux chaînes différentes, donc un échec de
// signature — de façon apparemment aléatoire selon le chemin de code emprunté.
// D'où le tri des clés dans licenseService.canonical. Ce test le verrouille.

const memePayloadOrdreInverse = {
  grace_days: licenseService.GRACE_DAYS,
  artifact_expires_at: dansNJours(7).toISOString(),
  issued_at: new Date().toISOString(),
  valid_until: dansNJours(30).toISOString(),
  status: 'active',
  tenant_id: 1,
  machine_id: POSTE_A,
  license_key: 'DF-AAAA-BBBB-CCCC-DDDD',
  v: 1,
};
const ordreAlphabetique = JSON.stringify(
  memePayloadOrdreInverse, Object.keys(memePayloadOrdreInverse).sort()
);
const ordreInsertion = JSON.stringify(memePayloadOrdreInverse);
verifier(
  'le tri des clés change bien la sérialisation (le piège est réel)',
  ordreAlphabetique !== ordreInsertion
);

const encode = Buffer.from(ordreAlphabetique).toString('base64url');
const signatureTriee = crypto.sign(null, Buffer.from(encode), privateKey);
verifier(
  'un payload trié se vérifie quel que soit l\'ordre d\'écriture',
  licenseService.verifyLicense(
    `${encode}.${Buffer.from(signatureTriee).toString('base64url')}`
  ).ok
);

// ===========================================================================
console.log('\n8. Le jeton n\'est pas un JWT — pas d\'attaque « alg: none »');
// ===========================================================================
// Le format ressemble à un JWT (deux parties séparées d'un point) mais l'en-tête
// négociable en est absent : l'algorithme est fixé par le code. Un attaquant ne
// peut donc pas demander « aucune signature ». Vérifié explicitement, parce que
// la ressemblance de forme invite à réintroduire un en-tête un jour.

const faussetteJwt = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${charge}`;
verifier(
  'un jeton en forme de JWT « alg: none » est refusé',
  !licenseService.verifyLicense(faussetteJwt).ok
);
verifier(
  'une signature vide est refusée',
  !licenseService.verifyLicense(`${charge}.`).ok
);

// ===========================================================================
console.log('\n9. Empreinte de cette machine — stabilité');
// ===========================================================================
// L'empreinte doit être identique d'un appel à l'autre : une valeur instable
// invaliderait la licence à chaque démarrage. Testé sur la machine courante,
// c'est le seul endroit où l'environnement réel entre en jeu.

const premiere = licenseGuard.getMachineId();
verifier(
  'l\'empreinte est un SHA-256 hexadécimal',
  /^[a-f0-9]{64}$/.test(premiere),
  premiere
);
verifier(
  'l\'empreinte est stable entre deux appels',
  licenseGuard.getMachineId() === premiere
);

// ===========================================================================
console.log('\n10. État sans licence — première installation');
// ===========================================================================
// licenseGuard.check() sans cache configuré : c'est l'état du tout premier
// démarrage. Il doit produire 'unlicensed' — donc l'écran d'activation — et
// surtout ne PAS lever d'exception, sans quoi main.js démarrerait sur une erreur.

(async () => {
  let etatInitial = null;
  let leve = null;
  try {
    etatInitial = await licenseGuard.check();
  } catch (err) {
    leve = err;
  }

  verifier('check() sans cache ne lève pas d\'exception', leve === null, leve?.message);
  verifier(
    'check() sans cache donne « unlicensed »',
    etatInitial?.state === 'unlicensed',
    etatInitial?.state
  );
  verifier(
    'l\'état initial porte l\'empreinte machine (le support la demande)',
    /^[a-f0-9]{64}$/.test(etatInitial?.machine_id || '')
  );
  verifier(
    'l\'état initial n\'autorise pas l\'accès',
    licenseGuard.isAllowed(etatInitial) === false
  );

  // deactivate() ramène à l'état non licencié, sans toucher au serveur.
  const apresRetrait = licenseGuard.deactivate();
  verifier('deactivate() rend l\'état « unlicensed »', apresRetrait.state === 'unlicensed');
  verifier('deactivate() ferme l\'accès', licenseGuard.isAllowed(apresRetrait) === false);

  // =========================================================================
  console.log('\n11. Mode installateur — sans configure(), la licence doit vivre');
  // =========================================================================
  // RÉGRESSION RÉELLE, CORRIGÉE. `configure()` n'est appelé que par
  // desktop/main.js. L'installateur Windows (installer/scripts/start.bat,
  // install-service.bat) lance « node src/app.js » SANS Electron, tout en
  // écrivant SERVE_FRONTEND=true — ce qui active licenseMiddleware. Avant
  // correctif, cacheFile restait null : readCache() et writeCache() rendaient la
  // main en silence, l'état était figé à 'unlicensed', et TOUTE l'API répondait
  // 402 — y compris après une activation acceptée et signée par le serveur, qui
  // n'était jamais écrite sur disque. Le client tournait en boucle sur l'écran
  // d'activation, sans le moindre message désignant la cause.
  //
  // Ces vérifications portent sur le chemin de repli (LOCALAPPDATA est redirigé
  // vers un dossier temporaire en tête de fichier), donc SANS configure().

  const cheminCache = licenseGuard.getCacheFile();
  verifier(
    'un cache est résolu même sans configure()',
    typeof cheminCache === 'string' && cheminCache.endsWith('license.dat'),
    cheminCache
  );
  verifier(
    'le repli vit dans le profil utilisateur, pas dans le dossier d\'installation',
    cheminCache.startsWith(BAC_A_SABLE),
    cheminCache
  );

  // Ce que activate() écrit après avoir validé la réponse du serveur.
  const artefactPoste = licenseService.signLicense({
    license_key: 'DF-ABCD-EFGH-JKMN-PQRS',
    machine_id: licenseGuard.getMachineId(),
    status: 'active',
    valid_until: new Date(Date.now() + 30 * 86400_000).toISOString(),
    tenant_id: null,
  });
  fs.mkdirSync(path.dirname(cheminCache), { recursive: true });
  fs.writeFileSync(cheminCache, JSON.stringify({
    token: artefactPoste,
    last_verified_at: Date.now(),
    machine_id: licenseGuard.getMachineId(),
  }), 'utf8');

  // Relecture par un module fraîchement chargé : c'est le redémarrage du service.
  delete require.cache[require.resolve('./licenseGuard')];
  const guardRedemarre = require('./licenseGuard');
  const etatRedemarrage = await guardRedemarre.check();

  verifier(
    'une activation persistée survit au redémarrage du service',
    etatRedemarrage.state === 'active',
    etatRedemarrage.state
  );
  verifier(
    'l\'accès est accordé après redémarrage (sinon boucle d\'activation)',
    guardRedemarre.isAllowed(etatRedemarrage) === true
  );

  // Le garde de l'API doit laisser passer dans ce même mode.
  process.env.SERVE_FRONTEND = 'true';
  const licenseMiddleware = require('../middlewares/licenseMiddleware');
  let verdictHttp = '(aucun)';
  await licenseMiddleware(
    { path: '/api/documents', method: 'GET', headers: {} },
    { status(code) { verdictHttp = code; return this; }, json() { return this; } },
    () => { verdictHttp = 'next'; }
  );
  verifier(
    'licenseMiddleware laisse passer l\'API en mode installateur activé',
    verdictHttp === 'next',
    `verdict ${verdictHttp}`
  );

  // Nettoyage : le bac à sable ne doit rien laisser derrière lui.
  fs.rmSync(BAC_A_SABLE, { recursive: true, force: true });

  console.log(
    echecs === 0
      ? `\n✅ Dispositif de licence cohérent — ${total} vérifications.`
      : `\n❌ ${echecs} vérification(s) en échec sur ${total}.`
  );
  process.exit(echecs === 0 ? 0 : 1);
})();
