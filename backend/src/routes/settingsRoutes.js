const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const settingsController = require('../controllers/settingsController');
const authMiddleware = require('../middlewares/authMiddleware');
const optionalAuthMiddleware = require('../middlewares/optionalAuthMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');

// Config multer — dossier des uploads (surchargeable via UPLOADS_DIR)
const { UPLOADS_DIR: uploadDir } = require('../config/paths');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Format de fichier non supporté'));
    }
  }
});

// GET / — route publique : branding (nom, description, logo) utilisé par la
// page de connexion avant authentification. L'écriture reste réservée au superadmin.
// Le token optionnel permet à un utilisateur connecté de voir le branding
// de SON entreprise au lieu du tenant 1 par défaut.
router.get('/', optionalAuthMiddleware, settingsController.getSettings);

// Routes protégées (superadmin)
// GET /configuration — catalogue typé + valeurs, source de la console de configuration
router.get('/configuration', authMiddleware, roleMiddleware(['superadmin']), settingsController.getConfiguration);
router.put('/', authMiddleware, roleMiddleware(['superadmin']), settingsController.updateSettings);
router.post('/reset', authMiddleware, roleMiddleware(['superadmin']), settingsController.resetSettings);
// POST /provision — recrée les objets par défaut manquants (idempotent)
router.post('/provision', authMiddleware, roleMiddleware(['superadmin']), settingsController.provisionDefaults);
router.post('/logo', authMiddleware, roleMiddleware(['superadmin']), upload.single('logo'), settingsController.uploadLogo);

module.exports = router;
