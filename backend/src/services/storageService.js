/**
 * storageService — abstraction de stockage des fichiers du GED.
 *
 * Mode Cloudinary (durable, recommandé) : actif dès que les variables
 * CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET sont définies.
 * Sinon, fallback sur le disque local (uploads/files/).
 */
const path = require('path');
const fs = require('fs').promises;  // Utiliser fs.promises pour les opérations async
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

// Dossier des uploads (surchargeable via UPLOADS_DIR — bureau Electron)
const { UPLOADS_DIR, FILES_DIR } = require('../config/paths');

/**
 * Ressource Cloudinary correspondant à un type MIME.
 * L'upload en resource_type 'auto' classe les images en 'image',
 * les vidéos en 'video' et tout le reste (PDF, docs, textes…) en 'raw'.
 */
function resourceTypeFromMime(mimeType) {
  if (!mimeType) return 'image';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'raw';
}

/**
 * Enregistre un fichier (multer file, avec file.path).
 *
 * @param {object} file   - { path, filename, originalname, mimetype, size }
 * @param {object} opts   - { folder, keepLocal }
 * @returns {Promise<{storedName, cloudinaryPublicId, url, resourceType}>}
 */
async function saveFile(file, { folder = 'documents', keepLocal = false } = {}) {
  if (USE_CLOUDINARY) {
    // resource_type explicite selon le mime : les PDF (et doc/xls/txt/zip) sont
    // stockés en 'raw' pour préserver le fichier original. 'auto' classerait les
    // PDF en 'image' (accessible uniquement via transformation, rasterisé en PNG).
    const resourceType = resourceTypeFromMime(file.mimetype);
    const result = await cloudinary.uploader.upload(file.path, { folder, resource_type: resourceType });
    // Le fichier temporaire local n'est plus nécessaire (sauf si on veut le conserver)
    if (!keepLocal) {
      try {
        await fs.unlink(file.path);
      } catch (err) {
        console.warn('[storage] Impossible de supprimer le fichier temporaire:', err.message);
      }
    }
    return {
      storedName: result.public_id,
      cloudinaryPublicId: result.public_id,
      resourceType,
      // secure_url fourni par Cloudinary : version + format exacts (fiabilité maximale)
      secureUrl: result.secure_url || null,
      url: result.secure_url || cloudinary.url(result.public_id, { secure: true, resource_type: resourceType }),
    };
  }
  // Mode local : multer a déjà écrit le fichier dans uploads/files/
  return {
    storedName: file.filename,
    cloudinaryPublicId: null,
    resourceType: null,
    secureUrl: null,
    url: null, // construit par fileUrl(req, ...)
  };
}

/**
 * Supprime un fichier (Cloudinary ou disque local).
 * resourceType : 'image' | 'video' | 'raw' (Cloudinary ne retrouve un asset
 * raw qu'avec le bon resource_type, sinon erreur).
 */
async function deleteFile({ storedName, cloudinaryPublicId, resourceType }) {
  if (USE_CLOUDINARY && cloudinaryPublicId) {
    // resourceType peut être un mime_type (image/png…) ou déjà 'image'|'video'|'raw'
    await cloudinary.uploader.destroy(cloudinaryPublicId, { resource_type: resourceTypeFromMime(resourceType) });
    return;
  }
  const p = path.join(FILES_DIR, storedName || '');
  if (storedName) {
    try {
      await fs.unlink(p);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[storage] Erreur suppression fichier:', err.message);
      }
    }
  }
}

/**
 * URL publique d'un fichier (https si Cloudinary, sinon via req).
 * @param {object} req     - requête Express (pour construire l'URL locale)
 * @param {object} fileRow - ligne document_files (stored_name, cloudinary_public_id,
 *                           mime_type, secure_url)
 * Utilise le secure_url stocké à l'upload (version + format exacts de Cloudinary) ;
 * fallback sur reconstruction pour les anciens fichiers sans secure_url.
 */
function fileUrl(req, fileRow) {
  if (USE_CLOUDINARY && fileRow.cloudinary_public_id) {
    return fileRow.secure_url || cloudinary.url(fileRow.cloudinary_public_id, { secure: true, resource_type: resourceTypeFromMime(fileRow.mime_type) });
  }
  return `${req.protocol}://${req.get('host')}/uploads/files/${fileRow.stored_name}`;
}

module.exports = { saveFile, deleteFile, fileUrl, USE_CLOUDINARY, resourceTypeFromMime };
