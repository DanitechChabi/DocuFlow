// ============================================================================
// Modèles DocuFlow — classes de documents et plans de classement prêts à
// l'emploi. Une organisation les INSTALLE (copie) puis les adapte librement :
// rien ici n'est lu après l'installation.
//
// Classe : { code, nom, categorie, mots_cles, modele_nom, dossiers, annee, champs }
//   mots_cles  — ce qui la fait reconnaître dans le texte d'un scan
//   modele_nom — charte de nommage (voir services/classeService.rendreNom)
//   dossiers   — noms (sans code) du dossier de rangement, par préférence
//   annee      — ranger dans un sous-dossier par année
//   champs     — propriétés propres à la classe : [libellé, type, requis?, options?]
// ============================================================================

const PAIEMENT = ['À payer', 'Payée', 'Payée partiellement', 'En litige'];

const CLASSES = [
  // --- Finances ------------------------------------------------------------
  { code: 'FACF', nom: 'Facture fournisseur', categorie: 'Finances', mots_cles: 'facture, invoice',
    modele_nom: 'FACF-{année}-{N° de facture} — {Fournisseur}', dossiers: ['Factures fournisseurs', 'Factures'], annee: true,
    champs: [['N° de facture', 'text', true], ['Fournisseur', 'text', true], ['Date de facture', 'date'], ['Montant HT', 'number'],
      ['TVA', 'number'], ['Montant TTC', 'number', true], ['Date d\'échéance', 'date'], ['Statut de paiement', 'select', false, PAIEMENT]] },
  { code: 'FACC', nom: 'Facture client', categorie: 'Finances', mots_cles: 'facture client, facture de vente',
    modele_nom: 'FACC-{année}-{N° de facture} — {Client}', dossiers: ['Factures clients', 'Factures'], annee: true,
    champs: [['N° de facture', 'text', true], ['Client', 'text', true], ['Date de facture', 'date'], ['Montant TTC', 'number', true],
      ['Date d\'échéance', 'date'], ['Statut de paiement', 'select', false, PAIEMENT]] },
  { code: 'BC', nom: 'Bon de commande', categorie: 'Finances', mots_cles: 'bon de commande, purchase order',
    modele_nom: 'BC-{année}-{compteur} — {Fournisseur}', dossiers: ['Commandes', 'Achats'], annee: true,
    champs: [['N° de commande', 'text'], ['Fournisseur', 'text', true], ['Date de commande', 'date'], ['Montant TTC', 'number']] },
  { code: 'DEV', nom: 'Devis', categorie: 'Finances', mots_cles: 'devis, proforma, facture proforma',
    modele_nom: 'DEV-{année}-{compteur} — {Fournisseur}', dossiers: ['Commandes', 'Achats'], annee: true,
    champs: [['N° de devis', 'text'], ['Fournisseur', 'text', true], ['Date du devis', 'date'], ['Montant TTC', 'number'], ['Date de validité', 'date']] },
  { code: 'REC', nom: 'Reçu / quittance', categorie: 'Finances', mots_cles: 'reçu, quittance, recu de paiement',
    modele_nom: 'REC-{année}-{compteur} — {Payeur}', dossiers: ['Banque et trésorerie', 'Finances'], annee: true,
    champs: [['N° de reçu', 'text'], ['Payeur', 'text', true], ['Montant', 'number', true], ['Date de paiement', 'date'],
      ['Mode de paiement', 'select', false, ['Espèces', 'Chèque', 'Virement', 'Mobile money']]] },
  { code: 'RLB', nom: 'Relevé bancaire', categorie: 'Finances', mots_cles: 'relevé de compte, releve bancaire, extrait de compte',
    modele_nom: 'RLB — {Banque} — {Période du}', dossiers: ['Banque et trésorerie', 'Finances'], annee: true,
    champs: [['Banque', 'text', true], ['N° de compte', 'text'], ['Période du', 'date'], ['Période au', 'date']] },

  // --- Ressources humaines -------------------------------------------------
  { code: 'CTT', nom: 'Contrat de travail', categorie: 'Ressources humaines', mots_cles: 'contrat de travail, contrat a duree',
    modele_nom: 'CTT — {Employé} — {Matricule}', dossiers: ['Dossiers du personnel', 'Ressources humaines'],
    champs: [['Employé', 'text', true], ['Matricule', 'text'], ['Poste', 'text'], ['Type de contrat', 'select', false, ['CDI', 'CDD', 'Stage', 'Consultance']],
      ['Date d\'embauche', 'date'], ['Date de fin', 'date']] },
  { code: 'BP', nom: 'Bulletin de paie', categorie: 'Ressources humaines', mots_cles: 'bulletin de paie, bulletin de salaire, fiche de paie',
    modele_nom: 'BP-{année} — {Employé} — {Mois de paie}', dossiers: ['Paie', 'Ressources humaines'], annee: true,
    champs: [['Employé', 'text', true], ['Matricule', 'text'], ['Mois de paie', 'date'], ['Salaire net', 'number']] },
  { code: 'ATTR', nom: 'Attestation de travail', categorie: 'Ressources humaines', mots_cles: 'attestation de travail, certificat de travail',
    modele_nom: 'ATTR — {Employé} — {date}', dossiers: ['Dossiers du personnel', 'Ressources humaines'],
    champs: [['Employé', 'text', true], ['Matricule', 'text'], ['Date de délivrance', 'date']] },
  { code: 'CNG', nom: 'Demande de congé', categorie: 'Ressources humaines', mots_cles: 'demande de conge, conge annuel, demande d\'absence',
    modele_nom: 'CNG-{année}-{compteur} — {Employé}', dossiers: ['Congés et absences', 'Ressources humaines'], annee: true,
    champs: [['Employé', 'text', true], ['Date de début', 'date', true], ['Date de fin', 'date', true],
      ['Type de congé', 'select', false, ['Annuel', 'Maladie', 'Maternité', 'Exceptionnel']], ['Décision', 'select', false, ['En attente', 'Accordé', 'Refusé']]] },

  // --- Juridique -----------------------------------------------------------
  { code: 'CTR', nom: 'Contrat', categorie: 'Juridique', mots_cles: 'contrat, convention, accord, bail',
    modele_nom: 'CTR-{année}-{compteur} — {Cocontractant}', dossiers: ['Contrats', 'Marchés et contrats'],
    champs: [['Cocontractant', 'text', true], ['Objet', 'text', true], ['Date de signature', 'date'], ['Date d\'effet', 'date'],
      ['Date d\'échéance', 'date'], ['Montant', 'number']] },
  { code: 'AVN', nom: 'Avenant', categorie: 'Juridique', mots_cles: 'avenant',
    modele_nom: 'AVN — {Contrat de référence} — {Cocontractant}', dossiers: ['Contrats', 'Marchés et contrats'],
    champs: [['Contrat de référence', 'text', true], ['Cocontractant', 'text'], ['Objet', 'text'], ['Date de signature', 'date']] },
  { code: 'PV', nom: 'Procès-verbal', categorie: 'Juridique', mots_cles: 'proces-verbal, proces verbal, compte rendu de reunion',
    modele_nom: 'PV — {Instance} — {Date de la séance}', dossiers: ['Procès-verbaux', 'Procès-verbaux et réunions'], annee: true,
    champs: [['Instance', 'select', false, ['Assemblée générale', 'Conseil d\'administration', 'Comité de direction', 'Réunion de service', 'Autre']],
      ['Date de la séance', 'date', true], ['Lieu', 'text']] },

  // --- Courrier ------------------------------------------------------------
  { code: 'CA', nom: 'Courrier arrivé', categorie: 'Courrier', mots_cles: 'courrier, lettre',
    modele_nom: 'CA-{année}-{compteur} — {Expéditeur}', dossiers: ['Courrier arrivé', 'Courriers'], annee: true,
    champs: [['Expéditeur', 'text', true], ['Objet', 'text', true], ['Date de réception', 'date', true], ['Service destinataire', 'text'],
      ['Réponse attendue', 'boolean']] },
  { code: 'CD', nom: 'Courrier départ', categorie: 'Courrier', mots_cles: 'courrier depart',
    modele_nom: 'CD-{année}-{compteur} — {Destinataire}', dossiers: ['Courrier départ', 'Courriers'], annee: true,
    champs: [['Destinataire', 'text', true], ['Objet', 'text', true], ['Date d\'envoi', 'date', true], ['N° de référence', 'text']] },
  { code: 'NS', nom: 'Note de service', categorie: 'Courrier', mots_cles: 'note de service, note circulaire, circulaire',
    modele_nom: 'NS-{année}-{compteur} — {Objet}', dossiers: ['Notes et décisions', 'Arrêtés et décisions'], annee: true,
    champs: [['Objet', 'text', true], ['Émetteur', 'text'], ['Date', 'date']] },

  // --- Administration publique --------------------------------------------
  { code: 'ARR', nom: 'Arrêté', categorie: 'Administration publique', mots_cles: 'arrete, arrete municipal, arrete ministeriel',
    modele_nom: 'ARR-{N° d\'arrêté} — {Objet}', dossiers: ['Arrêtés et décisions', 'Actes'], annee: true,
    champs: [['N° d\'arrêté', 'text', true], ['Objet', 'text', true], ['Signataire', 'text'], ['Date de signature', 'date', true]] },
  { code: 'DEC', nom: 'Décision', categorie: 'Administration publique', mots_cles: 'decision',
    modele_nom: 'DEC-{N° de décision} — {Objet}', dossiers: ['Arrêtés et décisions', 'Notes et décisions', 'Actes'], annee: true,
    champs: [['N° de décision', 'text', true], ['Objet', 'text', true], ['Signataire', 'text'], ['Date de signature', 'date']] },
  { code: 'DAT', nom: 'Demande d\'attestation', categorie: 'Administration publique', mots_cles: 'demande d\'attestation, demande de delivrance',
    modele_nom: 'DAT — {N° de dossier} — {Demandeur}', dossiers: ['Demandes', 'Attestations et autorisations'], annee: true,
    champs: [['N° de dossier', 'text', true], ['Demandeur', 'text', true], ['Date de dépôt', 'date', true], ['Objet', 'text']] },
  { code: 'SOU', nom: 'Soumission', categorie: 'Administration publique', mots_cles: 'soumission, offre',
    modele_nom: 'SOU — {N° de dossier} — {Soumissionnaire}', dossiers: ['Soumissions', 'Attestations et autorisations'], annee: true,
    champs: [['N° de dossier', 'text', true], ['Soumissionnaire', 'text', true], ['N° de soumission', 'text'], ['Date de soumission', 'date'], ['Montant', 'number']] },
  { code: 'PRO', nom: 'Prorogation', categorie: 'Administration publique', mots_cles: 'prorogation, prolongation, renouvellement',
    modele_nom: 'PRO — {N° de dossier} — {Bénéficiaire}', dossiers: ['Prorogations', 'Attestations et autorisations'], annee: true,
    champs: [['N° de dossier', 'text', true], ['Bénéficiaire', 'text', true], ['Durée accordée', 'text'], ['Nouvelle date d\'échéance', 'date', true], ['Motif', 'text']] },
  { code: 'ATD', nom: 'Attestation délivrée', categorie: 'Administration publique', mots_cles: 'attestation, certificat',
    modele_nom: 'ATD-{N° d\'attestation} — {Bénéficiaire}', dossiers: ['Attestations délivrées', 'Attestations et autorisations'], annee: true,
    champs: [['N° d\'attestation', 'text', true], ['N° de dossier', 'text'], ['Bénéficiaire', 'text', true], ['Date de délivrance', 'date', true], ['Date de validité', 'date']] },
];

// Plans de classement : arborescence codée (code + libellé, à la manière des
// plans d'archivage). [nom, [sous-dossiers]].
const PLANS = [
  {
    code: 'entreprise', nom: 'Entreprise / organisation privée',
    arbre: [
      ['100 Administration générale', ['110 Courrier arrivé', '120 Courrier départ', '130 Notes et décisions', '140 Procès-verbaux et réunions']],
      ['200 Ressources humaines', ['210 Dossiers du personnel', '220 Paie', '230 Recrutement', '240 Congés et absences']],
      ['300 Finances et comptabilité', ['310 Factures fournisseurs', '320 Factures clients', '330 Banque et trésorerie', '340 Budget']],
      ['400 Juridique', ['410 Contrats', '420 Contentieux', '430 Statuts et actes']],
      ['500 Achats et logistique', ['510 Commandes', '520 Patrimoine et équipements']],
      ['600 Projets et activités', ['610 Projets', '620 Rapports']],
    ],
  },
  {
    code: 'administration', nom: 'Administration publique',
    arbre: [
      ['100 Cabinet et secrétariat', ['110 Courrier arrivé', '120 Courrier départ', '130 Arrêtés et décisions', '140 Procès-verbaux']],
      ['200 Ressources humaines', ['210 Dossiers du personnel', '220 Paie', '240 Congés et absences']],
      ['300 Attestations et autorisations', ['310 Demandes', '320 Soumissions', '330 Prorogations', '340 Attestations délivrées']],
      ['400 Finances et marchés', ['410 Factures fournisseurs', '420 Marchés et contrats', '430 Budget']],
      ['500 Archives historiques', []],
    ],
  },
];

module.exports = { CLASSES, PLANS };
