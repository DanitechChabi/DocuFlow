// ============================================================================
// DocuFlow — Application de bureau (Electron)
// Le processus principal démarre le backend Express in-process (qui sert le
// frontend compilé en même-origine via SERVE_FRONTEND) et ouvre une fenêtre
// sur http://127.0.0.1:<port>.
// ============================================================================
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// --- Répertoires (dev vs packagé) ---
// Dev  : __dirname = docuflow-afgc/desktop  → ROOT = docuflow-afgc
// Prod : __dirname = resources/app          → ROOT = resources/app
const ROOT = app.isPackaged ? __dirname : path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const FRONTEND_DIST = path.join(ROOT, 'frontend', 'dist');
const INDEX_HTML = path.join(FRONTEND_DIST, 'index.html');

app.setName('DocuFlow');
app.setAppUserModelId('com.docuflow.app');

let mainWindow = null;

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
  app.whenReady().then(bootstrap);
}

async function bootstrap() {
  // --- Variables d'environnement du backend (posées AVANT require() — dotenv
  // ne surcharge jamais un process.env déjà défini). ---
  process.env.NODE_ENV = process.env.NODE_ENV || 'development'; // CORS ouvert (même-origine)
  process.env.SERVE_FRONTEND = 'true';
  process.env.UPLOADS_DIR = path.join(app.getPath('userData'), 'uploads');
  process.env.HOST = '127.0.0.1';        // loopback uniquement, pas exposé sur le LAN
  process.env.PORT = '0';                // port libre attribué par l'OS
  process.env.DB_HOST = process.env.DB_HOST || 'localhost';
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.DB_USER = process.env.DB_USER || 'postgres';
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || '';
  process.env.DB_NAME = process.env.DB_NAME || 'docuflow';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'DOCUFLOW_SUPER_SECRET_KEY_2024_Daniel_Chabi';

  // Frontend compilé présent ?
  if (!fs.existsSync(INDEX_HTML)) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'DocuFlow',
      message: 'Interface introuvable.',
      detail: 'Reconstruisez le frontend (desktop/scripts/build-desktop.bat), puis relancez l’application.',
    });
    return app.quit();
  }

  // --- Base de données : création + migrations + compte superadmin ---
  try {
    const { ensureDatabase, runMigrations, seedAdmin } = require(path.join(BACKEND_DIR, 'src', 'desktop', 'bootstrap.js'));
    await ensureDatabase();
    await runMigrations();
    await seedAdmin();
  } catch (err) {
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

  // --- Backend Express (in-process) ---
  let server;
  try {
    ({ server } = require(path.join(BACKEND_DIR, 'src', 'app.js')));
  } catch (err) {
    dialog.showErrorBox('DocuFlow — Erreur de démarrage', `Impossible de démarrer le serveur :\n${err.message}`);
    return app.quit();
  }

  // Attend que le serveur écoute (listen est asynchrone) avant de lire le port.
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve));
  }
  const port = server.address().port;
  console.log(`[desktop] Backend prêt sur http://127.0.0.1:${port}`);
  createWindow(port);
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'DocuFlow',
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  // Ouvre les liens externes dans le navigateur par défaut, pas dans l'app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}
