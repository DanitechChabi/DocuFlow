const db = require('../config/db');

/**
 * Service pour interagir avec le logiciel d'indexation mfile
 * Actuellement en mode SIMULATION (Mock) pour permettre le développement
 * sans accès direct à l'API mfile.
 */
const mfileService = {
  /**
   * Vérifie si un document existe dans mfile selon les critères fournis.
   * @param {Object} criteria - { nom_entreprise, num_dossier, num_acte, annee }
   * @returns {Promise<{exists: boolean, fileUrl: string|null}>}
   */
  verifyDocument: async (criteria) => {
    console.log(`[MfileService] Interrogation de mfile pour : ${criteria.nom_entreprise}, Dossier ${criteria.num_dossier}`);

    // SIMULATION : On considère que le document est trouvé si le numéro de dossier se termine par '1'
    // Dans la réalité, ceci sera remplacé par un appel API vers mfile.
    const isFound = criteria.num_dossier.endsWith('1') || criteria.num_acte === 'TEST-SURE';

    if (isFound) {
      return {
        exists: true,
        fileUrl: `http://serveur-mfile/docs/doc_${criteria.num_dossier}_${criteria.num_acte}.pdf`,
      };
    }

    return {
      exists: false,
      fileUrl: null,
    };
  },

  /**
   * Fonction pour envoyer un document numérisé vers l'utilisateur (Email/Notification)
   */
  sendDocument: async (userId, fileUrl) => {
    console.log(`[MfileService] Envoi du document ${fileUrl} à l'utilisateur ${userId}...`);
    return { success: true };
  }
};

module.exports = mfileService;
