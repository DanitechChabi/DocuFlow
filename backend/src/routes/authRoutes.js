const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const { limiteur } = require('../middlewares/limiteur');

// Inscriptions : large (un bureau entier peut s'inscrire derrière une même
// adresse IP), mais de quoi freiner un robot.
const inscriptions = limiteur({ max: 100, fenetreMs: 15 * 60 * 1000, message: 'Trop d\'inscriptions depuis cette connexion : réessayez dans quelques minutes.' });

// Routes d'authentification
router.post('/register', inscriptions, authController.register);
router.post('/login', authController.login);
router.post('/google', authController.googleLogin);
router.post('/register-company', authController.registerCompany);
router.get('/company/:slug', authController.getCompanyPublic);
// Départements d'un espace, pour la page d'inscription.
router.get('/company/:slug/departements', authController.departementsPublics);

// Rôle effectif de l'utilisateur courant — la question « que puis-je faire ? ».
// C'est ce que l'interface consomme pour n'afficher que ce que l'API acceptera.
router.get('/me', authMiddleware, authController.me);
router.patch('/me/onboarding', authMiddleware, authController.updateOnboarding);

module.exports = router;
