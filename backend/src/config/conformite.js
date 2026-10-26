// ============================================================================
// conformite — constantes du contrôle de conformité.
//
// RÉFÉRENTIELS D'IDENTIFICATION. Un contrôle « le numéro d'entreprise est-il
// valide ? » n'a de sens que pour un pays : DocuFlow sert des organisations du
// Bénin (IFU, 13 chiffres), de France (SIREN 9 chiffres, SIRET 14 chiffres),
// et d'ailleurs. Le réglage `conformite_pays` choisit le référentiel ; « aucun »
// désactive les contrôles d'identifiant sans toucher aux autres règles.
//
//   principal       l'identifiant de l'entreprise (SIREN, IFU)
//   etablissement   l'identifiant de l'établissement, quand il existe (SIRET)
//   Le contrôle de cohérence compare le plus précis des deux.
// ============================================================================

const SEVERITES = ['critique', 'haute', 'moyenne', 'faible'];
const ORDRE_SEVERITE = { critique: 0, haute: 1, moyenne: 2, faible: 3 };

const TYPES_ALERTE = {
  identifiant_format: 'Identifiant d\'entreprise invalide',
  identifiant_incoherent: 'Identifiant incohérent entre documents',
  montant_incoherent: 'Écart de montant devis / facture',
  date_incoherente: 'Chronologie incohérente',
  attestation_expiree: 'Attestation expirée',
  registre_introuvable: 'Entreprise introuvable au registre officiel',
  registre_ferme: 'Entreprise ou établissement fermé',
  nom_incoherent: 'Nom différent du registre officiel',
  adresse_incoherente: 'Adresse différente du registre officiel',
};

const NATURES = ['facture', 'devis', 'attestation', 'autre'];

const REFERENTIELS = {
  bj: {
    code: 'bj',
    libelle: 'Bénin (IFU)',
    principal: { nom: 'IFU', longueur: 13, motif: /\bIFU\b/i },
    etablissement: null,
    registre: null,
  },
  fr: {
    code: 'fr',
    libelle: 'France (SIREN / SIRET)',
    principal: { nom: 'SIREN', longueur: 9, motif: /\bSIREN\b/i },
    etablissement: { nom: 'SIRET', longueur: 14, motif: /\bSIRET\b/i },
    registre: 'insee',
  },
  aucun: {
    code: 'aucun',
    libelle: 'Aucun contrôle d\'identifiant',
    principal: null,
    etablissement: null,
    registre: null,
  },
};
const REFERENTIEL_DEFAUT = 'bj';

const TOLERANCE_MONTANT_DEFAUT = 5; // pour cent

function referentiel(code) {
  return REFERENTIELS[code] || REFERENTIELS[REFERENTIEL_DEFAUT];
}

module.exports = {
  SEVERITES, ORDRE_SEVERITE, TYPES_ALERTE, NATURES,
  REFERENTIELS, REFERENTIEL_DEFAUT, TOLERANCE_MONTANT_DEFAUT, referentiel,
};
