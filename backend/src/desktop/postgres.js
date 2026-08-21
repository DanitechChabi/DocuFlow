// ============================================================================
// postgres.js — pilote l'instance PostgreSQL embarquée de l'app de bureau.
//
// POURQUOI
// Sans ce module, DocuFlow exige que le client installe PostgreSQL lui-même :
// il voit sinon la modale « PostgreSQL introuvable » de desktop/main.js. Pour un
// acheteur non technique, c'est le logiciel qui ne marche pas.
//
// Ici, les binaires sont embarqués (desktop/scripts/fetch-postgres.js les
// récupère à la compilation) et le cluster vit dans le profil de l'utilisateur :
//   <userData>/pgdata        — les données (donc SUR LE DISQUE DU CLIENT)
//   <userData>/postgres.log  — le journal du serveur, indispensable au support
//
// CHOIX D'AUTHENTIFICATION
// initdb avec --auth=trust : pas de mot de passe. C'est acceptable — et
// seulement parce que — le serveur n'écoute que sur 127.0.0.1 (`-h 127.0.0.1`).
// Un mot de passe n'apporterait rien : il faudrait le stocker en clair à côté,
// dans un fichier lisible par le même utilisateur Windows que pgdata. La vraie
// frontière de sécurité est le compte Windows, pas un secret recopié.
//
// CE MODULE NE DÉPEND PAS D'ELECTRON : il vit dans backend/src pour résoudre
// ses require() depuis backend/node_modules (comme bootstrap.js), et reçoit son
// répertoire de données en paramètre plutôt que d'appeler app.getPath().
// ============================================================================
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFileSync, spawn } = require('child_process');

// Le port n'est pas 5432 : une installation PostgreSQL déjà présente sur le
// poste l'occupe, et on ne veut ni la perturber ni s'y connecter par accident.
// Plage plutôt que port unique — deux comptes Windows ouverts en session
// simultanée auraient chacun leur cluster.
const PORT_RANGE_START = 55432;
const PORT_RANGE_END = 55452;

const SUPERUSER = 'docuflow';
const DATABASE = 'docuflow';

// Instance que NOUS avons démarrée (ou reprise). stopSync() ne touche à rien
// d'autre : arrêter un PostgreSQL qui n'est pas le nôtre serait une faute.
let current = null; // { root, dataDir, port, logFile }

const isWindows = process.platform === 'win32';
const exe = (name) => (isWindows ? `${name}.exe` : name);

// ----------------------------------------------------------------------------
// Localisation des binaires
// ----------------------------------------------------------------------------

/**
 * Emplacements possibles de vendor/pgsql, du plus explicite au plus général.
 *
 * `resources/pgsql` en premier parmi les emplacements packagés : les exécutables
 * doivent être placés par electron-builder en `extraResources`, JAMAIS dans
 * `files`. Avec `asar: true`, tout ce qui passe par `files` finit dans
 * app.asar — et Windows ne sait pas exécuter un .exe depuis une archive.
 */
function candidateRoots() {
  const roots = [];
  if (process.env.DOCUFLOW_PG_DIR) roots.push(process.env.DOCUFLOW_PG_DIR);
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'pgsql'));
  // backend/src/desktop → ../../.. = racine du dépôt (dev) ou resources/app (packagé)
  const appRoot = path.join(__dirname, '..', '..', '..');
  roots.push(path.join(appRoot, 'desktop', 'vendor', 'pgsql'));
  roots.push(path.join(appRoot, 'vendor', 'pgsql'));
  return roots;
}

/** Racine des binaires embarqués, ou null s'ils ne sont pas là. */
function pgRoot() {
  for (const root of candidateRoots()) {
    if (root && fs.existsSync(path.join(root, 'bin', exe('postgres')))) return root;
  }
  return null;
}

/** Les binaires embarqués sont-ils disponibles ? Sinon : repli sur un PG installé. */
function isAvailable() {
  return pgRoot() !== null;
}

function binary(root, name) {
  return path.join(root, 'bin', exe(name));
}

// ----------------------------------------------------------------------------
// État du cluster
// ----------------------------------------------------------------------------

/** Un cluster existe-t-il déjà dans ce répertoire ? */
function isInitialized(dataDir) {
  return fs.existsSync(path.join(dataDir, 'PG_VERSION'));
}

/** Version MAJEURE du cluster sur disque (« 17 »), ou null. */
function clusterVersion(dataDir) {
  try {
    return fs.readFileSync(path.join(dataDir, 'PG_VERSION'), 'utf8').trim().split('.')[0];
  } catch {
    return null;
  }
}

/** Version MAJEURE des binaires embarqués (« 17 »), ou null. */
function bundledVersion(root) {
  try {
    const out = execFileSync(binary(root, 'postgres'), ['--version'], { encoding: 'utf8' });
    const m = out.match(/(\d+)(?:\.\d+)?/);
    return m ? m[1] : null;
  } catch {
    // Repli sur la trace laissée par fetch-postgres.js si postgres.exe ne
    // s'exécute pas (DLL Visual C++ manquante, antivirus…).
    try {
      const txt = fs.readFileSync(path.join(root, 'DOCUFLOW_PG_VERSION.txt'), 'utf8');
      return txt.trim().split(/[.\-]/)[0];
    } catch {
      return null;
    }
  }
}

/**
 * PID et port d'un serveur déjà lancé sur ce cluster.
 * postmaster.pid : ligne 1 = PID, ligne 4 = port.
 */
function readPidFile(dataDir) {
  try {
    const lines = fs.readFileSync(path.join(dataDir, 'postmaster.pid'), 'utf8').split('\n');
    const port = parseInt(lines[3], 10);
    return { pid: parseInt(lines[0], 10), port: Number.isFinite(port) ? port : null };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Ports
// ----------------------------------------------------------------------------

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function pickPort() {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(
    `Aucun port libre entre ${PORT_RANGE_START} et ${PORT_RANGE_END} pour la base de données locale.`
  );
}

// ----------------------------------------------------------------------------
// Cycle de vie
// ----------------------------------------------------------------------------

/**
 * Le serveur accepte-t-il les connexions ? Sondage par pg_isready.
 * Codes de sortie : 0 prêt · 1 en cours de démarrage · 2 muet · 3 appel invalide.
 *
 * Appel court et sans sortie utile, mais il tourne en boucle : là aussi, pas de
 * tuyau (voir runDetached), sinon chaque sondage paierait le prix d'un pipe.
 */
async function pingReady(root, port) {
  try {
    await runDetached(binary(root, 'pg_isready'), [
      '-h', '127.0.0.1', '-p', String(port), '-U', SUPERUSER, '-d', 'postgres',
    ], { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function waitReady(root, port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await pingReady(root, port)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * Crée le cluster. Premier lancement uniquement — quelques secondes, d'où
 * l'écran d'attente côté main.js.
 *
 * DEUX TENTATIVES, et c'est délibéré. Sur Windows, `initdb -E UTF8` échoue quand
 * la locale du système impose un autre encodage (« encoding UTF8 does not match
 * locale ... requires encoding WIN1252 ») — sur un Windows français, c'est le cas
 * courant, pas l'exception. La première tentative demande donc à ICU (embarqué)
 * de fournir le classement français tout en laissant la locale libc à C, ce qui
 * supprime le conflit. Si cette combinaison est refusée, la seconde renonce au
 * classement français : les noms accentués se trient alors après « z », ce qui se
 * remarque mais n'empêche rien — nettement préférable à un logiciel qui ne
 * démarre pas.
 */
async function init(root, dataDir) {
  // ------------------------------------------------------------------------
  // GARDE-FOU CONTRE LA PERTE DE DONNÉES — ne pas retirer.
  //
  // La reprise entre les deux tentatives doit vider le répertoire (initdb exige
  // un répertoire vide). Cette suppression n'est acceptable QUE si l'on a
  // d'abord établi que le répertoire ne contenait rien à nous.
  //
  // Le cas qu'il s'agit d'écarter : un pgdata dont le fichier PG_VERSION a
  // disparu (copie incomplète, antivirus, coupure) mais dont base/ contient
  // encore toute la GED du client. isInitialized() le déclarerait « non
  // initialisé », init() serait appelé, et la reprise effacerait les documents
  // — sur un logiciel vendu précisément parce que les données restent chez le
  // client. Mieux vaut refuser de démarrer et faire appeler le support.
  // ------------------------------------------------------------------------
  if (fs.existsSync(dataDir)) {
    const contenu = fs.readdirSync(dataDir);
    if (contenu.length > 0) {
      throw new Error(
        `Le répertoire de données existe déjà et n'est pas vide, mais ne ressemble pas `
        + `à une base DocuFlow valide (fichier PG_VERSION absent).\n`
        + `Par précaution, rien n'a été supprimé : ce répertoire peut contenir vos documents.\n`
        + `Répertoire : ${dataDir}\n`
        + 'Contactez le support avant toute manipulation.'
      );
    }
  }

  const attempts = [
    {
      label: 'UTF8 + classement français (ICU)',
      args: ['--encoding=UTF8', '--locale-provider=icu', '--icu-locale=fr-FR', '--locale=C'],
    },
    {
      label: 'UTF8 + classement binaire',
      args: ['--encoding=UTF8', '--locale=C'],
    },
  ];

  fs.mkdirSync(path.dirname(dataDir), { recursive: true });

  let lastError = null;
  for (const attempt of attempts) {
    try {
      // initdb écrit abondamment sur sa sortie standard ; on la jette. Mais on
      // CAPTE stderr : initdb ne laisse aucun processus derrière lui (le tuyau
      // est donc sans danger) et son motif d'échec n'apparaît dans aucun
      // journal — sans cela, un refus de locale se réduirait à « code 1 ».
      await runDetached(binary(root, 'initdb'), [
        '-D', dataDir,
        '-U', SUPERUSER,
        '--auth-local=trust',
        '--auth-host=trust',
        ...attempt.args,
      ], { timeout: 180000, capture: true });
      console.log(`[postgres] Cluster créé (${attempt.label}) : ${dataDir}`);
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[postgres] initdb refusé (${attempt.label}) : ${firstLine(err)}`);
      // Sans danger ici, et seulement ici : le garde-fou ci-dessus a établi que
      // le répertoire était vide (ou absent) avant la première tentative, donc
      // tout ce qu'il contient est un reliquat de l'initdb qui vient d'échouer.
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }
  throw new Error(`Création de la base de données impossible.\n${firstLine(lastError)}`);
}

/**
 * Message d'erreur utile.
 *
 * `runDetached` jette les flux, donc `err.stderr` est vide : le diagnostic vient
 * de `err.details`, que les appelants renseignent quand ils ont capté la sortie
 * (cas d'initdb, dont l'échec n'apparaît dans AUCUN journal).
 */
function firstLine(err) {
  if (!err) return 'raison inconnue';
  const text = String(err.details || err.stderr || err.stdout || err.message || '').trim();
  return text.split('\n').filter(Boolean).slice(-3).join(' · ') || 'raison inconnue';
}

/**
 * Décode la sortie d'un binaire PostgreSQL sous Windows.
 *
 * Constaté sur ce poste : `chcp` renvoie 850 et initdb écrit ses messages
 * français dans cette page de codes. Lus en UTF-8, « répertoire » devient
 * « r�pertoire » dans la boîte de dialogue du client.
 *
 * On tente donc UTF-8 d'abord — c'est ce que produit PostgreSQL dans d'autres
 * configurations, et le refuser casserait ces cas — et on retombe sur latin1
 * dès qu'apparaît un caractère de remplacement, signe que les octets n'étaient
 * pas de l'UTF-8. latin1 ne peut pas échouer (tout octet y est valide), donc
 * cette fonction rend toujours quelque chose de lisible.
 */
function decodeConsole(buffer) {
  if (!buffer || buffer.length === 0) return '';
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('�')) return utf8.trim();
  return buffer.toString('latin1').trim();
}

/**
 * Lance un binaire PostgreSQL en détachant complètement ses flux.
 *
 * IL FAUT spawn() ET PAS execFile() ICI, et c'est le détail qui a coûté 90
 * secondes à chaque démarrage : execFile() crée toujours des tuyaux pour capter
 * la sortie (l'option `stdio` y est ignorée). pg_ctl démarre le postmaster en
 * arrière-plan, celui-ci HÉRITE de ces tuyaux et ne les ferme jamais puisqu'il
 * vit tant que la base tourne. execFile(), qui attend la fermeture des flux et
 * pas seulement la fin du processus, ne rendait donc la main qu'à l'expiration
 * de son délai — 90 s de fixe, pour 0,8 s de travail réel.
 *
 * Avec spawn() + stdio 'ignore', les descripteurs pointent sur le néant : rien
 * à hériter, et l'événement 'close' arrive dès que pg_ctl se termine.
 *
 * `capture: true` rétablit un tuyau sur stderr — réservé aux commandes qui NE
 * LAISSENT AUCUN PROCESSUS DERRIÈRE ELLES (initdb), et dont le motif d'échec
 * n'apparaît dans aucun journal. Ne jamais l'activer pour `pg_ctl start`.
 */
function runDetached(file, args, { timeout = 90000, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: capture ? ['ignore', 'ignore', 'pipe'] : 'ignore',
      windowsHide: true,
    });

    let stderrChunks = [];
    if (capture && child.stderr) {
      // PAS de setEncoding('utf8') : sous Windows, initdb écrit ses messages
      // dans la page de codes de la console (850 sur un Windows français), pas
      // en UTF-8. Décodés en UTF-8, les accents deviennent des « r�pertoire » —
      // et ce texte finit dans une boîte de dialogue lue par le client. On garde
      // donc les octets bruts et on décide du décodage à la fin.
      child.stderr.on('data', (chunk) => {
        // Borné : un message d'erreur ne fait pas 1 Mo, et on ne veut pas garder
        // en mémoire la sortie d'un binaire devenu bavard.
        if (stderrChunks.length < 32) stderrChunks.push(chunk);
      });
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${path.basename(file)} n'a pas répondu en ${Math.round(timeout / 1000)} s`));
    }, timeout);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) return resolve();
      const err = new Error(`${path.basename(file)} a échoué (code ${code})`);
      err.exitCode = code;
      err.details = decodeConsole(Buffer.concat(stderrChunks));  // vide si capture=false
      reject(err);
    });
  });
}

/**
 * Démarre le serveur et renvoie son port.
 *
 * Reprend une instance déjà vivante sur ce cluster au lieu d'échouer : un plantage
 * d'Electron laisse un postgres.exe orphelin, et refuser de démarrer dans ce cas
 * obligerait le client à redémarrer son ordinateur.
 */
async function start(root, dataDir, logFile) {
  const existing = readPidFile(dataDir);
  if (existing && existing.port && await pingReady(root, existing.port)) {
    console.log(`[postgres] Instance déjà en service sur le port ${existing.port} — reprise.`);
    current = { root, dataDir, port: existing.port, logFile };
    return existing.port;
  }

  const port = await pickPort();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  // `-l <fichier>` n'est pas cosmétique : il redirige la sortie du postmaster
  // vers un fichier au lieu des flux hérités, et c'est le seul journal dont
  // disposera le support quand un client appellera.
  await runDetached(binary(root, 'pg_ctl'), [
    'start',
    '-D', dataDir,
    '-l', logFile,
    '-w', '-t', '60',
    '-o', `-p ${port} -h 127.0.0.1`,
  ], { timeout: 90000 });

  current = { root, dataDir, port, logFile };
  return port;
}

/**
 * Arrêt SYNCHRONE — appelé depuis app.on('will-quit'), où une promesse n'a
 * aucune garantie d'être tenue avant la fin du processus.
 *
 * Sans cet arrêt, le postgres.exe survivant garde le verrou de pgdata et le
 * lancement suivant échoue devant un client qui n'y comprend rien. `-m fast`
 * plutôt que `smart` : on n'attend pas la fermeture des connexions, l'app vient
 * précisément de les abandonner.
 */
function stopSync() {
  if (!current) return false;
  const { root, dataDir } = current;
  current = null;
  try {
    execFileSync(binary(root, 'pg_ctl'), [
      'stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '30',
    ], { timeout: 40000, windowsHide: true, stdio: 'ignore' });
    console.log('[postgres] Instance arrêtée.');
    return true;
  } catch (err) {
    console.error(`[postgres] Arrêt impossible : ${firstLine(err)}`);
    return false;
  }
}

/**
 * Point d'entrée unique pour main.js : garantit qu'un serveur local répond, et
 * renvoie de quoi le joindre.
 *
 * @param {string} dataDir  répertoire du cluster (<userData>/pgdata)
 * @param {string} logFile  journal du serveur (<userData>/postgres.log)
 * @param {(msg:string)=>void} [onProgress] pour l'écran d'attente
 */
async function ensureRunning({ dataDir, logFile, onProgress = () => {} }) {
  const root = pgRoot();
  if (!root) throw new Error('Binaires PostgreSQL embarqués absents.');

  if (!isInitialized(dataDir)) {
    onProgress('Première installation de la base de données…');
    await init(root, dataDir);
  } else {
    // Un cluster créé par une autre version majeure ne s'ouvre pas : postgres
    // refuse de démarrer avec « database files are incompatible with server ».
    // Le dire ici, c'est éviter que le client lise ce message dans un journal
    // qu'il n'ouvrira jamais.
    const onDisk = clusterVersion(dataDir);
    const bundled = bundledVersion(root);
    if (onDisk && bundled && onDisk !== bundled) {
      throw new Error(
        `Vos données ont été créées par PostgreSQL ${onDisk}, or cette version de `
        + `DocuFlow embarque PostgreSQL ${bundled}.\n`
        + 'Réinstallez la version précédente de DocuFlow, ou contactez le support '
        + 'pour convertir vos données.\n'
        + `Répertoire concerné : ${dataDir}`
      );
    }
  }

  onProgress('Démarrage de la base de données…');
  const port = await start(root, dataDir, logFile);

  if (!await waitReady(root, port)) {
    throw new Error(
      'La base de données locale ne répond pas.\n'
      + `Consultez le journal : ${logFile}`
    );
  }

  console.log(`[postgres] Prêt sur 127.0.0.1:${port} (cluster ${dataDir})`);
  return { host: '127.0.0.1', port, user: SUPERUSER, password: '', database: DATABASE, dataDir };
}

module.exports = {
  isAvailable,
  isInitialized,
  clusterVersion,
  bundledVersion,
  ensureRunning,
  stopSync,
  pgRoot,
  SUPERUSER,
  DATABASE,
};
