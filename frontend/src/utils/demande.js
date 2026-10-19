/**
 * Libellé court d'une demande — miroir de helpers/requestInput.libelleDemande
 * côté serveur. Une demande rapide (migration 023) peut n'avoir ni entreprise
 * ni numéro : l'écran affiche alors sa description plutôt qu'un titre vide.
 */
export const libelleDemande = (r = {}) => {
  const t = (v) => (v === null || v === undefined ? '' : String(v).trim());
  if (t(r.nom_entreprise)) return t(r.nom_entreprise);
  const desc = t(r.description);
  if (desc) return desc.length > 60 ? `${desc.slice(0, 57)}…` : desc;
  if (t(r.num_dossier)) return `Dossier ${t(r.num_dossier)}`;
  return r.id ? `Demande n° ${r.id}` : 'Demande';
};

/** La demande porte-t-elle au moins une référence documentaire ? */
export const aDesReferences = (r = {}) => Boolean(r.num_dossier || r.num_acte || r.annee);

/**
 * Valeurs de départ pour « Redemander » : ce que le demandeur a saisi, sans ce
 * qui appartient au traitement (statut, assignation, notes internes, dates).
 */
export const valeursPourRedemander = (r = {}) => ({
  description: r.description || '',
  nom_entreprise: r.nom_entreprise || '',
  num_dossier: r.num_dossier || '',
  num_acte: r.num_acte || '',
  annee: r.annee || '',
  type_document: r.type_document || '',
  motif: r.motif || '',
  priorite: r.priorite || '',
  beneficiaire: r.beneficiaire || '',
  source_request_id: r.id,
});
