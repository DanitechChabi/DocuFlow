// Ce qu'un lecteur reconnaît d'un document, quel que soit son degré
// d'indexation. Un document versé en masse porte « À indexer » dans ses
// trois références : les afficher telles quelles remplit l'écran de bruit.
const REPLI = 'À indexer';
const utile = (v) => (v && v !== REPLI ? String(v) : '');

/** Titre : la description, sinon « classe — entreprise », sinon le nom du fichier. */
export function titreDocument(d) {
  if (utile(d.description)) return d.description;
  const nature = d.classe_nom || d.type_document;
  if (utile(d.nom_entreprise)) return nature ? `${nature} — ${d.nom_entreprise}` : d.nom_entreprise;
  return d.fichier_nom || nature || 'Document sans titre';
}

/** Sous-titre : nature, entreprise, références — seulement ce qui est renseigné. */
export function detailDocument(d) {
  const nature = d.classe_nom || d.type_document;
  const refs = [utile(d.num_dossier), utile(d.num_acte)].filter(Boolean).join(' / ');
  return [
    utile(d.description) ? nature : null,
    utile(d.description) ? utile(d.nom_entreprise) : null,
    refs ? `n° ${refs}` : null,
    !utile(d.nom_entreprise) && !utile(d.description) && d.statut === 'à indexer' ? 'Références à compléter' : null,
  ].filter(Boolean).join(' · ');
}
