// ============================================================================
// Listes de dossiers lues dans un classeur Excel (périodes de soldes
// créditeurs, commissaire aux comptes…). Chaque FEUILLE devient une liste
// (« Liste 1 » … « Liste n ») ; ses colonnes sont rapprochées des références
// d'un dossier d'après leur titre, et l'agent peut corriger ce rapprochement.
// Fonctions pures : le fichier ne quitte pas le poste, seules les lignes
// retenues partent au serveur.
// ============================================================================
import { cle, trouverTitres, decrireColonnes, afficher } from '../../../utils/classeur';
import { typeDeCellule, detecterType } from './vocabulaire';

export const CHAMPS = [
  { cle: 'nom_entreprise', label: 'Entreprise', motifs: [/raison sociale/, /entreprise/, /societe/, /client/, /denomination/, /beneficiaire/, /\bnom\b/] },
  { cle: 'num_dossier', label: 'N° de dossier', motifs: [/dossier/, /\bcompte\b/, /\bref/] },
  // Le type avant le n° d'acte : « Type de garantie » est un type, pas un numéro.
  { cle: 'type_document', label: 'Typologie', motifs: [/\btype\b/, /nature/, /produit/, /typologie/] },
  { cle: 'num_acte', label: 'N° d\'acte', motifs: [/\bacte\b/, /garantie/, /caution/, /engagement/] },
  { cle: 'annee', label: 'Année', motifs: [/annee/, /exercice/] },
  { cle: 'description', label: 'Précisions', motifs: [/observation/, /objet/, /solde/, /montant/, /libelle/, /commentaire/] },
];

/** Associe à chaque champ la première colonne dont le titre lui correspond. */
export function associerColonnes(colonnes) {
  const pris = new Set();
  const assoc = {};
  for (const champ of CHAMPS) {
    const col = colonnes.find((c) => !pris.has(c.index) && !c.sansTitre && champ.motifs.some((m) => m.test(cle(c.titre))));
    if (col) {
      assoc[champ.cle] = col.index;
      pris.add(col.index);
    }
  }
  return assoc;
}

const enTexte = (x) => (x === '' || x === undefined || x === null ? '' : String(afficher(x)).trim());

/** Année d'une cellule : 2025, « 2025 », ou l'année d'une date. */
function annee(x) {
  if (typeof x === 'number' && Number.isInteger(x)) return String(x);
  const s = String(x ?? '').trim();
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(s) || /^\d{1,2}[/.-]\d{1,2}[/.-](\d{4})$/.exec(s);
  return m ? m[1] : s;
}

/**
 * Lignes d'une feuille, prêtes à envoyer : une par dossier, avec `rang`
 * (numéro de ligne dans le tableur) pour situer une erreur. Les lignes vides
 * et la ligne « Total » éventuelle sont laissées de côté.
 */
export function lignesDeFeuille(feuille, indexTitres, assoc, colonnes = [], types = []) {
  const titre = (index) => colonnes.find((c) => c.index === index)?.titre;
  return feuille.lignes.slice(indexTitres + 1).map((l) => {
    const v = (champ) => (assoc[champ] === undefined ? '' : l.cellules[assoc[champ]]);
    const precision = enTexte(v('description'));
    const ligne = {
      rang: l.rang,
      nom_entreprise: enTexte(v('nom_entreprise')),
      num_dossier: enTexte(v('num_dossier')),
      num_acte: enTexte(v('num_acte')),
      // Type : la colonne « Type » s'il y en a une, sinon le sigle du n° d'acte (« CBE-2025-0147 »).
      type_document: typeDeCellule(enTexte(v('type_document')), types)
        || (detecterType(enTexte(v('num_acte')), types).acte ? detecterType(enTexte(v('num_acte')), types).type : ''),
      annee: annee(v('annee')),
      description: precision && assoc.description !== undefined && titre(assoc.description) && !/observation|precision|commentaire/.test(cle(titre(assoc.description)))
        ? `${titre(assoc.description)} : ${precision}` : precision,
    };
    return ligne;
  }).filter((x) => {
    if (!x.nom_entreprise && !x.num_dossier && !x.num_acte && !x.description) return false;
    const nom = cle(x.nom_entreprise);
    return !((nom === 'total' || nom.startsWith('total ')) && !x.num_dossier && !x.num_acte);
  });
}

/** Lecture d'une feuille : titres, colonnes, association, lignes. */
export function preparerFeuille(feuille, types = []) {
  const indexTitres = trouverTitres(feuille.lignes);
  const colonnes = decrireColonnes(feuille.lignes, indexTitres);
  const assoc = associerColonnes(colonnes);
  return { indexTitres, colonnes, assoc, lignes: lignesDeFeuille(feuille, indexTitres, assoc, colonnes, types) };
}
