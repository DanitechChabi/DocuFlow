/**
 * storageService — abstraction de stockage des fichiers du GED.
 *
 * Mode Cloudinary (durable, recommandé) : actif dès que les variables
 * CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET sont définies.
 * Sinon, fallback sur le disque local (uploads/files/).
 */
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

const USE_CLOUDINARY = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (USE_CLOUDINARY) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('[storage] Stockage Cloudinary activé');
} else {
  console.warn('[storage] Cloudinary non configuré → stockage sur disque local (éphémère sur Render free)');
}

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const FILES_DIR = path.join(UPLOADS_DIR, 'files');
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

/**
 * Enregistre un fichier (multer file, avec file.path).
 *
 * @param {object} file   - { path, filename, originalname, mimetype, size }
 * @param {object} opts   - { folder, keepLocal }
 * @returns {Promise<{storedName, cloudinaryPublicId, url}>}
 */
async function saveFile(file, { folder = 'documents', keepLocal = false } = {}) {
  if (USE_CLOUDINARY) {
    const result = await cloudinary.uploader.upload(file.path, { folder });
    // Le fichier temporaire local n'est plus nécessaire (sauf si on veut le conserver)
    if (!keepLocal) {
      fs.unlink(file.path, () => {});
    }
    return {
      storedName: result.public_id,
      cloudinaryPublicId: result.public_id,
      url: cloudinary.url(result.public_id, { secure: true }),
    };
  }
  // Mode local : multer a déjà écrit le fichier dans uploads/files/
  return {
    storedName: file.filename,
    cloudinaryPublicId: null,
    url: null, // construit par fileUrl(req, ...)
  };
}

/**
 * Supprime un fichier (Cloudinary ou disque local).
 */
async function deleteFile({ storedName, cloudinaryPublicId }) {
  if (USE_CLOUDINARY && cloudinaryPublicId) {
    await cloudinary.uploader.destroy(cloudinaryPublicId);
    return;
  }
  const p = path.join(FILES_DIR, storedName || '');
  if (storedName && fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}

/**
 * URL publique d'un fichier (https si Cloudinary, sinon via req).
 */
function fileUrl(req, storedName, cloudinaryPublicId) {
  if (USE_CLOUDINARY && cloudinaryPublicId) {
    return cloudinary.url(cloudinaryPublicId, { secure: true });
  }
  return `${req.protocol}://${req.get('host')}/uploads/files/${storedName}`;
}

module.exports = { saveFile, deleteFile, fileUrl, USE_CLOUDINARY };
