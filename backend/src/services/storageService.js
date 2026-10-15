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
const { uploadUrl, originPrefix } = require('../helpers/publicUrl');
const { mintFileTicket } = require('../helpers/fileTicket');

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
    // access_mode: 'authenticated' — l'asset refuse toute URL non signée dès
    // l'upload, y compris sa propre secure_url. Sans ça, access_mode reste
    // 'public' par défaut : la route protégée ajoutée en Phase A filtrerait
    // QUI obtient l'URL, mais l'URL elle-même resterait valable pour
    // n'importe qui d'autre qui l'obtiendrait par un autre biais (cache,
    // journal, lien partagé) — voir storageService.signedCloudinaryUrl.
    const result = await cloudinary.uploader.upload(file.path, {
      folder,
      resource_type: resourceType,
      access_mode: 'authenticated',
    });
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
 * @param {object} req     - requête Express. Conservée dans la signature pour les
 *                           sept appelants existants, et parce que Cloudinary
 *                           pourrait de nouveau en avoir besoin ; les URL locales
 *                           sont désormais relatives et ne la consultent plus.
 * @param {object} fileRow - ligne document_files (stored_name, cloudinary_public_id,
 *                           mime_type, secure_url)
 * Utilise le secure_url stocké à l'upload (version + format exacts de Cloudinary) ;
 * fallback sur reconstruction pour les anciens fichiers sans secure_url.
 */
function fileUrl(req, fileRow) {
  if (fileRow.secure_url) {
    return fileRow.secure_url;
  }
  if (fileRow.cloudinary_public_id) {
    if (fileRow.cloudinary_public_id.startsWith('http://') || fileRow.cloudinary_public_id.startsWith('https://')) {
      return fileRow.cloudinary_public_id;
    }
    // Fallback URL Cloudinary générique si secure_url non renseigné
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'docuflow';
    const resType = resourceTypeFromMime(fileRow.mime_type);
    return `https://res.cloudinary.com/${cloudName}/${resType}/upload/${fileRow.cloudinary_public_id}`;
  }
  // Mode local : absolue en hébergé, relative en bureau. La règle et son
  // pourquoi sont dans helpers/publicUrl.js — en résumé, le port de
  // l'application de bureau change à chaque lancement, donc une URL absolue y
  // devient morte, tandis qu'en SaaS le frontend est sur une autre origine et
  // une URL relative n'y trouverait pas /uploads.
  return uploadUrl(req, fileRow.stored_name, 'files');
}

/**
 * URL Cloudinary SIGNÉE pour un asset en access_mode 'authenticated' — la
 * seule façon de le livrer depuis que `saveFile` (et la migration des assets
 * antérieurs, voir scripts/migrateCloudinaryAccessMode.js) leur refuse toute
 * URL non signée. `fileRow.secure_url` (stocké à l'upload) ne sert donc plus
 * jamais à la livraison réelle : seul ce calcul, fait à chaque demande après
 * vérification des droits par l'appelant, compte.
 *
 * N'appeler qu'APRÈS avoir vérifié les droits — cette fonction ne vérifie
 * rien, elle ne fait que signer. C'est aux trois routes de téléchargement
 * (document/request/message) de ne l'appeler qu'une fois l'ACL confirmée.
 *
 * LIMITE CONNUE — PAS D'EXPIRATION : la signature produite par `sign_url`
 * (cloudinary.url) est statique et reste valable tant que l'asset existe en
 * access_mode 'authenticated' ; `expires_at` n'est PAS honoré par ce chemin
 * de signature (vérifié dans le SDK : seul le mécanisme SÉPARÉ de jeton
 * Akamai, `auth_token`, lit `expires_at` — et il exige une clé générée dans
 * le tableau de bord Cloudinary, Settings → Security → Token-based
 * authentication, absente de la configuration actuelle). Ce que cette
 * fonction ferme quand même : l'énumération/découverte de l'asset par son
 * URL publique permanente, et l'obtention de l'URL sans passer par notre
 * contrôle d'accès — seule une requête qui a déjà réussi le ticket + l'ACL
 * obtient une URL signée valide. Ce qu'elle NE ferme PAS : une fuite de
 * l'URL signée elle-même reste exploitable indéfiniment, comme aujourd'hui
 * avec secure_url. Pour une vraie expiration, configurer `auth_token` côté
 * Cloudinary puis l'ajouter ici — étape volontairement laissée de côté : une
 * action de configuration externe, pas un changement de code.
 *
 * @param {object} fileRow - doit porter cloudinary_public_id et mime_type.
 * @returns {string|null}
 */
function signedCloudinaryUrl(fileRow) {
  if (!fileRow?.cloudinary_public_id) return null;
  const resourceType = resourceTypeFromMime(fileRow.mime_type);
  return cloudinary.url(fileRow.cloudinary_public_id, {
    type: 'upload',
    resource_type: resourceType,
    secure: true,
    sign_url: true,
  });
}

// Chemin de la route protégée de téléchargement, par domaine. Tenu à jour en
// même temps que documentRoutes.js / uploadRoutes.js — un seul endroit pour
// la correspondance kind → route.
const DOWNLOAD_PATH_BY_KIND = {
  document: (ownerId, fileId) => `/api/documents/${ownerId}/files/${fileId}/download`,
  request: (ownerId, fileId) => `/api/upload/request/${ownerId}/files/${fileId}/download`,
  message: (ownerId, fileId) => `/api/upload/message/${ownerId}/files/${fileId}/download`,
};

/**
 * URL de téléchargement PROTÉGÉE d'un fichier — à utiliser PARTOUT où un
 * fichier du GED, d'une demande ou d'une conversation est exposé au
 * frontend. Remplace `fileUrl`, qui reste réservé à l'usage interne des
 * routes de téléchargement elles-mêmes (construire l'URL Cloudinary réelle
 * vers laquelle rediriger une fois les droits vérifiés).
 *
 * @param {object} req - requête Express (utilisateur authentifié requis :
 *   le ticket est scellé sur req.user.id/tenant_id).
 * @param {object} opts
 * @param {'document'|'request'|'message'} opts.kind
 * @param {number|string} opts.ownerId - id du document/de la demande/du message.
 * @param {object} opts.fileRow - doit porter un `id` (clé de la ligne
 *   document_files / request_files / message_attachments).
 * @returns {string|null}
 */
function secureFileUrl(req, { kind, ownerId, fileRow }) {
  if (!fileRow || fileRow.id == null || ownerId == null) return null;
  const uid = req.user?.id;
  const tenantId = req.user?.tenant_id;
  if (!uid || !tenantId) return null;
  const buildPath = DOWNLOAD_PATH_BY_KIND[kind];
  if (!buildPath) return null;

  const ticket = mintFileTicket({ uid, tenantId, kind, fileId: fileRow.id });
  return `${originPrefix(req)}${buildPath(ownerId, fileRow.id)}?t=${encodeURIComponent(ticket)}`;
}

module.exports = { saveFile, deleteFile, fileUrl, secureFileUrl, signedCloudinaryUrl, USE_CLOUDINARY, resourceTypeFromMime };
