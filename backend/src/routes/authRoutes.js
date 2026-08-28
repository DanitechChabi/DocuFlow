const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');

// Routes d'authentification
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/google', authController.googleLogin);
router.post('/register-company', authController.registerCompany);
router.get('/company/:slug', authController.getCompanyPublic);

// Rôle effectif de l'utilisateur courant — la question « que puis-je faire ? ».
// C'est ce que l'interface consomme pour n'afficher que ce que l'API acceptera.
router.get('/me', authMiddleware, authController.me);

module.exports = router;
