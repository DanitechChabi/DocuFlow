// ============================================================================
// licenseRoutes — routes PUBLIQUES d'activation des postes de bureau.
//
// Aucun authMiddleware, et c'est voulu : au moment où un poste s'active, il n'a
// pas de compte utilisateur — la base est peut-être vide, l'organisation pas
// encore créée. La clé de licence tient le rôle du secret d'authentification.
//
// Les routes d'ADMINISTRATION des licences ne sont pas ici : elles vivent dans
// superadminRoutes.js, derrière authMiddleware + roleMiddleware + platformOwner.
// Cette séparation est délibérée — un fichier de routes, un niveau de garde.
// Mélanger les deux dans un même routeur rendrait un oubli de middleware
// invisible à la lecture.
// ============================================================================
const express = require('express');
const router = express.Router();
const licenseController = require('../controllers/licenseController');

// Lie une licence à ce poste (première installation).
router.post('/activate', licenseController.activate);

// Renouvelle l'artefact signé — appelé tous les 7 jours par licenseGuard.
router.post('/refresh', licenseController.refresh);

module.exports = router;
