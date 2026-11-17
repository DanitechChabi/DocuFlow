// Noms d'entreprise simplifiés, pour comparer « Ets Agro-Fictive SARL » et
// « agro fictive ». Partagé par l'entrée des dossiers et l'index des noms.

// Même expression que l'index de la migration 050.
const NOM_SIMPLE = "trim(regexp_replace(translate(lower(denomination), 'àáâäãéèêëíîïóôöõúùûüçñ', 'aaaaaeeeeiiioooouuuucn'), '[^a-z0-9]+', ' ', 'g'))";
const FORMES = new Set(['sarl', 'sa', 'sas', 'sasu', 'suarl', 'sarlu', 'ets', 'etablissement', 'etablissements', 'ste', 'societe', 'sci', 'gie', 'scs', 'snc', 'ong', 'cie']);

/** Nom simplifié comme en base, sans forme juridique : « Ets Agro-Fictive SARL » → « agro fictive ». */
function nomSimple(nom) {
  const s = String(nom ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const coeur = s.split(' ').filter((m) => m && !FORMES.has(m)).join(' ');
  return coeur.length >= 2 ? coeur : s;
}

module.exports = { NOM_SIMPLE, FORMES, nomSimple };
