const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const authMiddleware = require('../middlewares/authMiddleware');
const { uploadMultiple, uploadSingle } = require('../helpers/upload');

// Téléchargement — AVANT authMiddleware, volontairement : un <img src> ou
// <a href> ne porte pas d'en-tête Authorization, donc ces routes ne peuvent
// pas dépendre d'une session active. L'autorisation tient au ticket signé
// (voir storageService.secureFileUrl / helpers/fileTicket.js), revérifié en
// direct par le contrôleur (même contrôle d'accès que les routes de listing).
router.get('/request/:requestId/files/:fileId/download', uploadController.downloadRequestFile);
router.get('/message/:messageId/files/:fileId/download', uploadController.downloadMessageFile);

router.use(authMiddleware);

// Fichiers des demandes
router.post('/request/:requestId', uploadMultiple, uploadController.uploadRequestFiles);
router.get('/request/:requestId', uploadController.getRequestFiles);
router.delete('/request/file/:fileId', uploadController.deleteRequestFile);

// Fichiers des messages (upload avant envoi)
router.post('/message', uploadSingle, uploadController.uploadMessageFile);
router.post('/message/:messageId/link', uploadController.linkMessageFiles);
router.get('/message/:messageId', uploadController.getMessageFiles);

module.exports = router;
