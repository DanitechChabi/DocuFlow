// ============================================================================
// Référentiel archivistique béninois — règles de conservation et de
// communication proposées par défaut aux classes des Modèles DocuFlow.
//
// SOURCES (textes lus, pas de mémoire) :
//   D. 2007-532   Décret n° 2007-532 du 2 novembre 2007 portant attributions,
//                 organisation et fonctionnement des Archives Nationales :
//                   art. 32  communication au public après 30 ans ;
//                   art. 33  délais spéciaux (vie privée, sûreté de l'État) ;
//                   art. 38  archives actives : 3 à 5 ans ;
//                   art. 39  archives semi-actives : 3 à 10 ans ;
//                   art. 40  tableaux d'éliminables établis EN LIAISON AVEC
//                            LA DAN (durées + sort final) ;
//                   art. 44  élimination soumise à la DAN ; sont à conserver
//                            indéfiniment les pièces qui établissent un droit
//                            et celles d'intérêt historique ;
//                   art. 46  versement aux archives publiques à 10 ans.
//   OHADA         Acte uniforme relatif au droit comptable et à l'information
//                 financière (2017) : livres et pièces justificatives
//                 conservés 10 ans.
//   C. trav.      Loi n° 98-004 du 27 janvier 1998 portant Code du travail :
//                 art. 224 (preuve du paiement du salaire), art. 232
//                 (prescription de l'action en paiement : 3 ans).
//
// CE N'EST PAS UN TABLEAU DE GESTION OFFICIEL. L'art. 40 confie à chaque
// organisme l'établissement de ses tableaux en liaison avec la DAN : ces
// valeurs sont une PROPOSITION de départ, chacune avec sa justification, que
// l'archiviste ajuste puis fait valider. L'interface le dit.
// ============================================================================

/** Catégories de communicabilité (D. 2007-532, art. 32 et 33). */
const COMMUNICABILITE = {
  libre: { libelle: 'Communicable immédiatement', annees: 0, depart: 'date_document', ref: 'D. 2007-532, art. 32 al. 4' },
  general: { libelle: '30 ans après le document', annees: 30, depart: 'date_document', ref: 'D. 2007-532, art. 32' },
  etat_civil: { libelle: "100 ans après la date de l'acte (état civil, minutes notariales, enregistrement)", annees: 100, depart: 'date_document', ref: 'D. 2007-532, art. 33' },
  medical: { libelle: '100 ans après la naissance de la personne (renseignements médicaux)', annees: 100, depart: 'naissance', ref: 'D. 2007-532, art. 33' },
  personnel: { libelle: '90 ans après la naissance de la personne (dossiers de personnel)', annees: 90, depart: 'naissance', ref: 'D. 2007-532, art. 33' },
  judiciaire: { libelle: 'Instruction judiciaire : 60 ans après la clôture', annees: 60, depart: 'date_document', ref: 'D. 2007-532, art. 33' },
  statistique: { libelle: 'Statistiques individuelles : 60 ans après le recensement ou l\'enquête', annees: 60, depart: 'date_document', ref: 'D. 2007-532, art. 33' },
  surete: { libelle: "Sûreté de l'État, militaire, diplomatique : 50 ans après l'acte", annees: 50, depart: 'date_document', ref: 'D. 2007-532, art. 33' },
};

const OHADA = 'OHADA, Acte uniforme relatif au droit comptable (2017) : pièces justificatives conservées 10 ans';
const DROIT = 'D. 2007-532, art. 44 : pièce établissant un droit, à conserver indéfiniment';
const HISTO = "D. 2007-532, art. 44 : intérêt historique ; versement à 10 ans (art. 46)";
const ACTIFS = 'D. 2007-532, art. 38-39 : archives actives 3-5 ans, semi-actives jusqu\'à 10 ans';

/**
 * Règle proposée par code de classe : dua (années), depart (point de départ),
 * sort (conservation | elimination | tri), ref (justification),
 * communicabilite (clé de COMMUNICABILITE).
 */
const CONSERVATION = {
  // Finances : pièces comptables (OHADA).
  FACF: { dua: 10, depart: 'date_document', sort: 'elimination', ref: OHADA, communicabilite: 'general' },
  FACC: { dua: 10, depart: 'date_document', sort: 'elimination', ref: OHADA, communicabilite: 'general' },
  BC: { dua: 10, depart: 'date_document', sort: 'elimination', ref: OHADA, communicabilite: 'general' },
  DEV: { dua: 10, depart: 'date_document', sort: 'elimination', ref: OHADA, communicabilite: 'general' },
  REC: { dua: 10, depart: 'date_document', sort: 'elimination', ref: OHADA, communicabilite: 'general' },
  RLB: { dua: 10, depart: 'date_document', sort: 'elimination', ref: OHADA, communicabilite: 'general' },
  // Ressources humaines : ce qui fonde des droits (carrière, retraite) se garde.
  CTT: { dua: 5, depart: 'archivage', sort: 'conservation', ref: `${DROIT} (carrière, retraite)`, communicabilite: 'personnel' },
  BP: { dua: 5, depart: 'date_document', sort: 'conservation', ref: `${DROIT} (droits à pension) ; C. trav. art. 224`, communicabilite: 'personnel' },
  ATTR: { dua: 5, depart: 'date_document', sort: 'elimination', ref: `${ACTIFS} ; copie délivrée, l'original reste au dossier`, communicabilite: 'personnel' },
  CNG: { dua: 5, depart: 'date_document', sort: 'elimination', ref: `${ACTIFS} ; C. trav. art. 232 (prescription 3 ans)`, communicabilite: 'personnel' },
  DPA: { dua: 5, depart: 'archivage', sort: 'conservation', ref: `${DROIT} (carrière, retraite)`, communicabilite: 'personnel' },
  // Juridique.
  CTR: { dua: 10, depart: 'archivage', sort: 'tri', ref: `${ACTIFS} ; trier à l'échéance (art. 43)`, communicabilite: 'general' },
  AVN: { dua: 10, depart: 'archivage', sort: 'tri', ref: `${ACTIFS} ; suit le contrat`, communicabilite: 'general' },
  PV: { dua: 10, depart: 'date_document', sort: 'conservation', ref: HISTO, communicabilite: 'general' },
  // Courrier.
  CA: { dua: 5, depart: 'date_document', sort: 'tri', ref: ACTIFS, communicabilite: 'general' },
  CD: { dua: 5, depart: 'date_document', sort: 'tri', ref: ACTIFS, communicabilite: 'general' },
  NS: { dua: 5, depart: 'date_document', sort: 'tri', ref: ACTIFS, communicabilite: 'general' },
  // Administration publique.
  ARR: { dua: 10, depart: 'date_document', sort: 'conservation', ref: `${DROIT} ; versement à 10 ans (art. 46)`, communicabilite: 'libre' },
  DEC: { dua: 10, depart: 'date_document', sort: 'conservation', ref: `${DROIT} ; versement à 10 ans (art. 46)`, communicabilite: 'general' },
  DAT: { dua: 5, depart: 'date_document', sort: 'elimination', ref: ACTIFS, communicabilite: 'general' },
  SOU: { dua: 10, depart: 'date_document', sort: 'tri', ref: `${ACTIFS} ; offres retenues à garder avec le marché`, communicabilite: 'general' },
  PRO: { dua: 10, depart: 'date_document', sort: 'tri', ref: ACTIFS, communicabilite: 'general' },
  ATD: { dua: 10, depart: 'date_document', sort: 'tri', ref: ACTIFS, communicabilite: 'general' },
  // Commune (Bénin).
  ECN: { dua: 10, depart: 'date_document', sort: 'conservation', ref: `${DROIT} ; état civil`, communicabilite: 'etat_civil' },
  ECM: { dua: 10, depart: 'date_document', sort: 'conservation', ref: `${DROIT} ; état civil`, communicabilite: 'etat_civil' },
  ECD: { dua: 10, depart: 'date_document', sort: 'conservation', ref: `${DROIT} ; état civil`, communicabilite: 'etat_civil' },
  DCC: { dua: 10, depart: 'date_document', sort: 'conservation', ref: HISTO, communicabilite: 'libre' },
  MP: { dua: 10, depart: 'archivage', sort: 'tri', ref: `${OHADA} ; ${ACTIFS}`, communicabilite: 'general' },
  AFF: { dua: 10, depart: 'archivage', sort: 'conservation', ref: `${DROIT} (propriété foncière)`, communicabilite: 'general' },
};

/** Avertissement affiché partout où le référentiel est proposé. */
const AVERTISSEMENT = "Proposition DocuFlow fondée sur le décret n° 2007-532 et l'Acte uniforme OHADA. "
  + "L'art. 40 du décret impose d'établir les tableaux d'éliminables en liaison avec la Direction des Archives Nationales : faites valider ces durées avant toute élimination.";

module.exports = { COMMUNICABILITE, CONSERVATION, AVERTISSEMENT };
