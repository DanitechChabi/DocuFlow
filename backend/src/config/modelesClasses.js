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
//   nature     — rôle dans les contrôles de conformité (facture, devis, attestation)
//   champs     — propriétés propres à la classe : [libellé, type, requis?, options?]
// ============================================================================

const PAIEMENT = ['À payer', 'Payée', 'Payée partiellement', 'En litige'];

// Marchés publics : les rubriques des bordereaux de traitement d'un fonds de
// PRMP (personne responsable des marchés publics). Les sigles sont ceux du
// terrain : ils figurent sur la lettre de soumission ou la page de garde.
const MODES_PASSATION = [
  "DAO — Dossier d'appel d'offres", 'DRP — Demande de renseignements et de prix', 'DC — Demande de cotation',
  'DP — Demande de proposition', 'DFP — Demande de facture proforma', "AMI — Avis à manifestation d'intérêt", 'Autre',
];
const TYPES_MARCHE = ['Travaux', 'Fournitures', 'Services', 'Prestations intellectuelles'];

const CLASSES = [
  // --- Finances ------------------------------------------------------------
  { code: 'FACF', nom: 'Facture fournisseur', categorie: 'Finances', mots_cles: 'facture, invoice', nature: 'facture',
    modele_nom: 'FACF-{année}-{N° de facture} — {Fournisseur}', dossiers: ['Factures fournisseurs', 'Factures'], annee: true,
    champs: [['N° de facture', 'text', true], ['Fournisseur', 'text', true], ['Date de facture', 'date'], ['Montant HT', 'number'],
      ['TVA', 'number'], ['Montant TTC', 'number', true], ['Date d\'échéance', 'date'], ['Statut de paiement', 'select', false, PAIEMENT]] },
  { code: 'FACC', nom: 'Facture client', categorie: 'Finances', mots_cles: 'facture client, facture de vente', nature: 'facture',
    modele_nom: 'FACC-{année}-{N° de facture} — {Client}', dossiers: ['Factures clients', 'Factures'], annee: true,
    champs: [['N° de facture', 'text', true], ['Client', 'text', true], ['Date de facture', 'date'], ['Montant TTC', 'number', true],
      ['Date d\'échéance', 'date'], ['Statut de paiement', 'select', false, PAIEMENT]] },
  { code: 'BC', nom: 'Bon de commande', categorie: 'Finances', mots_cles: 'bon de commande, purchase order',
    modele_nom: 'BC-{année}-{compteur} — {Fournisseur}', dossiers: ['Commandes', 'Achats'], annee: true,
    champs: [['N° de commande', 'text'], ['Fournisseur', 'text', true], ['Date de commande', 'date'], ['Montant TTC', 'number']] },
  { code: 'DEV', nom: 'Devis', categorie: 'Finances', mots_cles: 'devis, proforma, facture proforma', nature: 'devis',
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
  // --- Commune (Bénin) -------------------------------------------------------
  { code: 'ECN', nom: 'Acte de naissance', categorie: 'État civil (commune)', mots_cles: 'acte de naissance, naissance, declaration de naissance',
    modele_nom: 'ECN-{année}-{N° d\'acte} — {Nom}', dossiers: ['Naissances', 'État civil'], annee: true,
    champs: [['N° d\'acte', 'text', true], ['Nom', 'text', true], ['Prénoms', 'text'], ['Date de naissance', 'date', true], ['Lieu de naissance', 'text'], ['Arrondissement', 'text'], ['Père', 'text'], ['Mère', 'text']] },
  { code: 'ECM', nom: 'Acte de mariage', categorie: 'État civil (commune)', mots_cles: 'acte de mariage, mariage, celebration du mariage',
    modele_nom: 'ECM-{année}-{N° d\'acte} — {Époux} et {Épouse}', dossiers: ['Mariages', 'État civil'], annee: true,
    champs: [['N° d\'acte', 'text', true], ['Époux', 'text', true], ['Épouse', 'text', true], ['Date du mariage', 'date', true], ['Arrondissement', 'text'], ['Régime matrimonial', 'text']] },
  { code: 'ECD', nom: 'Acte de décès', categorie: 'État civil (commune)', mots_cles: 'acte de deces, deces, declaration de deces',
    modele_nom: 'ECD-{année}-{N° d\'acte} — {Nom du défunt}', dossiers: ['Décès', 'État civil'], annee: true,
    champs: [['N° d\'acte', 'text', true], ['Nom du défunt', 'text', true], ['Date du décès', 'date', true], ['Lieu du décès', 'text'], ['Arrondissement', 'text'], ['Déclarant', 'text']] },
  { code: 'DCC', nom: 'Délibération du conseil communal', categorie: 'Administration communale', mots_cles: 'deliberation, conseil communal, session du conseil',
    modele_nom: 'DCC-{année}-{N° de délibération} — {Objet}', dossiers: ['Délibérations du conseil communal', 'Arrêtés et décisions'], annee: true,
    champs: [['N° de délibération', 'text', true], ['Date de la session', 'date', true], ['Objet', 'text', true], ['Type de session', 'select', false, ['Ordinaire', 'Extraordinaire']]] },
  { code: 'DPA', nom: 'Dossier individuel d\'agent', categorie: 'Ressources humaines', mots_cles: 'dossier individuel, dossier du personnel, fiche signaletique',
    modele_nom: 'DPA — {Agent} — {Matricule}', dossiers: ['Dossiers du personnel', 'Ressources humaines'],
    champs: [['Agent', 'text', true], ['Matricule', 'text', true], ['Date de naissance', 'date', true], ['Date de prise de service', 'date'], ['Date de cessation', 'date']] },
  // --- Marchés publics (PRMP) -------------------------------------------------
  // MP décrit le DOSSIER de marché, une ligne de bordereau : c'est lui que l'on
  // met en boîte et que l'on cote. Les classes suivantes décrivent ses pièces.
  { code: 'MP', nom: 'Dossier de marché public', categorie: 'Marchés publics (PRMP)', mots_cles: 'marche public, dossier de marche, attribution du marche',
    modele_nom: 'MP-{année}-{Référence du dossier} — {Objet du marché}', dossiers: ['Marchés et contrats', 'Contrats'], annee: true,
    champs: [['Référence du dossier', 'text', true], ['Objet du marché', 'text', true], ['Mode de passation', 'select', false, MODES_PASSATION],
      ['Type de marché', 'select', false, TYPES_MARCHE], ['N° SIGMAP', 'text'], ['N° de contrat', 'text'], ['Attributaire', 'text'],
      ['Montant TTC', 'number'], ['Pièces constitutives', 'text']] },
  { code: 'DAC', nom: "Dossier d'appel à concurrence", categorie: 'Marchés publics (PRMP)',
    mots_cles: "dossier d'appel d'offres, appel d'offres, demande de renseignements et de prix, demande de cotation, demande de proposition, avis a manifestation d'interet",
    modele_nom: 'DAC-{année}-{Référence} — {Objet du marché}', dossiers: ["Dossiers d'appel à concurrence", 'Marchés et contrats'], annee: true,
    champs: [['Référence', 'text', true], ['Objet du marché', 'text', true], ['Mode de passation', 'select', true, MODES_PASSATION],
      ['Type de marché', 'select', false, TYPES_MARCHE], ['N° SIGMAP', 'text'], ['Date de publication', 'date'], ['Date limite de dépôt', 'date']] },
  { code: 'SMP', nom: 'Offre de soumissionnaire', categorie: 'Marchés publics (PRMP)', mots_cles: 'lettre de soumission, offre technique, offre financiere, soumissionnaire',
    modele_nom: 'SMP-{année}-{Référence du dossier} — {Soumissionnaire}', dossiers: ['Soumissions', 'Marchés et contrats'], annee: true,
    champs: [['Référence du dossier', 'text', true], ['Soumissionnaire', 'text', true], ['Objet du marché', 'text'],
      ['Mode de passation', 'select', false, MODES_PASSATION], ['Type de marché', 'select', false, TYPES_MARCHE], ['N° SIGMAP', 'text'],
      ['Date de soumission', 'date'], ['Montant', 'number']] },
  { code: 'RMP', nom: 'Rapport ou procès-verbal de marché', categorie: 'Marchés publics (PRMP)',
    mots_cles: "proces-verbal d'ouverture, rapport d'evaluation, analyse des offres, attribution provisoire",
    modele_nom: 'RMP-{année}-{Référence du dossier} — {Nature}', dossiers: ['Rapports et procès-verbaux', 'Procès-verbaux', 'Marchés et contrats'], annee: true,
    champs: [['Référence du dossier', 'text', true],
      ['Nature', 'select', true, ["Procès-verbal d'ouverture des plis", "Rapport d'évaluation des offres", "Procès-verbal d'attribution", "Rapport d'exécution", 'Procès-verbal de réception', 'Autre']],
      ['Date', 'date'], ['N° SIGMAP', 'text']] },
  { code: 'CMP', nom: 'Contrat de marché', categorie: 'Marchés publics (PRMP)', mots_cles: 'contrat de marche, lettre de commande, marche numero',
    modele_nom: 'CMP-{année}-{N° de contrat} — {Attributaire}', dossiers: ['Marchés et contrats', 'Contrats'], annee: true,
    champs: [['N° de contrat', 'text', true], ['Objet du marché', 'text', true], ['Attributaire', 'text', true], ['Type de marché', 'select', false, TYPES_MARCHE],
      ['N° SIGMAP', 'text'], ['Montant TTC', 'number'], ['Date de signature', 'date'], ['Date de réception définitive', 'date']] },
  { code: 'DCP', nom: 'Décompte ou facture de marché', categorie: 'Marchés publics (PRMP)', mots_cles: 'decompte, attachement, facture de marche',
    modele_nom: 'DCP-{année}-{N° de contrat} — {N° du décompte}', dossiers: ['Décomptes et factures', 'Factures fournisseurs', 'Marchés et contrats'], annee: true,
    champs: [['N° de contrat', 'text', true], ['N° du décompte', 'text'], ['Attributaire', 'text'], ['Montant', 'number'], ['Date', 'date']] },
  { code: 'AVP', nom: 'Avis publié (journal)', categorie: 'Marchés publics (PRMP)', mots_cles: 'journal des marches publics, avis d\'appel d\'offres, avis d\'attribution',
    modele_nom: 'AVP-{année} — {Journal} — {Date de parution}', dossiers: ['Publications et avis', 'Marchés et contrats'], annee: true,
    champs: [['Journal', 'text', true], ['Date de parution', 'date', true], ['Objet du marché', 'text'], ['Mode de passation', 'select', false, MODES_PASSATION],
      ['N° SIGMAP', 'text'], ['Page', 'text']] },
  { code: 'AFF', nom: 'Dossier foncier', categorie: 'Domaines et urbanisme', mots_cles: 'titre foncier, certificat de propriete fonciere, attestation de detention coutumiere, lotissement, parcelle',
    modele_nom: 'AFF — {N° de parcelle} — {Titulaire}', dossiers: ['Affaires foncières', 'Domaines et urbanisme'],
    champs: [['N° de parcelle', 'text', true], ['Titulaire', 'text', true], ['Nature de l\'acte', 'text'], ['Date de l\'acte', 'date'], ['Localisation', 'text']] },
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
  {
    code: 'commune', nom: 'Commune (Bénin)',
    arbre: [
      ['100 Administration générale', ['110 Courrier arrivé', '120 Courrier départ', '130 Arrêtés et décisions', '140 Délibérations du conseil communal', '150 Procès-verbaux']],
      ['200 État civil', ['210 Naissances', '220 Mariages', '230 Décès']],
      ['300 Ressources humaines', ['310 Dossiers du personnel', '320 Paie', '330 Congés et absences']],
      ['400 Finances et marchés publics', ['410 Factures fournisseurs', '420 Marchés et contrats', '430 Budget', '440 Banque et trésorerie']],
      ['500 Domaines et urbanisme', ['510 Affaires foncières', '520 Permis et autorisations']],
      ['600 Attestations et autorisations', ['610 Demandes', '620 Attestations délivrées', '630 Prorogations', '640 Soumissions']],
      ['900 Pré-archivage et versements', []],
    ],
  },
  {
    // Le fonds d'une personne responsable des marchés publics, tel qu'il se
    // traite sur le terrain : par étape de la procédure, puis par année.
    code: 'prmp', nom: 'Marchés publics (PRMP)',
    arbre: [
      ['100 Planification', ['110 Plans de passation des marchés', '120 Avis généraux']],
      ['200 Passation', ["210 Dossiers d'appel à concurrence", '220 Soumissions', '230 Rapports et procès-verbaux', '240 Publications et avis']],
      ['300 Contrats et exécution', ['310 Marchés et contrats', '320 Décomptes et factures', '330 Réceptions']],
      ['400 Correspondances', ['410 Courrier arrivé', '420 Courrier départ']],
      ['500 Contrôles et audits', []],
      ['900 Pré-archivage et versements', []],
    ],
  },
  {
    // Les archives d'un cabinet lui-même (conseil, archivage, informatique) :
    // ses marchés, ses projets, ses propres outils de gestion documentaire.
    code: 'cabinet', nom: 'Cabinet de conseil / prestataire de services',
    arbre: [
      ['100 Direction et administration', ['110 Courrier arrivé', '120 Courrier départ', '130 Notes et décisions', '140 Procès-verbaux et réunions', '150 Statuts et actes']],
      ['200 Marchés et clients', ["210 Dossiers d'appel à concurrence", '220 Soumissions', '230 Contrats', '240 Références et attestations']],
      ['300 Projets et missions', ['310 Projets', '320 Rapports', '330 Livrables']],
      ['400 Ressources humaines', ['410 Dossiers du personnel', '420 Paie', '430 Congés et absences', '440 Stagiaires']],
      ['500 Finances et comptabilité', ['510 Factures fournisseurs', '520 Factures clients', '530 Banque et trésorerie', '540 Fiscalité']],
      ['600 Moyens généraux', ['610 Commandes', '620 Patrimoine et équipements']],
      ['700 Gestion documentaire', ['710 Politique et procédures', '720 Plan de classement et tableau de gestion', '730 Formation']],
    ],
  },
];

module.exports = { CLASSES, PLANS, MODES_PASSATION, TYPES_MARCHE };
