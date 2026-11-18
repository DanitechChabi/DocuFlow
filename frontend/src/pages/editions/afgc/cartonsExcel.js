import { cle } from '../../../utils/classeur';

// ============================================================================
// Lecture des classeurs des dossiers en cartons (057), tels que l'archive les
// tient :
//
// 1. « Point des dossiers non retirés / annulés » : une feuille par année,
//    en-tête « N° · Dénomination client · Typologie · N° Actes · Status ·
//    Années · Cartons », répété en haut de chaque carton ; les années d'une
//    feuille peuvent être mêlées (on garde celle de la ligne).
// 2. « Ouverture de compte » : des lignes « CARTON 12 » / « CARTON AOVC 5 »
//    qui ouvrent chaque carton, puis « N° · Matricule (ou N° compte client) ·
//    Client · Note ».
// Rendent { fonds, lignes } ; fonds : 'non_retires' | 'ouverture_compte' | null.
// ============================================================================

const enTexte = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
const estEnTete = (cellules, re) => cellules.some((c) => re.test(cle(c)));

/** Colonnes d'une ligne d'en-tête « non retirés ». */
function colonnesNonRetires(cellules) {
  const titres = cellules.map((c) => cle(c));
  const i = (re) => titres.findIndex((t) => re.test(t));
  const denomination = i(/denomination|client|raison sociale/);
  if (denomination < 0 || i(/carton/) < 0) return null;
  return { rang: i(/^n$|^n\b|numero|^no$/), denomination, typologie: i(/typologie|type/), actes: i(/acte/), statut: i(/status|statut/), annee: i(/annee/), carton: i(/carton/) };
}

function lireNonRetires(classeur) {
  const lignes = [];
  for (const f of classeur.feuilles) {
    let col = null;
    for (const l of f.lignes) {
      const c = l.cellules;
      const entete = colonnesNonRetires(c);
      if (entete) { col = entete; continue; }
      if (!col) continue;
      const denomination = enTexte(c[col.denomination]);
      const actes = enTexte(c[col.actes]);
      if (!denomination && !actes) continue;
      if (/^(denomination|typologie|status)/i.test(cle(denomination))) continue;
      const annee = Number(c[col.annee]) || Number(/\b(19|20)\d{2}\b/.exec(f.nom)?.[0]) || null;
      lignes.push({
        serie: f.nom, rang: Number(c[col.rang]) || null, denomination, actes,
        typologie: col.typologie >= 0 ? enTexte(c[col.typologie]) : '', statut: col.statut >= 0 ? enTexte(c[col.statut]) : '',
        annee, carton: enTexte(c[col.carton]),
      });
    }
  }
  return lignes;
}

function lireOuvertures(classeur) {
  const lignes = [];
  for (const f of classeur.feuilles) {
    let col = null;
    let carton = '';
    for (const l of f.lignes) {
      const c = l.cellules;
      const texte = c.map(enTexte).filter(Boolean);
      // « CARTON 12 », « CARTON AOVC 5 » : un nouveau carton.
      const marque = texte.find((t) => /^carton\s+(aovc\s*)?\d+/i.test(t));
      if (marque && texte.length <= 2) { carton = marque; continue; }
      if (estEnTete(c, /^clients?$/) && estEnTete(c, /matricule|compte/)) {
        const titres = c.map((x) => cle(x));
        const i = (re) => titres.findIndex((t) => re.test(t));
        col = { rang: i(/^n$|^no$/), matricule: i(/matricule|compte/), client: i(/^clients?$/), note: i(/note|remarque/) };
        continue;
      }
      if (!col) continue;
      const client = enTexte(c[col.client]);
      const matricule = enTexte(c[col.matricule]);
      if (!client && !matricule) continue;
      lignes.push({
        serie: f.nom, carton, rang: Number(c[col.rang]) || null, denomination: client,
        matricule: matricule.replace(/\.0+$/, ''), note: col.note >= 0 ? enTexte(c[col.note]) : '',
      });
    }
  }
  return lignes;
}

/** Reconnaît le classeur et le lit. */
export function lireCartons(classeur) {
  const toutes = classeur.feuilles.flatMap((f) => f.lignes.slice(0, 40).map((l) => l.cellules));
  if (toutes.some((c) => colonnesNonRetires(c))) return { fonds: 'non_retires', lignes: lireNonRetires(classeur) };
  if (toutes.some((c) => estEnTete(c, /^clients?$/) && estEnTete(c, /matricule|compte/))) return { fonds: 'ouverture_compte', lignes: lireOuvertures(classeur) };
  return { fonds: null, lignes: [] };
}

export const FONDS = { non_retires: 'Dossiers non retirés / annulés', ouverture_compte: 'Ouvertures de compte' };
