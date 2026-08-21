// ============================================================================
// desktopLicenseRoutes — routes de l'écran de licence de l'app de bureau.
//
// Distinctes de routes/licenseRoutes.js, qui est le côté SERVEUR (Render) :
// émission et signature. Ici c'est le côté CLIENT — l'app interroge sa propre
// licence locale et peut s'activer.
//
// PAS D'AUTHENTIFICATION, ET C'EST VOULU : au premier lancement, aucun compte
// n'existe encore côté client tant que la licence bloque l'accès. Ces routes ne
// sont montées que si SERVE_FRONTEND === 'true' (voir app.js) et le serveur
// n'écoute que sur 127.0.0.1 avec un port aléatoire (desktop/main.js) : la seule
// personne qui peut les appeler est celle qui est assise devant la machine, et
// elle a déjà tous les droits sur le fichier license.dat.
// ============================================================================
const express = require('express');
const licenseGuard = require('../desktop/licenseGuard');
const { normalizeKey } = require('../services/licenseService');

const router = express.Router();

/**
 * Réponse commune. `machine_id` y figure toujours : c'est ce que le client lit au
 * téléphone au support pour qu'une licence soit transférée sur son poste.
 */
function present(state) {
  return {
    state: state?.state || 'unknown',
    message: state?.message || null,
    license_key: state?.license_key || null,
    valid_until: state?.valid_until || null,
    days_remaining: state?.days_remaining ?? null,
    grace_days_remaining: state?.grace_days_remaining ?? null,
    machine_id: state?.machine_id || licenseGuard.getMachineId(),
    offline: state?.offline || false,
    allowed: licenseGuard.isAllowed(state),
  };
}

/**
 * GET /api/license — état courant, sans appel réseau.
 * Utilisé à chaque affichage de l'écran de licence : doit être instantané.
 */
router.get('/', (req, res) => {
  res.json(present(licenseGuard.getState()));
});

/**
 * POST /api/license/check — revérifie, en interrogeant le serveur si nécessaire.
 * `force` correspond au bouton « Vérifier maintenant » : un client qui vient de
 * payer ne doit pas attendre l'échéance de renouvellement pour être débloqué.
 */
router.post('/check', async (req, res) => {
  try {
    const state = await licenseGuard.check({ force: req.body?.force === true });
    res.json(present(state));
  } catch (err) {
    console.error('[license] Vérification échouée :', err.message);
    res.status(500).json({ message: 'Vérification de licence impossible.', detail: err.message });
  }
});

/**
 * POST /api/license/activate — active ce poste avec une clé saisie.
 *
 * Le format est validé ici avant tout appel réseau : une faute de frappe doit
 * produire un message immédiat, pas un aller-retour vers Render suivi d'un 400.
 */
router.post('/activate', async (req, res) => {
  const key = normalizeKey(req.body?.license_key);
  if (!key) {
    return res.status(400).json({
      message: 'Clé de licence invalide. Format attendu : DF-XXXX-XXXX-XXXX-XXXX',
      code: 'INVALID_KEY_FORMAT',
    });
  }

  try {
    const result = await licenseGuard.activate(key);
    if (!result.ok) {
      // 402 quand le paiement est en attente (le client n'a rien fait de mal),
      // 400 pour les autres refus. Le code du serveur de licence est relayé tel
      // quel pour que l'interface puisse adapter son message.
      const status = result.code === 'PAYMENT_PENDING' ? 402 : 400;
      return res.status(status).json({
        message: result.message,
        code: result.code || result.state,
        machine_id: licenseGuard.getMachineId(),
      });
    }
    return res.json(present(result));
  } catch (err) {
    console.error('[license] Activation échouée :', err.message);
    return res.status(500).json({ message: 'Activation impossible.', detail: err.message });
  }
});

/**
 * POST /api/license/deactivate — retire la licence de ce poste.
 *
 * Utile avant de changer d'ordinateur ou de revendre la machine. Ne libère PAS
 * la licence côté serveur (seul le support peut le faire via /reset-machine) :
 * sinon n'importe qui pourrait délier puis réactiver ailleurs à volonté, ce qui
 * viderait la règle « 1 licence = 1 poste » de son sens.
 */
router.post('/deactivate', (req, res) => {
  res.json(present(licenseGuard.deactivate()));
});

module.exports = router;
