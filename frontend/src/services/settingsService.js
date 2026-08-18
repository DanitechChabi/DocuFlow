import api from './api';

export const settingsService = {
  getSettings: async () => {
    const response = await api.get('/settings');
    return response.data;
  },

  /**
   * Catalogue typé + valeurs courantes, regroupés par onglet.
   * L'interface de configuration se construit depuis cette réponse : la liste
   * des paramètres n'est donc pas dupliquée côté frontend, et tout paramètre
   * ajouté au catalogue backend apparaît automatiquement.
   * @returns {Promise<{groups: Array, values: object}>}
   */
  getConfiguration: async () => {
    const response = await api.get('/settings/configuration');
    return response.data;
  },

  updateSettings: async (data) => {
    const response = await api.put('/settings', data);
    return response.data;
  },

  /** Réinitialise un groupe de paramètres (ou tous si `group` est omis). */
  resetSettings: async (group = null) => {
    const response = await api.post('/settings/reset', group ? { group } : {});
    return response.data;
  },

  /**
   * (Re)crée les objets par défaut manquants de l'organisation : schéma de
   * métadonnées, dossiers, vues dynamiques, politique de rétention, zone de
   * stockage, groupes, sections. Idempotent.
   */
  provisionDefaults: async () => {
    const response = await api.post('/settings/provision');
    return response.data;
  },

  /**
   * Téléverse une image de configuration.
   * `key` passe par la query : multer ne peuple `req.body` qu'avec les champs
   * texte précédant le fichier dans le corps multipart.
   * @param {File} file
   * @param {string} key site_logo | site_favicon | login_background_url
   */
  uploadLogo: async (file, key = 'site_logo') => {
    const formData = new FormData();
    formData.append('logo', file);
    const response = await api.post(`/settings/logo?key=${encodeURIComponent(key)}`, formData);
    return response.data;
  }
};
