// ============================================================================
// alerteFabrique — forme commune des alertes de conformité.
//
// Séparée de conformiteService pour que le contrôle au registre officiel
// puisse produire ses alertes sans dépendance circulaire.
// L'EMPREINTE est l'identité stable d'une alerte : type, documents concernés,
// champ et valeurs. C'est ce qui permet de retrouver, au recalcul suivant,
// l'alerte qu'un humain a déjà traitée.
// ============================================================================
const crypto = require('crypto');
const { normaliser } = require('./indexSuggestionService');

/** Nom comparable : sans accents, casse ni ponctuation. */
const cleNom = (v) => normaliser(String(v || '')).replace(/[^a-z0-9]+/g, ' ').trim();

function empreinte(type, ids, champ, a, b) {
  const base = [type, [...ids].sort((x, y) => x - y).join(','), champ || '', a ?? '', b ?? ''].join('|');
  return crypto.createHash('sha1').update(base).digest('hex');
}

function alerte(type, severite, description, ids, champ, a, b, suggestion) {
  return {
    type, severite, description, documentIds: ids, champ: champ || null,
    valeurA: a === undefined || a === null ? null : String(a),
    valeurB: b === undefined || b === null ? null : String(b),
    suggestion: suggestion || null,
    empreinte: empreinte(type, ids, champ, a, b),
  };
}

module.exports = { alerte, empreinte, cleNom };
