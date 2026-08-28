// ============================================================================
// DocuFlow — Application de bureau (Electron)
// Le processus principal démarre le backend Express in-process (qui sert le
// frontend compilé en même-origine via SERVE_FRONTEND) et ouvre une fenêtre
// sur http://127.0.0.1:<port>.
// ============================================================================
const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// --- Répertoires (dev vs packagé) ---
// Dev  : __dirname = docuflow-afgc/desktop  → ROOT = docuflow-afgc
// Prod : __dirname = resources/app          → ROOT = resources/app
const ROOT = app.isPackaged ? __dirname : path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const FRONTEND_DIST = path.join(ROOT, 'frontend', 'dist');
const INDEX_HTML = path.join(FRONTEND_DIST, 'index.html');
const SPLASH_HTML = path.join(__dirname, 'splash.html');

app.setName('DocuFlow');
app.setAppUserModelId('com.docuflow.app');

let mainWindow = null;
let splashWindow = null;
// Module de la base embarquée, chargé seulement si ses binaires sont là.
let embeddedPg = null;
// Module de licence, chargé au démarrage (voir bootstrap).
let licenseGuard = null;

// Une seule instance : évite les conflits de port / de base de données.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());

  // Arrêt de la base embarquée à la fermeture. SYNCHRONE et pas dans un
  // gestionnaire asynchrone : Electron n'attend pas les promesses en fin de vie
  // du processus. Un postgres.exe survivant garderait le verrou de pgdata et le
  // lancement suivant échouerait — devant un client qui n'a aucun moyen de
  // comprendre pourquoi son logiciel ne s'ouvre plus.
  app.on('will-quit', () => {
    if (embeddedPg) embeddedPg.stopSync();
  });

  // Filet de sécurité : une exception non rattrapée dans le processus principal
  // tuerait l'app en laissant le serveur de base de données derrière elle.
  process.on('exit', () => {
    if (embeddedPg) embeddedPg.stopSync();
  });

  app.whenReady().then(bootstrap);
}

// ----------------------------------------------------------------------------
// Canaux IPC exposés par preload.js
//
// Enregistrés au chargement du module, avant l'ouverture de la fenêtre : un
// canal sans gestionnaire fait rejeter `ipcRenderer.invoke` avec « No handler
// registered », et le bouton correspondant resterait inerte sans rien afficher.
// ----------------------------------------------------------------------------

/**
 * Ouvre une URL dans le navigateur par défaut (lien d'achat de l'écran de
 * licence). Le filtrage du schéma est ici, et pas dans preload.js : ce dernier
 * s'exécute dans la fenêtre et ne peut donc pas servir de garde-fou.
 *
 * `http(s)` uniquement, pour ne pas transformer ce canal en exécuteur de
 * commandes : shell.openExternal ouvrirait aussi bien un `file:` qu'un chemin
 * de programme, et la page rendue est certes la nôtre, mais elle affiche des
 * données venues de la base.
 */
ipcMain.handle('desktop:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    console.warn(`[desktop] Ouverture externe refusée : ${url}`);
    return false;
  }
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('desktop:version', () => app.getVersion());

ipcMain.handle('desktop:set-title', async (_event, title) => {
  if (mainWindow) {
    mainWindow.setTitle(title);
  }
  return true;
});

// ----------------------------------------------------------------------------
// Écran d'attente
//
// Nécessaire parce que la création du cluster au premier lancement prend
// plusieurs dizaines de secondes : sans fenêtre, l'utilisateur double-clique et
// il ne se passe rien de visible. Il conclut que le logiciel est cassé et
// relance — d'où le verrou d'instance unique plus haut.
// ----------------------------------------------------------------------------
function openSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#0f172a',
    title: 'DocuFlow',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWindow.loadFile(SPLASH_HTML);
  splashWindow.once('ready-to-show', () => splashWindow?.show());
  splashWindow.on('closed', () => { splashWindow = null; });
}

function splashStatus(message) {
  console.log(`[desktop] ${message}`);
  if (!splashWindow || splashWindow.isDestroyed()) return;
  // JSON.stringify : le message finit dans du code évalué. Il vient de notre
  // propre code, mais peut contenir un chemin Windows — donc des antislashs.
  splashWindow.webContents
    .executeJavaScript(`window.majEtat && window.majEtat(${JSON.stringify(message)})`)
    .catch(() => {});
}

function closeSplash() {
  const fenetre = splashWindow;
  // On détache la référence TOUT DE SUITE : un second appel (le démarrage passe
  // par plusieurs chemins de sortie) ne doit pas relancer un fondu sur une
  // fenêtre déjà en cours de fermeture.
  splashWindow = null;
  if (!fenetre || fenetre.isDestroyed()) return;

  // …mais la fermeture s'opère sur la référence LOCALE. L'ancienne version
  // testait `splashWindow` dans le setTimeout, après l'avoir mis à null juste
  // au-dessus : la condition était donc toujours fausse et l'écran d'attente
  // restait affiché par-dessus l'application, pour toute la session.
  const fermer = () => {
    if (!fenetre.isDestroyed()) fenetre.close();
  };

  // Filet de sécurité : si le fondu ne rend jamais la main (page bloquée, rendu
  // non prêt), on ferme quand même. Sans lui, une promesse en attente suffirait
  // à laisser la fenêtre à l'écran.
  const secours = setTimeout(fermer, 2000);

  fenetre.webContents
    .executeJavaScript('window.fadeOut && window.fadeOut()')
    .then(() => {
      setTimeout(() => { clearTimeout(secours); fermer(); }, 600); // durée de la transition CSS
    })
    .catch(() => { clearTimeout(secours); fermer(); });
}

/**
 * L'interface compilée contacte-t-elle une API distante ?
 *
 * @returns {string|null} l'origine fautive, ou null si le build est bien local.
 *
 * On cherche une URL absolue se terminant par « /api » dans les fichiers
 * JavaScript compilés — la forme que prend VITE_API_URL après compilation. Le
 * critère est volontairement étroit : le frontend contient légitimement des
 * adresses externes (polices, page d'achat de licence, comptes de réseaux
 * sociaux). Les refuser toutes empêcherait l'application de démarrer pour un
 * lien de pied de page, et une vérification qui crie au loup finit désactivée.
 *
 * Le fichier lu est celui du point d'entrée, pas tous les morceaux : c'est là
 * que Vite place la configuration du service d'API.
 */
function detecterBuildDistant() {
  try {
    const assets = path.join(FRONTEND_DIST, 'assets');
    if (!fs.existsSync(assets)) return null;

    for (const nom of fs.readdirSync(assets).filter((f) => f.endsWith('.js'))) {
      const contenu = fs.readFileSync(path.join(assets, nom), 'utf8');
      // Adresse absolue terminée par /api : signature d'un VITE_API_URL de
      // déploiement. Le loopback est exclu — c'est le repli de développement,
      // inoffensif ici puisque le backend écoute justement en local.
      const trouve = contenu.match(/https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+(?::\d+)?\/api\b/i);
      if (trouve) return trouve[0];
    }
    return null;
  } catch (err) {
    // Un défaut de lecture ne doit pas empêcher l'application de démarrer : ce
    // contrôle protège contre une erreur d'empaquetage, il n'est pas un verrou
    // de sécurité. Mieux vaut démarrer que bloquer le client sur une lecture de
    // fichier ratée.
    console.warn('[desktop] Vérification du build impossible :', err.message);
    return null;
  }
}

/**
 * Système de mise à jour automatique (electron-updater / GitHub).
 *
 * DÉSACTIVÉ EN ATTENTE DU DÉPÔT DE DISTRIBUTION : la configuration `publish`
 * vise `DanitechChabi/docuflow-desktop`, qui n'existe pas encore — chaque
 * démarrage produisait une erreur 404 dans les journaux, sans jamais proposer
 * aucune mise à jour. Pour réactiver : créer le dépôt (public, avec des
 * releases auxquelles electron-builder publie les installeurs), puis
 * réintroduire l'appel ci-dessous.
 */
function setupAutoUpdater() {
  if (!app.isPackaged) return; // Pas de mise à jour en mode développement
  console.log('[desktop] Mise à jour automatique inactive — dépôt de distribution non créé.');
  // autoUpdater.checkForUpdatesAndNotify();
}

/**
 * Secret de signature des jetons : UN PAR INSTALLATION, généré au premier
 * lancement et conservé dans le profil utilisateur.
 *
 * L'ancien repli était une constante en clair dans un dépôt PUBLIC : quiconque
 * a lu le dépôt pouvait forger un jeton `{role:'superadmin', tenant_id:1}`
 * valable sur TOUTES les installations bureau (le serveur local écoute en
 * loopback, mais tout processus de la session Windows de l'utilisateur peut
 * le joindre). Le secret est désormais aléatoire — la lecture du dépôt ne
 * suffit plus. Il vit hors de `pgdata` et des uploads : la sauvegarde des
 * documents n'a pas à le contenir, et sa perte ne détruit aucune donnée (elle
 * déconnecte seulement les sessions en cours).
 *
 * Un éventuel `JWT_SECRET` posé manuellement dans l'environnement garde la
 * priorité (cas d'un test ou d'une restauration).
 */
function chargerOuCreerSecret() {
  const crypto = require('crypto');
  const fichier = path.join(app.getPath('userData'), 'jwt-secret.key');
  try {
    if (fs.existsSync(fichier)) {
      const existant = fs.readFileSync(fichier, 'utf8').trim();
      if (existant.length >= 32) return existant;
    }
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(fichier, secret, { mode: 0o600 });
    console.log('[desktop] Secret de signature des jetons généré pour cette installation.');
    return secret;
  } catch (err) {
    // Impossible de persister (disque plein, permissions) : un secret
    // éphémère vaut mieux que la constante publique — les sessions dureront
    // simplement moins longtemps.
    console.warn('[desktop] Secret de jetons non persistable, secret éphémère :', err.message);
    return crypto.randomBytes(48).toString('hex');
  }
}

async function bootstrap() {
  // --- Variables d'environnement du backend (posées AVANT require() — dotenv
  // ne surcharge jamais un process.env déjà défini). ---
  //
  // PRODUCTION dès que l'application est packagée. L'ancien défaut
  // « development » laissait le CORS de app.js en `origin: true` : TOUTE page
  // web visitée par le client pouvait interroger l'API locale (et lire /uploads,
  // servi sans authentification) dès lors qu'elle trouvait le port — le
  // commentaire d'alors (« CORS ouvert, même-origine ») était faux : `origin:
  // true` reflète n'importe quelle origine, pas seulement la nôtre. En mode
  // bureau le frontend est servi PAR CE SERVEUR (même origine), donc le CORS
  // restreint de production ne gêne aucune requête légitime.
  process.env.NODE_ENV = process.env.NODE_ENV || (app.isPackaged ? 'production' : 'development');
  process.env.SERVE_FRONTEND = 'true';
  process.env.UPLOADS_DIR = path.join(app.getPath('userData'), 'uploads');
  process.env.HOST = '127.0.0.1';        // loopback uniquement, pas exposé sur le LAN
  process.env.PORT = '0';                // port libre attribué par l'OS
  process.env.JWT_SECRET = process.env.JWT_SECRET || chargerOuCreerSecret();

  // --- Frontend compilé : présent, ET compilé pour le bureau ---
  //
  // Vérifier la seule existence d'index.html ne suffit pas, et c'est un piège
  // coûteux : `frontend/dist` sert AUSSI aux déploiements Vercel, où
  // VITE_API_URL vaut l'adresse de Render. Un tel build s'installe sans erreur,
  // affiche l'interface… et envoie tous les documents du client vers le SaaS —
  // l'inverse exact de ce qu'on vend (« vos données restent chez vous »).
  //
  // Le build de bureau, lui, pose VITE_API_URL=/api (cf. frontend/.env.desktop) :
  // aucune URL absolue d'API ne subsiste dans les fichiers compilés. La présence
  // d'une adresse http(s) pointant vers /api est donc la signature d'un build
  // destiné au nuage, et on refuse de démarrer plutôt que de laisser fuir les
  // données en silence.
  if (!fs.existsSync(INDEX_HTML)) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'DocuFlow',
      message: 'Interface introuvable.',
      detail: 'Reconstruisez le frontend (desktop/scripts/build-desktop.bat), puis relancez l’application.',
    });
    return app.quit();
  }

  const buildDistant = detecterBuildDistant();
  if (buildDistant) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'DocuFlow',
      message: 'Interface compilée pour le mode hébergé.',
      detail:
        `L'interface installée contacte un serveur distant (${buildDistant}) au lieu de la base locale. `
        + 'Vos documents ne resteraient pas sur cet ordinateur.\n\n'
        + 'Recompilez avec « npm run build:frontend » depuis le dossier desktop, puis relancez.',
    });
    return app.quit();
  }

  if (!splashWindow) openSplash();

  // --- PostgreSQL embarqué ---
  //
  // Priorité assumée : si l'utilisateur a explicitement fourni un DB_HOST, on le
  // respecte (poste déjà configuré, base sur un serveur de l'entreprise). Sinon,
  // et si les binaires embarqués sont là, on démarre notre propre instance. Le
  // repli sur un PostgreSQL installé sur la machine reste en dernier recours :
  // c'est le comportement des installations existantes, et une mise à jour de
  // DocuFlow ne doit pas leur retirer leurs données.
  const userDataDir = app.getPath('userData');
  let usingEmbedded = false;

  if (!process.env.DB_HOST) {
    try {
      const pg = require(path.join(BACKEND_DIR, 'src', 'desktop', 'postgres.js'));
      if (pg.isAvailable()) {
        const conn = await pg.ensureRunning({
          dataDir: path.join(userDataDir, 'pgdata'),
          logFile: path.join(userDataDir, 'postgres.log'),
          onProgress: splashStatus,
        });
        // Posé AVANT le require de bootstrap.js : celui-ci lit process.env au
        // chargement du module (bootstrap.js:18-24), pas à chaque appel.
        process.env.DB_HOST = conn.host;
        process.env.DB_PORT = String(conn.port);
        process.env.DB_USER = conn.user;
        process.env.DB_PASSWORD = conn.password;
        process.env.DB_NAME = conn.database;
        embeddedPg = pg;          // pour l'arrêt dans will-quit
        usingEmbedded = true;
      } else {
        console.log('[desktop] Binaires PostgreSQL embarqués absents — repli sur une installation locale.');
      }
    } catch (err) {
      // Échec du démarrage embarqué : ce n'est pas rattrapable en réessayant à
      // l'identique (cluster d'une autre version majeure, disque plein, port
      // bloqué). On le dit explicitement au lieu de laisser le repli produire un
      // « PostgreSQL introuvable » qui désignerait la mauvaise cause.
      closeSplash();
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'DocuFlow — Base de données',
        message: 'La base de données locale n\'a pas pu démarrer.',
        detail: `${err.message}\n\nSi le problème persiste, contactez le support.`,
        buttons: ['Quitter'],
      });
      return app.quit();
    }
  }

  // Valeurs de repli pour un PostgreSQL déjà installé sur le poste.
  process.env.DB_HOST = process.env.DB_HOST || 'localhost';
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.DB_USER = process.env.DB_USER || 'postgres';
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || '';
  process.env.DB_NAME = process.env.DB_NAME || 'docuflow';

  // --- Base de données : création + migrations ---
  //
  // Ces deux étapes SONT bloquantes : sans schéma à jour, l'application n'a rien
  // à afficher et toute requête échouerait. Le compte par défaut, lui, est traité
  // séparément plus bas — voir la raison là-bas.
  let seedAdmin;
  try {
    splashStatus('Préparation des données…');
    const bootstrapDb = require(path.join(BACKEND_DIR, 'src', 'desktop', 'bootstrap.js'));
    seedAdmin = bootstrapDb.seedAdmin;
    await bootstrapDb.ensureDatabase();
    splashStatus('Mise à jour du schéma…');
    await bootstrapDb.runMigrations();
  } catch (err) {
    // Avec l'instance embarquée, « démarrez PostgreSQL » n'a aucun sens : le
    // serveur tourne, c'est autre chose qui a échoué (migration, disque). Deux
    // messages distincts, parce qu'un message qui désigne la mauvaise cause fait
    // perdre plus de temps que pas de message du tout.
    closeSplash();
    if (usingEmbedded) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'DocuFlow — Base de données',
        message: 'La préparation des données a échoué.',
        detail: `${err.message}\n\nJournal : ${path.join(userDataDir, 'postgres.log')}`,
        buttons: ['Quitter'],
      });
      return app.quit();
    }
    const retry = dialog.showMessageBoxSync({
      type: 'error',
      title: 'DocuFlow — PostgreSQL introuvable',
      message: 'Impossible de se connecter à la base PostgreSQL.',
      detail: `Démarrez PostgreSQL (localhost:${process.env.DB_PORT}) puis cliquez sur « Réessayer ».\n\n${err.message}`,
      buttons: ['Réessayer', 'Quitter'],
      defaultId: 0,
      cancelId: 1,
    });
    if (retry === 0) return bootstrap();
    return app.quit();
  }

  // --- Compte administrateur par défaut ---
  //
  // DÉLIBÉRÉMENT HORS DU BLOC BLOQUANT CI-DESSUS. C'est la correction d'une
  // panne totale : une collision d'identifiant dans ce seed remontait dans le
  // try des migrations, affichait « La préparation des données a échoué » et
  // fermait l'application — alors que la base était saine, migrée, et contenait
  // déjà le compte en question.
  //
  // La cause est structurelle et non un cas particulier : ce seed est une
  // COMMODITÉ de premier lancement, sur une base qui vit ensuite sa propre vie
  // (comptes renommés, rôles changés, mot de passe modifié). Il ne peut donc pas
  // partager le sort des migrations, dont l'échec empêche réellement de
  // travailler. Le journal suffit ici : si aucun compte n'existe, le client le
  // constate à l'écran de connexion, ce qui est un problème incomparablement
  // moins grave qu'un logiciel qui refuse de s'ouvrir.
  try {
    await seedAdmin();
  } catch (err) {
    console.error('[desktop] Compte administrateur par défaut non créé :', err.message);
  }

  // --- Licence ---
  //
  // Évaluée AVANT d'ouvrir la fenêtre, mais elle ne BLOQUE PAS le démarrage :
  // l'app s'ouvre toujours, et c'est le frontend qui affiche l'écran de licence
  // si nécessaire. Deux raisons de procéder ainsi plutôt que par une modale :
  // le client doit pouvoir lire son empreinte machine et saisir sa clé, ce qui
  // demande une vraie interface ; et une modale Electron avant toute fenêtre
  // laisserait un logiciel sans aucune issue visible.
  //
  // La garde qui compte est côté serveur (licenseMiddleware, 402 sur /api) :
  // c'est elle qui empêche d'accéder aux données, pas l'écran.
  try {
    splashStatus('Vérification de la licence…');
    licenseGuard = require(path.join(BACKEND_DIR, 'src', 'desktop', 'licenseGuard.js'));
    licenseGuard.configure({ userDataDir });
    const state = await licenseGuard.check();
    console.log(`[desktop] Licence : ${state.state}${state.days_remaining != null ? ` (${state.days_remaining} j)` : ''}`);
  } catch (err) {
    // Un défaut du dispositif de licence ne doit pas empêcher le logiciel de
    // s'ouvrir : le client a payé. licenseMiddleware est fail-open pour la même
    // raison, et la trace suffit au support.
    console.error('[desktop] Vérification de licence impossible :', err.message);
  }

  // --- Backend Express (in-process) ---
  splashStatus('Démarrage de DocuFlow…');
  let server;
  try {
    ({ server } = require(path.join(BACKEND_DIR, 'src', 'app.js')));
  } catch (err) {
    closeSplash();
    dialog.showErrorBox('DocuFlow — Erreur de démarrage', `Impossible de démarrer le serveur :\n${err.message}`);
    return app.quit();
  }

  // Attend que le serveur écoute (listen est asynchrone) avant de lire le port.
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve));
  }
  const port = server.address().port;
  console.log(`[desktop] Backend prêt sur http://127.0.0.1:${port}`);
  setupAutoUpdater();
  createWindow(port);
}

function loadWindowState() {
  try {
    const statePath = path.join(app.getPath('userData'), 'window-state.json');
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch (e) {
    console.error('[desktop] Erreur chargement état fenêtre :', e);
  }
  return { width: 1400, height: 900 };
}

function saveWindowState(window) {
  try {
    const state = {
      width: window.getBounds().width,
      height: window.getBounds().height,
      x: window.getBounds().x,
      y: window.getBounds().y,
    };
    const statePath = path.join(app.getPath('userData'), 'window-state.json');
    fs.writeFileSync(statePath, JSON.stringify(state));
  } catch (e) {
    console.error('[desktop] Erreur sauvegarde état fenêtre :', e);
  }
}

function createCustomMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Quitter',
          accelerator: 'CmdOrCtrl+Q',
          click: () => { app.quit(); }
        }
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos',
          click: () => {
            if (mainWindow) {
              dialog.showMessageBox({
                type: 'info',
                title: 'À propos de DocuFlow',
                message: 'DocuFlow — Plateforme de gestion documentaire',
                detail: `Version ${app.getVersion()}\nDéveloppé par CHABI BOUKO Daniel\n\nUne solution sécurisée pour la gestion de vos documents en local.`
              });
            }
          }
        },
        {
          label: 'Licence',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'Licence DocuFlow',
              message: 'Informations sur la licence',
              detail: 'Veuillez consulter les conditions générales d\'utilisation pour plus de détails.'
            });
          }
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow(port) {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 700,
    title: 'DocuFlow',
    backgroundColor: '#f8fafc',
    // Masquée jusqu'à ce que l'interface soit peinte : l'écran d'attente reste
    // visible jusque-là. Sans cela, on verrait une fenêtre blanche vide le temps
    // du chargement du frontend, juste après un écran soigné.
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.on('resize', () => saveWindowState(mainWindow));
  mainWindow.on('move', () => saveWindowState(mainWindow));

  createCustomMenu();

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    closeSplash();
  });

  // Si le rendu échoue, la fenêtre ne serait jamais montrée et l'app resterait
  // invisible : mieux vaut une fenêtre affichant l'erreur qu'aucune fenêtre.
  mainWindow.webContents.on('did-fail-load', (_e, code, description) => {
    console.error(`[desktop] Chargement de l'interface échoué (${code}) : ${description}`);
    closeSplash();
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  });

  // Ouvre les liens externes dans le navigateur par défaut, pas dans l'app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}
