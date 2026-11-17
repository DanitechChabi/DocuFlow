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
    reglages: { registration_new_department: true, registration_email_domains: 'afgcsa.com', mfiles_annees: '2025' },
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
    // Plan de rangement des dossiers entrés : les armoires du couloir des
    // toilettes, chacune de (semaine, lettre) à (semaine, lettre) — semaines de
    // production du vendredi au jeudi, 2025. Une lettre partagée (« S », puis
    // « S' » dans l'armoire suivante) figure aux deux bornes. L'armoire 7 tient
    // en deux rangées continues (18-24 avril I → 9-15 mai Z, puis 16-22 mai
    // A → M). Installé à la demande (Entrée des dossiers → Rangement).
    rangements: [
      { nom: 'Armoire 2', lieu: 'Couloir des toilettes', debut_semaine: '2025-01-17', debut_lettre: null, fin_semaine: '2025-02-07', fin_lettre: 'B' },
      { nom: 'Armoire 3', lieu: 'Couloir des toilettes', debut_semaine: '2025-02-07', debut_lettre: 'C', fin_semaine: '2025-02-21', fin_lettre: 'S' },
      { nom: 'Armoire 4', lieu: 'Couloir des toilettes', debut_semaine: '2025-02-21', debut_lettre: 'S', fin_semaine: '2025-04-04', fin_lettre: 'C' },
      { nom: 'Armoire 5', lieu: 'Couloir des toilettes', debut_semaine: '2025-04-04', debut_lettre: 'D', fin_semaine: '2025-04-11', fin_lettre: 'F' },
      { nom: 'Armoire 6', lieu: 'Couloir des toilettes', debut_semaine: '2025-04-11', debut_lettre: 'G', fin_semaine: '2025-04-18', fin_lettre: 'H' },
      { nom: 'Armoire 7', lieu: 'Couloir des toilettes', debut_semaine: '2025-04-18', debut_lettre: 'I', fin_semaine: '2025-05-16', fin_lettre: 'M' },
      { nom: 'Armoire 8', lieu: 'Couloir des toilettes', debut_semaine: '2025-05-16', debut_lettre: 'M', fin_semaine: '2025-05-23', fin_lettre: 'J' },
      { nom: 'Armoire 9', lieu: 'Couloir des toilettes', debut_semaine: '2025-05-23', debut_lettre: 'K', fin_semaine: '2025-06-20', fin_lettre: 'C' },
    ],
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
