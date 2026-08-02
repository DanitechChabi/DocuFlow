/**
 * Helper multer pour l'upload de fichiers (demandes et messagerie)
 * Ce module est conservé pour compatibilité mais le stockage est maintenant
 * géré par storageService (Cloudinary ou local).
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const FILES_DIR = path.join(UPLOADS_DIR, 'files');

// Créer les dossiers s'ils n'existent pas
[UPLOADS_DIR, FILES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Types MIME autorisés
const ALLOWED_MIMES = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, FILES_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = crypto.randomBytes(4).toString('hex');
    cb(null, `file_${Date.now()}_${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo max
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier non supporté : ${file.mimetype}`));
    }
  }
});

/**
 * Middleware pour upload de plusieurs fichiers (max 5)
 */
const uploadMultiple = upload.array('files', 5);

/**
 * Middleware pour upload d'un seul fichier
 */
const uploadSingle = upload.single('file');

module.exports = { upload, uploadMultiple, uploadSingle, ALLOWED_MIMES };
