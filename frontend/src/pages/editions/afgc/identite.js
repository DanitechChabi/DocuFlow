// Petits outils de la page d'inscription de l'AFGC.

export const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** « DE — Engagement » → { sigle: 'DE', intitule: 'Engagement' } ; sans sigle, l'intitulé seul. */
export const decouper = (nom) => {
  const m = String(nom).match(/^(\S{2,10})\s+[—–-]\s+(.+)$/);
  return m ? { sigle: m[1], intitule: m[2] } : { sigle: null, intitule: nom };
};

/**
 * Prénom d'un nom complet, pour saluer : « Éric Kpadonou » → « Éric » ;
 * « HOUNGBO Fifamè » → « Fifamè » (le nom de famille écrit en capitales).
 */
export function prenomDe(nomComplet) {
  const mots = String(nomComplet || '').trim().split(/\s+/).filter(Boolean);
  const capitales = (m) => m.length > 1 && m === m.toUpperCase() && /[A-Z]/.test(sansAccents(m));
  const mot = mots.find((m) => !capitales(m)) || mots[0] || '';
  return capitales(mot) ? mot.charAt(0) + mot.slice(1).toLowerCase() : mot;
}

/**
 * Identifiant proposé d'après le nom : « Éric Kpadonou » ou « KPADONOU Éric »
 * → « e.kpadonou ». Le nom écrit en capitales est pris pour le nom de famille.
 */
export function identifiantPropose(nomComplet) {
  const mots = String(nomComplet || '').trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return '';
  const propre = (m) => sansAccents(m).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const iCapitales = mots.findIndex((m) => m.length > 1 && m === m.toUpperCase() && /[A-Z]/.test(sansAccents(m)));
  const iNom = iCapitales >= 0 ? iCapitales : mots.length - 1;
  const prenom = mots.find((_, i) => i !== iNom);
  const nom = propre(mots[iNom]);
  return prenom ? `${propre(prenom).charAt(0)}.${nom}` : nom;
}
