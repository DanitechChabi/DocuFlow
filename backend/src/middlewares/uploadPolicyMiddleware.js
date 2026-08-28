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

    const rejectedFiles = [];
    const validFiles = [];

    for (const file of files) {
      let code = null;
      let reason = '';

      if (file.size > maxBytes) {
        code = 413;
        reason = `dépasse la taille maximale autorisée (${formatMb(maxBytes)})`;
      } else if (allowedExtensions.length) {
        const ext = path.extname(file.originalname || '').toLowerCase().replace(/^\./, '');
        if (!allowedExtensions.includes(ext)) {
          code = 415;
          reason = `type de fichier « ${ext || 'inconnu'} » non autorisé. Extensions acceptées : ${allowedExtensions.join(', ')}`;
        }
      }

      if (code) {
        removeFiles([file]);
        rejectedFiles.push({ originalname: file.originalname, reason, code });
      } else {
        validFiles.push(file);
      }
    }

    req.rejectedFiles = rejectedFiles;

    if (validFiles.length === 0 && rejectedFiles.length > 0) {
      // Un seul fichier refusé : on rend le code et le motif précis. Un 400
      // « aucun fichier conforme » pour un avatar trop lourd n'apprend rien à
      // l'utilisateur — il ne sait ni que c'est le poids, ni quelle est la limite.
      if (rejectedFiles.length === 1) {
        const seul = rejectedFiles[0];
        return res.status(seul.code).json({
          message: `Le fichier « ${seul.originalname || 'sans nom'} » ${seul.reason}.`,
          rejected: rejectedFiles,
        });
      }
      return res.status(400).json({
        message: 'Aucun fichier n\'est conforme à la politique de votre organisation.',
        rejected: rejectedFiles,
      });
    }

    // Réécriture dans la MÊME forme que celle produite par multer, sinon les
    // fichiers refusés — déjà effacés du disque — resteraient référencés dans la
    // requête et le contrôleur tenterait de les enregistrer en base.
    if (Array.isArray(req.files)) {
      req.files = validFiles;
    } else if (req.files && typeof req.files === 'object') {
      // Forme .fields() : { champ: [fichiers] }. On reconstruit champ par champ
      // en ne gardant que les fichiers validés (comparaison par référence).
      const conserves = new Set(validFiles);
      const reconstruit = {};
      for (const [champ, liste] of Object.entries(req.files)) {
        const gardes = (Array.isArray(liste) ? liste : [liste]).filter((f) => conserves.has(f));
        if (gardes.length) reconstruit[champ] = gardes;
      }
      req.files = reconstruit;
    }
    if (req.file) {
      // undefined, jamais false : les contrôleurs testent `req.file.path` après un
      // `if (req.file)`, et `false` passe ce test dans l'autre sens — le champ
      // deviendrait un objet falsy attendu comme absent. undefined est la valeur
      // que multer utilise lui-même quand aucun fichier n'est envoyé.
      req.file = validFiles.includes(req.file) ? req.file : undefined;
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
