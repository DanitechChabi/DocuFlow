// ============================================================================
// Routes de la collaboration documentaire (migration 033), montées sous /api :
//   /api/collaboration/favoris | suivis            listes personnelles
//   /api/documents/:id/collaboration               état de la fiche
//   /api/documents/:id/favori        PUT | DELETE  étoile
//   /api/documents/:id/suivi         PUT | DELETE  abonnement
//   /api/documents/:id/commentaires  …             fil, mentions
//   /api/documents/:id/partages      …             liens publics (documents.share)
//   /api/documents/:id/files/:fileId/restaurer     restauration (manage_versions)
//
// ATTENTION : l'authentification est posée ROUTE PAR ROUTE, jamais par un
// router.use('/documents', …) — /api/documents/:id/files/:fileId/download est
// public (ticket signé, voir documentRoutes) et ne doit pas l'exiger.
// Les routes publiques des liens sont dans partageRoutes.js.
// ============================================================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/collaborationController');
const auth = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

const lire = [auth, requirePermission('documents.view')];
const partager = [auth, requirePermission('documents.share')];
const versions = [auth, requirePermission('documents.manage_versions')];

router.get('/collaboration/favoris', lire, ctrl.favoris);
router.get('/collaboration/suivis', lire, ctrl.suivis);

router.get('/documents/:id/collaboration', lire, ctrl.etat);
router.put('/documents/:id/favori', lire, ctrl.ajouterFavori);
router.delete('/documents/:id/favori', lire, ctrl.retirerFavori);
router.put('/documents/:id/suivi', lire, ctrl.suivre);
router.delete('/documents/:id/suivi', lire, ctrl.nePlusSuivre);

// Commenter est un acte de collaboration : documents.view suffit (voir 033).
router.get('/documents/:id/commentaires', lire, ctrl.commentaires);
router.get('/documents/:id/commentaires/mentionnables', lire, ctrl.mentionnables);
router.post('/documents/:id/commentaires', lire, ctrl.commenter);
router.patch('/documents/:id/commentaires/:commentaireId', lire, ctrl.modifierCommentaire);
router.delete('/documents/:id/commentaires/:commentaireId', lire, ctrl.supprimerCommentaire);

router.get('/documents/:id/partages', partager, ctrl.partages);
router.post('/documents/:id/partages', partager, ctrl.creerPartage);
router.delete('/documents/:id/partages/:partageId', partager, ctrl.revoquerPartage);

router.post('/documents/:id/files/:fileId/restaurer', versions, ctrl.restaurerVersion);

module.exports = router;
