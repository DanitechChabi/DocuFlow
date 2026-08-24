// ============================================================================
// licenseGuard — décide si cette installation a le droit de fonctionner.
//
// PRINCIPE : la décision se prend HORS LIGNE, sur un artefact signé Ed25519 mis
// en cache localement (voir services/licenseService.js). Le réseau ne sert qu'à
// renouveler cet artefact tous les 7 jours. Un client dont la connexion tombe
// continue donc de travailler.
//
// LES DEUX ERREURS DE CONCEPTION QUE CE FICHIER ÉVITE
//
//   1. Confondre « le serveur est injoignable » et « la licence est invalide ».
//      C'est l'erreur qui coûte des clients : une coupure Internet, un pare-feu
//      d'entreprise ou une panne de Render bloquerait un logiciel payé. Ici, un
//      échec réseau ne bloque JAMAIS tant que l'artefact en cache reste dans sa
//      fenêtre de grâce.
//
//   2. Faire confiance aux champs en clair. Le fichier license.dat est dans le
//      profil de l'utilisateur, modifiable au bloc-notes. TOUTE décision se
//      prend sur le payload dont la signature vient d'être vérifiée. Les champs
//      lisibles ne servent qu'à l'affichage.
//
// ÉTATS RENVOYÉS (l'interface s'y fie pour choisir son message)
//   active           — tout va bien
//   grace            — hors ligne, artefact périmé, N jours restants
//   expired          — abonnement échu (date dépassée)
//   revoked          — licence révoquée par le vendeur
//   machine_mismatch — cache copié depuis un autre poste
//   unlicensed       — aucune licence (première installation)
//   invalid          — cache illisible ou signature fausse
//
// DEUX MODES DE DÉMARRAGE, UN SEUL CACHE
// Sous Electron, desktop/main.js appelle `configure()` avec le profil de
// l'application. L'installateur Windows, lui, lance `node src/app.js` sans
// Electron : personne n'appelle `configure()`, et le module se rabat alors sur
// %LOCALAPPDATA%\DocuFlow\license.dat (voir defaultCacheDir). Sans ce repli, ce
// second mode ne pouvait NI lire NI écrire de licence, donc ne pouvait pas être
// activé du tout.
//
// CE QUE CE DISPOSITIF NE PROTÈGE PAS : le code est livré en JavaScript lisible.
// Quelqu'un de motivé peut supprimer l'appel qui invoque ce module. C'est le
// plafond de toute protection logicielle non obfusquée ; l'objectif ici est de
// décourager le partage de clé entre postes, pas de résister à un cracker.
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const { verifyLicense, GRACE_DAYS } = require('../services/licenseService');
const { getMachineId, getMachineLabel } = require('./machineId');

// Serveur de licence. Surchargeable pour les essais ; en production c'est le
// backend Render qui détient la clé privée.
const LICENSE_SERVER = process.env.DOCUFLOW_LICENSE_SERVER
  || 'https://docuflow-b5x1.onrender.com';

// Délai réseau volontairement court : ce n'est pas au client d'attendre que
// Render sorte de veille. En cas d'échec, la grâce couvre la période — et une
// nouvelle tentative aura lieu au prochain démarrage.
const NETWORK_TIMEOUT_MS = 15000;

// Renouvellement tenté dès que l'artefact approche de sa péremption, pas une
// fois qu'elle est atteinte : sinon un client qui ouvre son logiciel une fois
// par semaine tomberait systématiquement en grâce.
const REFRESH_MARGIN_MS = 24 * 3600 * 1000;

let cacheFile = null;
let lastState = null;

/**
 * Emplacement du cache quand personne n'a appelé `configure()`.
 *
 * POURQUOI CE REPLI EXISTE — il répare une panne totale, pas un confort.
 * `configure()` n'est appelé qu'à un seul endroit du dépôt : desktop/main.js.
 * Or l'installateur Windows (installer/) démarre le backend SANS Electron
 * (install-service.bat, start.bat lancent `node src\app.js`) tout en écrivant
 * SERVE_FRONTEND=true dans le .env — ce qui ACTIVE licenseMiddleware. Sans ce
 * repli, `cacheFile` restait null : readCache() rendait la main aussitôt, l'état
 * était 'unlicensed', et toute l'API répondait 402. Pire, writeCache() sortait
 * aussi en silence, donc une activation pourtant acceptée et signée par le
 * serveur n'était JAMAIS écrite : le client saisissait une clé valide et
 * retombait indéfiniment sur l'écran d'activation. Le seul chemin de vente
 * hors Electron était donc mort, sans message et sans issue.
 *
 * LOCALVEDATA ET NON LE DOSSIER D'INSTALLATION : la tâche planifiée tourne en
 * SYSTEM et le service peut être lancé par un compte sans droits d'écriture dans
 * « C:\Program Files ». On garde le même nom de fichier que sous Electron
 * (license.dat) pour que le support n'ait qu'un seul chemin à connaître par mode.
 */
function defaultCacheDir() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir() || os.tmpdir();
  return path.join(base, 'DocuFlow');
}

/**
 * Chemin du cache, en initialisant le repli au premier besoin.
 *
 * Résolu paresseusement et non au chargement du module : `configure()` doit
 * garder la priorité, et il est appelé après le require côté Electron.
 */
function resolveCacheFile() {
  if (!cacheFile) {
    cacheFile = path.join(defaultCacheDir(), 'license.dat');
    console.warn(
      '[license] configure() non appelé — cache de licence par défaut : '
      + `${cacheFile} (mode hors Electron).`
    );
  }
  return cacheFile;
}

/** Le cache vit dans le profil utilisateur : pas de droits admin requis. */
function configure({ userDataDir }) {
  cacheFile = path.join(userDataDir, 'license.dat');
}

// ---------------------------------------------------------------------------
// Cache local
// ---------------------------------------------------------------------------

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(resolveCacheFile(), 'utf8'));
  } catch {
    // Fichier absent au premier lancement, ou corrompu (coupure pendant une
    // écriture). Dans les deux cas : pas de licence utilisable.
    return null;
  }
}

function writeCache(data) {
  const cible = resolveCacheFile();
  try {
    // Le dossier de repli n'existe pas à la première activation, et un
    // writeFileSync dans un dossier absent échoue — ce qui reproduirait
    // exactement la perte d'activation que ce repli corrige.
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    // Écriture par fichier temporaire puis renommage : une coupure de courant en
    // pleine écriture laisserait sinon un license.dat tronqué, et le client
    // verrait son logiciel redemander une activation sans raison.
    const tmp = `${cible}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, cible);
  } catch (err) {
    console.error('[license] Cache non enregistré :', err.message);
  }
}

function clearCache() {
  try { fs.rmSync(resolveCacheFile(), { force: true }); } catch { /* déjà absent */ }
}

// ---------------------------------------------------------------------------
// Appel au serveur de licence
// ---------------------------------------------------------------------------

/**
 * POST JSON minimal. `http`/`https` natifs plutôt qu'axios : ce code tourne dans
 * le processus principal d'Electron, où toute dépendance supplémentaire est du
 * poids dans l'installateur pour un unique appel.
 *
 * Ne rejette JAMAIS sur un code HTTP d'erreur : le corps de la réponse porte le
 * motif (403 REVOKED, 402 PAYMENT_PENDING…), qui est précisément ce qu'il faut
 * montrer au client.
 */
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;

    const req = client.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname,
      method: 'POST',
      timeout: NETWORK_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        'User-Agent': 'DocuFlow-Desktop',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* réponse non JSON (page d'erreur d'un proxy) */ }
        resolve({ status: res.statusCode, body: json, raw: text });
      });
    });

    req.on('timeout', () => { req.destroy(new Error('délai dépassé')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Interprétation d'un artefact
// ---------------------------------------------------------------------------

const days = (ms) => Math.max(0, Math.ceil(ms / 86400_000));

/**
 * Évalue un jeton signé au regard de l'heure locale et de cette machine.
 *
 * @param {string} token artefact signé
 * @param {string} machineId empreinte de CE poste
 * @param {number} [lastVerifiedAt] horodatage du dernier contact serveur réussi
 */
function evaluate(token, machineId, lastVerifiedAt) {
  const verdict = verifyLicense(token);
  if (!verdict.ok) {
    // Signature fausse : soit le fichier a été bricolé, soit il vient d'une
    // autre installation. On ne distingue pas — dans les deux cas il est inutilisable.
    return { state: 'invalid', reason: verdict.reason, message: 'Licence illisible ou altérée.' };
  }

  const p = verdict.payload;
  const now = Date.now();

  if (p.machine_id && p.machine_id !== machineId) {
    return {
      state: 'machine_mismatch',
      message: 'Cette licence est enregistrée pour un autre ordinateur.\n'
        + 'Le support peut la transférer sur ce poste.',
      license_key: p.license_key,
    };
  }

  if (p.status === 'revoked') {
    return { state: 'revoked', message: 'Cette licence a été révoquée.', license_key: p.license_key };
  }

  // Échéance de l'ABONNEMENT — la seule date qui compte commercialement.
  const validUntil = p.valid_until ? Date.parse(p.valid_until) : null;
  if (!validUntil || Number.isNaN(validUntil)) {
    return { state: 'unlicensed', message: 'Aucun abonnement actif sur cette licence.', license_key: p.license_key };
  }
  if (validUntil < now) {
    return {
      state: 'expired',
      message: 'Votre abonnement a expiré.',
      valid_until: p.valid_until,
      license_key: p.license_key,
    };
  }

  // Péremption de l'ARTEFACT — le levier de révocation. Un artefact périmé ne
  // rend pas la licence invalide : il oblige à revenir vérifier auprès du
  // serveur, et ouvre la fenêtre de grâce si le réseau manque.
  const artifactExpiry = p.artifact_expires_at ? Date.parse(p.artifact_expires_at) : null;
  const graceWindow = (p.grace_days ?? GRACE_DAYS) * 86400_000;
  const base = {
    license_key: p.license_key,
    valid_until: p.valid_until,
    days_remaining: days(validUntil - now),
    machine_id: machineId,
    last_verified_at: lastVerifiedAt || null,
  };

  if (artifactExpiry && artifactExpiry < now) {
    const overdue = now - artifactExpiry;
    if (overdue > graceWindow) {
      return {
        ...base,
        state: 'expired',
        message: 'Vérification de licence impossible depuis trop longtemps.\n'
          + 'Connectez cet ordinateur à Internet pour réactiver DocuFlow.',
        offline_blocked: true,
      };
    }
    return {
      ...base,
      state: 'grace',
      grace_days_remaining: days(graceWindow - overdue),
      message: `Licence non vérifiée depuis ${days(overdue)} jour(s). `
        + `Connectez-vous à Internet dans les ${days(graceWindow - overdue)} jour(s).`,
    };
  }

  return { ...base, state: 'active', artifact_expires_at: p.artifact_expires_at };
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Active cette installation avec une clé saisie par l'utilisateur.
 * Contrairement à `check()`, un échec réseau est ici une VRAIE erreur : il n'y a
 * pas d'artefact en cache sur lequel se replier.
 */
async function activate(licenseKey) {
  const machineId = getMachineId();
  let response;
  try {
    response = await postJson(`${LICENSE_SERVER}/api/licenses/activate`, {
      license_key: licenseKey,
      machine_id: machineId,
      machine_label: getMachineLabel(),
    });
  } catch (err) {
    return {
      ok: false,
      state: 'network_error',
      message: 'Impossible de joindre le serveur d\'activation.\n'
        + 'Vérifiez votre connexion Internet, puis réessayez.',
      detail: err.message,
    };
  }

  if (response.status !== 200 || !response.body?.token) {
    return {
      ok: false,
      state: 'rejected',
      code: response.body?.code || `HTTP_${response.status}`,
      message: response.body?.message || 'Activation refusée par le serveur.',
    };
  }

  // Le serveur a répondu, mais on ne le croit pas sur parole : la signature est
  // vérifiée AVANT d'écrire quoi que ce soit. Une réponse interceptée et
  // modifiée en route (proxy d'entreprise, DNS détourné) est ainsi écartée.
  const evaluated = evaluate(response.body.token, machineId, Date.now());
  if (evaluated.state === 'invalid') {
    return {
      ok: false,
      state: 'invalid',
      message: 'Le serveur a renvoyé une licence illisible. Contactez le support.',
    };
  }

  writeCache({ token: response.body.token, last_verified_at: Date.now(), machine_id: machineId });
  lastState = evaluated;
  return { ok: true, ...evaluated };
}

/**
 * État de la licence, avec renouvellement de l'artefact si nécessaire.
 *
 * @param {boolean} [force] renouveler même si l'artefact est encore frais
 *   (bouton « Vérifier maintenant » de l'écran de licence)
 */
async function check({ force = false } = {}) {
  const machineId = getMachineId();
  const cache = readCache();

  if (!cache?.token) {
    lastState = {
      state: 'unlicensed',
      message: 'Cette installation n\'est pas encore activée.',
      machine_id: machineId,
    };
    return lastState;
  }

  let current = evaluate(cache.token, machineId, cache.last_verified_at);

  // Faut-il retourner voir le serveur ? Oui si l'artefact est périmé ou proche
  // de l'être, ou si l'utilisateur le demande. Non si tout est frais : le
  // démarrage quotidien ne doit pas dépendre du réseau.
  const artifact = verifyLicense(cache.token);
  const expiry = artifact.ok && artifact.payload.artifact_expires_at
    ? Date.parse(artifact.payload.artifact_expires_at)
    : 0;
  const needsRefresh = force
    || current.state === 'grace'
    || (current.state === 'expired' && current.offline_blocked)
    || expiry - Date.now() < REFRESH_MARGIN_MS;

  // Inutile d'appeler le serveur quand le verdict local est définitif : une
  // signature fausse ou une machine différente ne se corrigent pas par un appel
  // réseau, et une licence révoquée le reste.
  const definitive = ['invalid', 'machine_mismatch', 'revoked'].includes(current.state);

  if (needsRefresh && !definitive && current.license_key) {
    try {
      const response = await postJson(`${LICENSE_SERVER}/api/licenses/refresh`, {
        license_key: current.license_key,
        machine_id: machineId,
      });

      if (response.status === 200 && response.body?.token) {
        const fresh = evaluate(response.body.token, machineId, Date.now());
        if (fresh.state !== 'invalid') {
          writeCache({ token: response.body.token, last_verified_at: Date.now(), machine_id: machineId });
          current = fresh;
        }
      } else if (response.status === 403 && ['REVOKED', 'EXPIRED'].includes(response.body?.code)) {
        // Le serveur est formel : cette licence n'a plus cours. On efface le
        // cache, sinon l'artefact encore valide autoriserait le logiciel
        // jusqu'à sa péremption.
        clearCache();
        current = {
          state: response.body.code === 'REVOKED' ? 'revoked' : 'expired',
          message: response.body.message,
          license_key: current.license_key,
          machine_id: machineId,
        };
      } else if (response.status === 409) {
        current = {
          state: 'machine_mismatch',
          message: response.body?.message || 'Licence liée à un autre ordinateur.',
          license_key: current.license_key,
          machine_id: machineId,
        };
      }
      // Autres codes (402 en attente, 429 débit, 503 non configuré, 5xx) : on
      // garde le verdict local. Le client a payé ; un incident côté serveur ne
      // doit pas lui fermer son logiciel tant que la grâce court.
    } catch (err) {
      // ÉCHEC RÉSEAU ≠ ÉCHEC DE LICENCE. C'est le point le plus important de ce
      // fichier : on conserve le verdict local établi sur l'artefact en cache.
      console.log(`[license] Vérification en ligne impossible (${err.message}) — verdict local conservé.`);
      current.offline = true;
    }
  }

  lastState = current;
  return current;
}

/** Dernier état connu, sans aucun appel réseau ni lecture disque. */
function getState() {
  return lastState;
}

/** L'application doit-elle fonctionner ? 'grace' est autorisé, c'est son objet. */
function isAllowed(state = lastState) {
  return state?.state === 'active' || state?.state === 'grace';
}

/** Retire la licence de ce poste (changement d'ordinateur, revente). */
function deactivate() {
  clearCache();
  lastState = { state: 'unlicensed', message: 'Licence retirée de cet ordinateur.' };
  return lastState;
}

module.exports = {
  configure,
  activate,
  check,
  getState,
  isAllowed,
  deactivate,
  evaluate,          // exporté pour les tests
  getCacheFile: resolveCacheFile, // exporté pour les tests (et le support)
  getMachineId,
  LICENSE_SERVER,
};
