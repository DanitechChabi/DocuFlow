const express = require('express');
const router = express.Router();
const superadminController = require('../controllers/superadminController');
const licenseController = require('../controllers/licenseController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const platformOwnerMiddleware = require('../middlewares/platformOwnerMiddleware');

// ---------------------------------------------------------------------------
// vendorOnly — l'administration des licences n'existe QUE sur le serveur éditeur.
//
// POURQUOI : platformOwnerMiddleware accorde ces pouvoirs au superadmin du
// tenant 1. Or sur un poste de bureau, bootstrap.js CRÉE précisément un
// superadmin de tenant 1 (admin / Admin123!, identifiants publics : ils sont
// dans desktop/README.md). Chaque installation client embarquait donc un compte
// « propriétaire de la plateforme » capable d'émettre, de prolonger ou de délier
// des licences — c'est-à-dire de se donner l'abonnement gratuitement.
//
// La base locale est certes distincte de celle de Render, mais deux des quatre
// routes n'en dépendent pas : `create` fait signer une clé par le serveur de
// signature, et l'écran d'administration s'ouvre pour de bon. Le seul endroit
// où ces routes ont un sens est le SaaS, où le tenant 1 est réellement l'éditeur.
//
// 404 et non 403 : en mode bureau ces routes ne devraient pas exister. Un 403
// confirmerait leur présence et désignerait la cible à qui cherche.
const vendorOnly = (req, res, next) => {
  if (process.env.SERVE_FRONTEND === 'true') {
    return res.status(404).json({ message: 'Route inconnue' });
  }
  next();
};

// Toutes les routes nécessitent auth + superadmin + ÊTRE LE PROPRIÉTAIRE DE LA PLATEFORME
// (tenant 1). Les superadmins des entreprises créées via register-company n'ont
// PAS accès aux données globales : ils utilisent leurs propres routes scoped.
router.use(authMiddleware);
router.use(roleMiddleware(['superadmin']));
router.use(platformOwnerMiddleware);

// Statistiques globales (avec stats par entreprise)
router.get('/stats', superadminController.getStats);

// Gestion des demandes (tous tenants) — voir, archiver, désarchiver, supprimer
router.get('/requests', superadminController.getAllRequests);
router.patch('/requests/:id/archive', superadminController.archiveRequest);
router.patch('/requests/:id/unarchive', superadminController.unarchiveRequest);
router.delete('/requests/:id', superadminController.deleteRequest);

// Gestion globale des utilisateurs (tous tenants)
router.get('/users', superadminController.getAllUsers);
router.get('/users/superadmins', superadminController.getSuperAdmins);
router.post('/users', superadminController.createUser);
router.patch('/users/:id', superadminController.updateUser);
router.delete('/users/:id', superadminController.deleteUser);

// Réinitialisation du mot de passe
router.post('/users/:id/reset-password', superadminController.resetPassword);

// Suppression d'une entreprise et de toutes ses données (irréversible).
// Sous /superadmin plutôt que sous /tenants : ces routes-là sont gardées par le
// seul roleMiddleware(['superadmin']), donc accessibles au superadmin d'une
// entreprise quelconque. Une suppression définitive doit rester réservée au
// propriétaire de la plateforme, garanti ici par platformOwnerMiddleware.
router.delete('/tenants/:id', superadminController.deleteTenant);

// Journal d'audit global : lecture tous tenants, et purge administrative
router.get('/audit', superadminController.getGlobalAuditLogs);
router.delete('/audit', superadminController.purgeAuditLogs);

// Licences de bureau — émission, prolongation, révocation, transfert de poste.
// Sous /superadmin et non sous /licenses : ce dernier préfixe porte les routes
// PUBLIQUES d'activation (licenseRoutes.js), sans authentification. La séparation
// des préfixes rend la frontière lisible : tout ce qui est ici est gardé par les
// trois middlewares posés en haut de ce fichier, dont platformOwnerMiddleware —
// sans quoi le superadmin d'une entreprise cliente prolongerait sa propre licence.
//
// REFUSÉES EN MODE BUREAU (vendorOnly) — voir l'en-tête du middleware ci-dessus.
router.get('/licenses', vendorOnly, licenseController.list);
router.post('/licenses', vendorOnly, licenseController.create);
router.patch('/licenses/:id', vendorOnly, licenseController.update);
router.post('/licenses/:id/reset-machine', vendorOnly, licenseController.resetMachine);

module.exports = router;
