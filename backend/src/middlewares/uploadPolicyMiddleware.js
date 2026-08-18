/**
 * uploadPolicyMiddleware — applique les réglages de téléversement par organisation.
 *
 * multer fixe ses limites à la construction du middleware, une fois pour toutes,
 * et ne peut donc pas dépendre du tenant de la requête. Résultat : la limite de
 * 10 Mo codée dans helpers/upload.js s'appliquait à tout le monde et les
 * réglages « Taille maximale par fichier » et « Types de fichiers autorisés »
 * n'avaient aucun effet.
 *
 * Ce middleware s'exécute APRÈS multer et rejette les fichiers non conformes à
 * la politique du tenant, en supprimant ce qui a été écrit sur le disque.
 * Le garde-fou multer reste en place comme protection absolue contre l'abus.
 */
const fs = require('fs');
const path = require('path');
const settingsService = require('../services/settingsService');

/** Fichiers portés par la requête, quelle que soit la forme utilisée par multer. */
function collectFiles(req) {
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === 'object') return Object.values(req.files).flat();
  if (req.file) return [req.file];
  return [];
}

function removeFiles(files) {
  for (const file of files) {
    if (!file || !file.path) continue;
    try {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch {
      // Le nettoyage est opportuniste : ne jamais masquer l'erreur de validation.
    }
  }
}

function formatMb(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} Mo`;
}

async function uploadPolicyMiddleware(req, res, next) {
  const files = collectFiles(req);
  if (!files.length) return next();

  try {
    const tenantId = req.user?.tenant_id;
    const maxBytes = await settingsService.getMaxUploadBytes(tenantId);
    const allowedRaw = await settingsService.get(tenantId, 'allowed_file_types', '');
    const allowedExtensions = String(allowedRaw || '')
      .split(',')
      .map((ext) => ext.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean);

    for (const file of files) {
      if (file.size > maxBytes) {
        removeFiles(files);
        return res.status(413).json({
          message: `« ${file.originalname} » dépasse la taille maximale autorisée (${formatMb(maxBytes)}).`,
        });
      }
      if (allowedExtensions.length) {
        const ext = path.extname(file.originalname || '').toLowerCase().replace(/^\./, '');
        if (!allowedExtensions.includes(ext)) {
          removeFiles(files);
          return res.status(415).json({
            message: `Type de fichier « ${ext || 'inconnu'} » non autorisé. Extensions acceptées : ${allowedExtensions.join(', ')}.`,
          });
        }
      }
    }
    return next();
  } catch (err) {
    // Un défaut de lecture des réglages ne doit pas bloquer un téléversement
    // légitime : les garde-fous multer (taille et MIME) restent actifs.
    console.warn('[upload] Politique de téléversement non appliquée :', err.message);
    return next();
  }
}

module.exports = uploadPolicyMiddleware;
