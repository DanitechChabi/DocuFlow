import { exporterClasseur, dateExcel, nomFichier } from './exportExcel';
import { etatDossierListe } from './vocabulaire';

/**
 * Une liste (soldes créditeurs, commissaire aux comptes…) avec l'état de
 * chacun de ses dossiers, en Excel : ce que l'archive renvoie au service qui
 * l'a demandée.
 * @param {object} liste détail d'une liste (listeService.detail)
 */
export function exporterListe(liste) {
  return exporterClasseur(nomFichier(liste.libelle, liste.cadre), [{
    nom: liste.libelle,
    entetes: ['N°', 'Entreprise', 'Typologie', 'N° de dossier', 'N° d\'acte', 'Banque', 'Année', 'Montant', 'Précisions', 'État', 'Transmis le', 'Retour prévu', 'Retourné le'],
    largeurs: [6, 34, 24, 14, 16, 20, 7, 14, 30, 24, 12, 12, 12],
    lignes: liste.dossiers.map((d, i) => [
      i + 1, d.nom_entreprise || '', d.type_document || '', d.num_dossier || '', d.num_acte || '', d.banque || '', d.annee || '',
      d.montant === null || d.montant === undefined ? '' : Number(d.montant), d.description || '',
      etatDossierListe(d).texte, dateExcel(d.remis_at), dateExcel(d.date_retour_prevue), dateExcel(d.retourne_at),
    ]),
  }, {
    nom: 'Liste',
    entetes: [liste.libelle, ''],
    largeurs: [22, 60],
    lignes: [
      ['Motif', liste.cadre],
      ['Pour', liste.demandeur_name || ''],
      ['Déposée le', dateExcel(liste.created_at)],
      ['Classeur d\'origine', liste.fichier || ''],
      ['Dossiers', liste.dossiers.length],
    ],
  }]);
}
