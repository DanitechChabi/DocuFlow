// ============================================================================
// Export Excel des registres et des listes (édition AFGC). Le classeur est
// fabriqué dans le navigateur, avec les données déjà affichées : rien de plus
// ne part au serveur. Les dates sont de vraies dates Excel (triables), au
// format JJ/MM/AAAA. La bibliothèque n'est chargée qu'au premier export.
// ============================================================================

/** « 2026-11-16 » ou un horodatage → date Excel (jour local), sinon chaîne vide. */
export function dateExcel(v) {
  if (!v) return '';
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m && s.length === 10) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Nom de feuille admis par Excel : 31 caractères, sans [ ] : * ? / \. */
const nomFeuille = (s) => String(s || 'Feuille').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Feuille';

/** Nom de fichier sûr, sans accents ni espaces. */
export function nomFichier(...parties) {
  return `${parties.filter(Boolean).join('-')}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    .toLowerCase();
}

/**
 * @param {string} fichier nom du fichier, sans extension
 * @param {{ nom: string, entetes: string[], lignes: any[][], largeurs?: number[] }[]} feuilles
 */
export async function exporterClasseur(fichier, feuilles) {
  const XLSX = await import('xlsx');
  const classeur = XLSX.utils.book_new();
  for (const f of feuilles) {
    const feuille = XLSX.utils.aoa_to_sheet([f.entetes, ...f.lignes], { dateNF: 'dd/mm/yyyy' });
    feuille['!cols'] = (f.largeurs || f.entetes.map(() => 16)).map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(classeur, feuille, nomFeuille(f.nom));
  }
  XLSX.writeFile(classeur, `${fichier}.xlsx`);
}
