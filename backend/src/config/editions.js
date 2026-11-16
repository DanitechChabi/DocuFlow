// ============================================================================
// Préréglages des éditions dédiées (site d'une organisation, ex. AFGC).
//
// Appliqués à l'espace de l'organisation, à la demande de son administrateur :
// ils remplissent ce qu'il aurait saisi à la main dans Réglages — motifs de
// demande, types de dossier, départements. Tout reste ensuite modifiable comme
// n'importe quel réglage, et une seconde application ne défait rien (voir
// services/editionService).
// ============================================================================

const EDITIONS = {
  afgc: {
    nom: 'L\'Africaine des Garanties et du Cautionnement',
    // Motifs des demandes de dossiers : ce pour quoi un dossier sort des
    // archives. Les deux derniers sont les missions de contrôle pendant
    // lesquelles des dossiers sortent aussi (traçables comme les autres).
    motifs: [
      'Consultation', 'Prorogation', 'Actualisation', 'Renouvellement', 'Authentification', 'Remboursement',
      'Solde créditeur', 'Levée d\'engagement', 'Solde débiteur', 'Rectification', 'Appel à garantie',
      'Recouvrement', 'Restitution de provision', 'Commission bancaire', 'Commissaire aux comptes',
    ],
    // Types de dossier ; le sigle entre parenthèses sert à les reconnaître
    // dans une saisie (« CBE Agro… », « CBE-2025-0147 »).
    types: [
      'Attestation', 'Bonne exécution (CBE)', 'Avance de démarrage (CAD)', 'Caution professionnelle (CP)',
      'Caution douanière (CD)', 'Prêt', 'Garantie bancaire', 'Ouverture de compte', 'Dossier non retiré annulé',
    ],
    // Réglages de l'espace, posés s'ils ne le sont pas déjà (un choix de
    // l'administrateur n'est jamais écrasé) : un agent dont le département
    // manque peut le créer en s'inscrivant ; seules les adresses
    // professionnelles de l'AFGC (Outlook, @afgcsa.com) sont admises.
    reglages: { registration_new_department: true, registration_email_domains: 'afgcsa.com' },
    // Ce qu'une demande doit comporter selon la typologie du dossier, pour que
    // l'archive le retrouve sans rappeler le demandeur.
    exigences: {
      'Bonne exécution (CBE)': ['nom_entreprise', 'num_acte'],
      'Avance de démarrage (CAD)': ['nom_entreprise', 'num_acte'],
      'Caution professionnelle (CP)': ['nom_entreprise', 'num_acte'],
      'Caution douanière (CD)': ['nom_entreprise', 'num_acte'],
      'Prêt': ['nom_entreprise', 'annee'],
      'Garantie bancaire': ['nom_entreprise', 'banque', 'annee'],
    },
    // Départements : « SIGLE — intitulé ». Le sigle sert à proposer d'abord
    // les motifs habituels de chacun (édition AFGC du frontend).
    departements: [
      'DAI — Audit interne',
      'DGRC — Gestion des risques et conformité',
      'DRHMG — Ressources humaines et moyens généraux',
      'DC — Commercial',
      'DE — Engagement',
      'DCF — Comptabilité et finance',
      'DCI — Contrôle interne',
      'DAJ — Affaires juridiques',
      'Contrôle de gestion',
      'Direction générale',
    ],
  },
};

module.exports = { EDITIONS };
