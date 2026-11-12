// ============================================================================
// Lecture d'un classeur (Excel .xlsx ou .xls, LibreOffice .ods, CSV) dans le
// navigateur. Le fichier ne quitte pas le poste : seules les lignes que
// l'utilisateur décide d'importer sont envoyées au serveur.
//
// Les cellules gardent leur nature — un nombre reste un nombre, une date
// devient AAAA-MM-JJ — au lieu du texte affiché par le tableur, qui dépend de
// sa langue (« 1,250 » : mille deux cent cinquante, ou un et quart ?).
// La bibliothèque de lecture n'est chargée qu'au premier import.
// ============================================================================

export const LIGNES_MAX_AFFICHEES = 20;
const deux = (n) => String(n).padStart(2, '0');

/** Clé de comparaison d'un libellé : sans accents, sans casse, « N° » → « n ». */
export const cle = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/n[°º]/g, 'n ').replace(/[^a-z0-9]+/g, ' ').trim();

function valeurCellule(XLSX, cellule) {
  if (!cellule || cellule.v === undefined || cellule.v === null) return '';
  if (cellule.t === 'n') {
    if (cellule.z && XLSX.SSF.is_date(cellule.z)) {
      const d = XLSX.SSF.parse_date_code(cellule.v);
      if (d && d.y > 0) return `${d.y}-${deux(d.m)}-${deux(d.d)}`;
    }
    return cellule.v;
  }
  if (cellule.t === 'b') return Boolean(cellule.v);
  if (cellule.t === 'e') return '';
  return String(cellule.v).replace(/\s+/g, ' ').trim();
}

/** Un CSV enregistré par Excel n'est pas toujours en UTF-8 : repli sur l'encodage Windows. */
function decoderTexte(octets) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(octets); } catch { return new TextDecoder('windows-1252').decode(octets); }
}

/**
 * @param {File} fichier
 * @returns {Promise<{ nom: string, feuilles: Array<{ nom: string, lignes: Array<{ rang: number, cellules: any[] }> }> }>}
 *          `rang` est le numéro de la ligne dans le tableur.
 */
export async function lireClasseur(fichier) {
  const XLSX = await import('xlsx');
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const texte = /\.(csv|tsv|txt)$/i.test(fichier.name);
  const classeur = texte ? XLSX.read(decoderTexte(octets), { type: 'string', raw: true }) : XLSX.read(octets, { type: 'array', cellNF: true });
  const feuilles = classeur.SheetNames.map((nom) => {
    const feuille = classeur.Sheets[nom];
    if (!feuille || !feuille['!ref']) return { nom, lignes: [] };
    const zone = XLSX.utils.decode_range(feuille['!ref']);
    const lignes = [];
    for (let r = zone.s.r; r <= zone.e.r; r += 1) {
      const cellules = [];
      for (let c = zone.s.c; c <= zone.e.c; c += 1) cellules.push(valeurCellule(XLSX, feuille[XLSX.utils.encode_cell({ r, c })]));
      if (cellules.some((x) => x !== '')) lignes.push({ rang: r + 1, cellules });
    }
    return { nom, lignes };
  }).filter((f) => f.lignes.length);
  return { nom: fichier.name, feuilles };
}

/**
 * Ligne des titres : la première, parmi les vingt premières, qui soit presque
 * aussi garnie que la plus garnie et faite de texte. Un classeur commence
 * souvent par un grand titre ou une date : ce ne sont pas des en-têtes.
 */
export function trouverTitres(lignes) {
  const debut = lignes.slice(0, LIGNES_MAX_AFFICHEES);
  const garnies = debut.map((l) => l.cellules.filter((x) => x !== '').length);
  const seuil = Math.max(2, Math.ceil(Math.max(0, ...garnies) * 0.6));
  const i = debut.findIndex((l, k) => garnies[k] >= seuil && l.cellules.filter((x) => typeof x === 'string' && x !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(x)).length >= garnies[k] * 0.6);
  return i < 0 ? 0 : i;
}

const lettre = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** Colonnes du classeur d'après sa ligne de titres, avec leurs premières valeurs et le type qu'elles suggèrent. */
export function decrireColonnes(lignes, indexTitres) {
  const titres = lignes[indexTitres]?.cellules || [];
  const donnees = lignes.slice(indexTitres + 1);
  const largeur = Math.max(titres.length, ...donnees.slice(0, 200).map((l) => l.cellules.length), 0);
  const colonnes = [];
  for (let c = 0; c < largeur; c += 1) {
    const valeurs = donnees.map((l) => l.cellules[c]).filter((x) => x !== '' && x !== undefined);
    if (!valeurs.length && (titres[c] === '' || titres[c] === undefined)) continue;
    const echantillon = valeurs.slice(0, 300);
    const tous = (test) => echantillon.length > 0 && echantillon.every(test);
    const type = tous((x) => typeof x === 'boolean' || ['oui', 'non'].includes(cle(x))) ? 'boolean'
      : tous((x) => typeof x === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(x) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(x))) ? 'date'
        // Un identifiant long (IFU, téléphone, compte) n'est pas une quantité : il reste du texte.
        : tous((x) => typeof x === 'number' && Math.abs(x) < 1e11) ? 'number' : 'text';
    const sansTitre = titres[c] === '' || titres[c] === undefined;
    colonnes.push({
      index: c, titre: sansTitre ? `Colonne ${lettre(c)}` : String(titres[c]), sansTitre, type, remplies: valeurs.length,
      exemples: [...new Set(valeurs.map(afficher))].slice(0, 3),
    });
  }
  return colonnes;
}

/** Une cellule telle qu'on la montre : date à la française, nombre groupé. */
export function afficher(v) {
  if (v === true) return 'Oui';
  if (v === false) return 'Non';
  // Une année ou un identifiant ne se groupe pas par milliers : « 2 021 » ou « 3 201 900 000 001 » tromperaient.
  if (typeof v === 'number') return v.toLocaleString('fr-FR', { maximumFractionDigits: 6, useGrouping: Math.abs(v) >= 10000 && Math.abs(v) < 1e11 });
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  return d ? `${d[3]}/${d[2]}/${d[1]}` : String(v);
}
