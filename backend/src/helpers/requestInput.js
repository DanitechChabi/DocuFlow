// ============================================================================
// requestInput — lecture et contrôle de la saisie d'une demande.
//
// Fonctions pures (aucun accès base) : ce qui décide qu'une demande est
// recevable est éprouvé sans PostgreSQL (requests.test.js), et le contrôleur
// n'a plus qu'à insérer ce qu'on lui rend.
//
// LA RÈGLE DE RECEVABILITÉ (migration 023)
//
// Une demande doit être IDENTIFIABLE : une description en langage courant
// (« le contrat de bail du local de Cotonou ») OU au moins une référence
// (entreprise, n° de dossier, n° d'acte). Exiger les quatre références,
// comme avant, réservait la demande à qui connaissait déjà le classement.
// ============================================================================

const LIMITES = {
  nom_entreprise: 255,
  num_dossier: 50,
  num_acte: 50,
  beneficiaire: 255,
  description: 5000,
};

const texte = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Date du jour au format AAAA-MM-JJ (fuseau du serveur). */
function aujourdhui(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Normalise et valide la saisie.
 *
 * @param {object} body corps de la requête
 * @param {object} [opts] { now } — injectable pour les tests
 * @returns {{ values: object, errors: string[], mode: 'rapide'|'complet' }}
 */
function lireSaisie(body = {}, { now = new Date() } = {}) {
  const errors = [];
  const values = {};

  for (const [champ, max] of Object.entries(LIMITES)) {
    const v = texte(body[champ]);
    if (v && v.length > max) {
      errors.push(`Le champ « ${champ} » dépasse ${max} caractères.`);
    }
    values[champ] = v;
  }

  // Année : facultative, mais un entier plausible si elle est donnée.
  const anneeBrute = texte(body.annee);
  if (anneeBrute === null) {
    values.annee = null;
  } else if (!/^\d{4}$/.test(anneeBrute) || Number(anneeBrute) < 1900 || Number(anneeBrute) > 2100) {
    errors.push(`Année invalide : « ${anneeBrute} » (attendu : entre 1900 et 2100).`);
  } else {
    values.annee = Number(anneeBrute);
  }

  // Date souhaitée : AAAA-MM-JJ réelle, et pas dans le passé — une échéance
  // déjà dépassée à la création ferait passer la demande en retard d'emblée.
  const dateBrute = texte(body.date_souhaitee);
  values.date_souhaitee = null;
  if (dateBrute !== null) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateBrute);
    const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const reelle = d && d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
    if (!reelle) {
      errors.push(`Date souhaitée invalide : « ${dateBrute} » (attendu : AAAA-MM-JJ).`);
    } else if (dateBrute < aujourdhui(now)) {
      errors.push('La date souhaitée ne peut pas être déjà passée.');
    } else {
      values.date_souhaitee = dateBrute;
    }
  }

  // Reprise d'une demande antérieure (« Redemander »).
  const source = texte(body.source_request_id);
  values.source_request_id = null;
  if (source !== null) {
    if (!/^\d+$/.test(source)) errors.push('Demande d\'origine invalide.');
    else values.source_request_id = Number(source);
  }

  const identifiable = values.description || values.nom_entreprise || values.num_dossier || values.num_acte;
  if (!identifiable) {
    errors.push('Décrivez le document recherché, ou indiquez au moins une référence (entreprise, n° de dossier ou n° d\'acte).');
  }

  return { values, errors, mode: body.mode === 'rapide' ? 'rapide' : 'complet' };
}

/**
 * Libellé court d'une demande, pour les notifications et les e-mails.
 *
 * Une demande rapide n'a pas forcément de nom d'entreprise : les messages
 * « demande pour l'entreprise null » qu'aurait produits l'ancien code sont
 * remplacés par la première référence disponible.
 */
function libelleDemande(r = {}) {
  const nom = texte(r.nom_entreprise);
  if (nom) return nom;
  const desc = texte(r.description);
  if (desc) return desc.length > 60 ? `${desc.slice(0, 57)}…` : desc;
  const dossier = texte(r.num_dossier);
  if (dossier) return `dossier ${dossier}`;
  return r.id ? `n° ${r.id}` : 'sans titre';
}

module.exports = { LIMITES, lireSaisie, libelleDemande, aujourdhui };
