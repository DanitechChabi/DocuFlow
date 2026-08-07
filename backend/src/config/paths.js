// ============================================================================
// Chemins des uploads — surchargeables via UPLOADS_DIR.
// - Dev / prod cloud (Render…) : défaut backend/uploads (comportement inchangé).
// - Bureau (Electron) : desktop/main.js pose UPLOADS_DIR = %APPDATA%\DocuFlow\uploads
//   (le dossier d'installation peut être en lecture seule, ex. Program Files).
// Le dossier (et son sous-dossier files/) est créé au chargement du module.
// ============================================================================
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, '../../uploads');

const FILES_DIR = path.join(UPLOADS_DIR, 'files');

fs.mkdirSync(FILES_DIR, { recursive: true });

module.exports = { UPLOADS_DIR, FILES_DIR };
