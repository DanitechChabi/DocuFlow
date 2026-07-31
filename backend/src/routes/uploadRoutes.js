const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const authMiddleware = require('../middlewares/authMiddleware');
const { uploadMultiple, uploadSingle } = require('../helpers/upload');

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
