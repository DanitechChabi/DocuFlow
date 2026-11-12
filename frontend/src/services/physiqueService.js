import api from './api';

/** Archives papier (migration 038) : emplacements, localisation, récolement. */
export const physiqueService = {
  emplacements: async () => (await api.get('/archives/emplacements')).data,
  creer: async (corps) => (await api.post('/archives/emplacements', corps)).data,
  modifier: async (id, corps) => (await api.patch(`/archives/emplacements/${id}`, corps)).data,
  supprimer: async (id) => (await api.delete(`/archives/emplacements/${id}`)).data,
  contenu: async (id) => (await api.get(`/archives/emplacements/${id}/documents`)).data,
  // Description des boîtes et répertoire (043).
  suggestions: async () => (await api.get('/archives/emplacements/suggestions')).data,
  repertoire: async (id) => (await api.get(`/archives/emplacements/${id}/repertoire`)).data,
  // Saisie en tableau des dossiers papier : la grille, puis l'enregistrement du lot.
  modeleSaisie: async () => (await api.get('/archives/saisie/modele')).data,
  saisir: async (corps) => (await api.post('/archives/saisie', corps)).data,
  // Import d'un classeur : tout vérifier sans rien créer ; créer une classe d'après ses colonnes.
  verifierSaisie: async (corps) => (await api.post('/archives/saisie/verification', corps)).data,
  creerClasseSaisie: async (corps) => (await api.post('/archives/saisie/classes', corps)).data,
  // Référentiel (046) : classe dont les fiches aident à indexer ; valeurs déjà connues d'un champ.
  definirReferentiel: async (classeId, actif) => (await api.put(`/archives/saisie/classes/${classeId}/referentiel`, { actif })).data,
  valeursConnues: async (critere) => (await api.get('/archives/referentiel/valeurs', { params: critere })).data,
  localisation: async (documentId) => (await api.get(`/documents/${documentId}/localisation`)).data,
  placer: async (documentId, corps) => (await api.put(`/documents/${documentId}/localisation`, corps)).data,
  recolements: async () => (await api.get('/archives/recolements')).data,
  ouvrir: async (corps) => (await api.post('/archives/recolements', corps)).data,
  recolement: async (id) => (await api.get(`/archives/recolements/${id}`)).data,
  constater: async (id, constats) => (await api.post(`/archives/recolements/${id}/constats`, { constats })).data,
  clore: async (id, observations) => (await api.post(`/archives/recolements/${id}/cloture`, { observations })).data,
  pv: async (id) => (await api.get(`/archives/recolements/${id}/pv`)).data,
};

export const TYPES_EMPLACEMENT = { depot: 'Dépôt', magasin: 'Magasin', travee: 'Travée', tablette: 'Tablette', boite: 'Boîte' };
export const ENFANT_DE = { depot: 'magasin', magasin: 'travee', travee: 'tablette', tablette: 'boite' };
export const SUPPORTS = { numerique: 'Numérique', papier: 'Papier', hybride: 'Hybride (papier et numérique)' };
export const RESULTATS = {
  present: ['Présent', 'bg-emerald-50 text-emerald-700'], absent: ['Absent', 'bg-red-50 text-red-700'],
  deplace: ['Déplacé', 'bg-amber-50 text-amber-700'], abime: ['Abîmé', 'bg-orange-50 text-orange-700'],
  en_pret: ['En prêt', 'bg-blue-50 text-blue-700'],
};
export const NATURES_PRET = { original: "Original", copie: 'Copie', consultation: 'Consultation sur place' };
// Couleur de l'étiquette collée au dos de la boîte : [libellé, teinte].
export const COULEURS = {
  blanc: ['Blanc', '#ffffff'], jaune: ['Jaune', '#facc15'], vert: ['Vert', '#22c55e'], bleu: ['Bleu', '#3b82f6'], rouge: ['Rouge', '#ef4444'],
  rose: ['Rose', '#f472b6'], orange: ['Orange', '#fb923c'], violet: ['Violet', '#a78bfa'], gris: ['Gris', '#94a3b8'],
};
