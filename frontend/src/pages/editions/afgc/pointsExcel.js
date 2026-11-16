import { cle } from '../../../utils/classeur';

// ============================================================================
// Lecture d'un « point des dossiers retirés » (classeur Excel de l'AFGC).
//
// Une journée après l'autre : une ligne de DATE, l'en-tête (N° d'ordre, N°
// actes, Dénomination, Type de garantie, Montant engagement, Commissions HT et
// TTC, Observations = l'agent), les dossiers, des sous-totaux, puis la rubrique
// « Attestations / opérations banalisées » et ses dossiers. Les sous-totaux et
// les en-têtes répétés sont ignorés ; les autres feuilles (frais de dossiers
// non retirés…) aussi, faute d'en-tête « N° d'ordre ».
// ============================================================================

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAR_DEFAUT = { ordre: 0, actes: 1, denomination: 2, type: 3, montant: 4, ht: 5, ttc: 6, agent: 7 };
const RUBRIQUE_CAUTIONS = 'Cautions et garanties';

/** Colonnes d'après une ligne d'en-tête ; les titres absents gardent leur place habituelle. */
function colonnesDe(cellules) {
  const titres = cellules.map((c) => cle(c));
  const trouve = (re) => titres.findIndex((t) => re.test(t));
  const ordre = trouve(/ordre/);
  if (ordre < 0) return null;
  const pos = (re, decalage) => { const i = trouve(re); return i >= 0 ? i : ordre + decalage; };
  return {
    ordre,
    actes: pos(/acte/, 1),
    denomination: pos(/denomination|client|sociale|raison/, 2),
    type: pos(/type/, 3),
    montant: pos(/montant/, 4),
    ht: pos(/\bht\b/, 5),
    ttc: pos(/ttc/, 6),
    agent: pos(/observ|agent/, 7),
  };
}

const enTexte = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * @param {{ nom: string, feuilles: Array<{ nom: string, lignes: Array<{ cellules: any[] }> }> }} classeur
 * @returns {{ lignes: object[], jours: string[], feuillesLues: string[] }}
 */
export function lirePoint(classeur) {
  const lignes = [];
  const jours = new Set();
  const feuillesLues = [];
  for (const feuille of classeur.feuilles) {
    // Une feuille de points a un en-tête « N° d'ordre ».
    if (!feuille.lignes.some((l) => colonnesDe(l.cellules))) continue;
    feuillesLues.push(feuille.nom);
    let col = PAR_DEFAUT;
    let date = null;
    let rubrique = RUBRIQUE_CAUTIONS;
    for (const { cellules } of feuille.lignes) {
      const remplies = cellules.filter((c) => c !== '' && c !== null && c !== undefined);
      // Ligne de date : la journée change, on repart sur les cautions.
      const dateSeule = remplies.length <= 2 && remplies.find((c) => DATE.test(String(c)));
      if (dateSeule) { date = String(dateSeule); jours.add(date); rubrique = RUBRIQUE_CAUTIONS; continue; }
      const entete = colonnesDe(cellules);
      if (entete) { col = entete; continue; }
      const textes = remplies.filter((c) => typeof c === 'string').map((c) => cle(c));
      if (textes.some((t) => /attestation/.test(t) && /banalise/.test(t))) { rubrique = 'Attestations / opérations banalisées'; continue; }
      if (!date) continue;
      const v = (k) => cellules[col[k]];
      const denomination = enTexte(v('denomination'));
      const actes = enTexte(v('actes'));
      const ordre = v('ordre');
      // Sous-totaux et lignes vides : ni nom ni acte.
      if (!denomination && !actes) continue;
      if (typeof ordre !== 'number' && !/^\d+$/.test(enTexte(ordre))) continue;
      lignes.push({
        date,
        rubrique,
        ordre: Number(ordre),
        actes,
        denomination,
        type: enTexte(v('type')),
        montant: typeof v('montant') === 'number' ? v('montant') : null,
        ht: typeof v('ht') === 'number' ? v('ht') : null,
        ttc: typeof v('ttc') === 'number' ? v('ttc') : null,
        agent: enTexte(v('agent')),
      });
    }
  }
  return { lignes, jours: [...jours].sort(), feuillesLues };
}
