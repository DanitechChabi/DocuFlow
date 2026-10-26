// ============================================================================
// jsonLlm — retrouver un objet JSON dans la réponse d'un modèle de langage.
//
// Un modèle répond rarement par du JSON nu : il l'entoure d'une phrase
// (« Voici les données : { … } »), d'un bloc ```json, ou ajoute un commentaire
// après. Trois essais, du plus strict au plus tolérant : la réponse entière,
// un bloc de code, puis le premier objet équilibré du texte (qui tient compte
// des accolades à l'intérieur des chaînes).
// ============================================================================

const BLOC_CODE = /```(?:json)?\s*([\s\S]*?)\s*```/gi;

function essayer(charge) {
  try {
    const v = JSON.parse(charge);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function premierObjetEquilibre(texte) {
  let debut = texte.indexOf('{');
  while (debut !== -1) {
    let profondeur = 0;
    let dansChaine = false;
    let echappe = false;
    for (let i = debut; i < texte.length; i += 1) {
      const c = texte[i];
      if (dansChaine) {
        if (echappe) echappe = false;
        else if (c === '\\') echappe = true;
        else if (c === '"') dansChaine = false;
        continue;
      }
      if (c === '"') dansChaine = true;
      else if (c === '{') profondeur += 1;
      else if (c === '}') {
        profondeur -= 1;
        if (profondeur === 0) return texte.slice(debut, i + 1);
      }
    }
    debut = texte.indexOf('{', debut + 1);
  }
  return null;
}

/** @returns {object|null} */
function extraireObjetJson(brut) {
  if (!brut || typeof brut !== 'string') return null;
  const texte = brut.trim();
  const direct = essayer(texte);
  if (direct) return direct;
  for (const m of texte.matchAll(BLOC_CODE)) {
    const v = essayer(m[1].trim());
    if (v) return v;
  }
  const candidat = premierObjetEquilibre(texte);
  return candidat ? essayer(candidat) : null;
}

/** Aperçu court d'une réponse, pour les journaux. */
function apercuReponse(brut, max = 240) {
  if (!brut) return '<vide>';
  const compact = String(brut).trim().split(/\s+/).join(' ');
  return compact.length <= max ? compact : `${compact.slice(0, max - 3)}...`;
}

module.exports = { extraireObjetJson, apercuReponse };
