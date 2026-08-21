const express = require('express');
const router = express.Router();
const superadminController = require('../controllers/superadminController');
const licenseController = require('../controllers/licenseController');
const authMiddleware = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const platformOwnerMiddleware = require('../middlewares/platformOwnerMiddleware');

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
router.get('/licenses', licenseController.list);
router.post('/licenses', licenseController.create);
router.patch('/licenses/:id', licenseController.update);
router.post('/licenses/:id/reset-machine', licenseController.resetMachine);

module.exports = router;
