import api from './api';

/**
 * Licence de la version bureau (Electron).
 *
 * Ces routes ne sont montées par le backend qu'en mode bureau (SERVE_FRONTEND) :
 * sur le SaaS web elles répondent 404. C'est LicenseContext qui décide de les
 * appeler ou non — ce service ne fait aucune détection de plateforme.
 */
export const licenseService = {
  /** État courant, sans appel réseau côté backend : réponse immédiate. */
  getState: async () => {
    const response = await api.get('/license');
    return response.data;
  },

  /**
   * Revérifie la licence.
   * @param {boolean} force interroger le serveur de licence même si l'artefact
   *   local est encore frais — c'est le bouton « Vérifier maintenant », pour le
   *   client qui vient de payer et ne veut pas attendre le renouvellement.
   */
  check: async (force = false) => {
    const response = await api.post('/license/check', { force });
    return response.data;
  },

  /** Active ce poste avec la clé reçue par e-mail. */
  activate: async (licenseKey) => {
    const response = await api.post('/license/activate', { license_key: licenseKey });
    return response.data;
  },

  /** Retire la licence de ce poste (changement d'ordinateur, revente). */
  deactivate: async () => {
    const response = await api.post('/license/deactivate');
    return response.data;
  },
};
