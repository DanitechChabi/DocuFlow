// ============================================================================
// onboardingService — progression de la prise en main (migration 026).
//
// Ce qui est mémorisé : les visites guidées vues (par module) et les conseils
// contextuels déjà lus. Rien de sensible, mais une colonne JSONB écrite par le
// client se borne : clés connues, identifiants courts, liste plafonnée.
// ============================================================================
const db = require('../config/db');

const VISITES = ['accueil', 'demandes', 'documents'];
const CONSEIL = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_CONSEILS = 50;

function erreur(statut, message) {
  const e = new Error(message);
  e.statut = statut;
  return e;
}

/** Valide une action. Fonction pure. */
function lireAction(body = {}) {
  const { visite, conseil, action } = body;
  if (visite !== undefined) {
    if (!VISITES.includes(visite)) throw erreur(400, `Visite inconnue : ${visite} (attendu : ${VISITES.join(', ')}).`);
    if (!['vue', 'revoir'].includes(action)) throw erreur(400, 'Action attendue : « vue » ou « revoir ».');
    return { type: 'visite', cle: visite, action };
  }
  if (conseil !== undefined) {
    if (typeof conseil !== 'string' || !CONSEIL.test(conseil)) throw erreur(400, 'Identifiant de conseil invalide.');
    return { type: 'conseil', cle: conseil };
  }
  throw erreur(400, 'Rien à enregistrer : « visite » ou « conseil » attendu.');
}

/** Forme normalisée, quel que soit le contenu en base. Fonction pure. */
function normaliser(brut) {
  const o = brut && typeof brut === 'object' ? brut : {};
  const tours = o.tours && typeof o.tours === 'object' ? o.tours : {};
  return {
    tours: Object.fromEntries(Object.entries(tours).filter(([k]) => VISITES.includes(k))),
    conseils: Array.isArray(o.conseils) ? o.conseils.filter((c) => typeof c === 'string' && CONSEIL.test(c)) : [],
  };
}

/** Progression d'un utilisateur ; null si la migration 026 n'est pas passée. */
async function lire(tenantId, userId) {
  try {
    const r = await db.query('SELECT onboarding FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
    return r.rows[0] ? normaliser(r.rows[0].onboarding) : null;
  } catch (err) {
    if (err.code === '42703') return null;
    throw err;
  }
}

/** Enregistre une action ; renvoie la progression à jour. */
async function enregistrer(tenantId, userId, body) {
  const a = lireAction(body);
  let sql;
  let params;
  if (a.type === 'visite' && a.action === 'vue') {
    sql = `UPDATE users SET onboarding = onboarding || jsonb_build_object('tours',
             COALESCE(onboarding->'tours', '{}'::jsonb) || jsonb_build_object($3::text, to_jsonb(now())))
           WHERE id = $1 AND tenant_id = $2 RETURNING onboarding`;
    params = [userId, tenantId, a.cle];
  } else if (a.type === 'visite') {
    sql = `UPDATE users SET onboarding = onboarding || jsonb_build_object('tours',
             COALESCE(onboarding->'tours', '{}'::jsonb) - $3::text)
           WHERE id = $1 AND tenant_id = $2 RETURNING onboarding`;
    params = [userId, tenantId, a.cle];
  } else {
    // Ajout sans doublon ; au-delà du plafond, plus rien n'est ajouté (il n'y
    // a qu'une poignée de conseils : le plafond ne borne qu'un client abusif).
    sql = `UPDATE users SET onboarding = CASE
             WHEN COALESCE(onboarding->'conseils', '[]'::jsonb) ? $3::text
               OR jsonb_array_length(COALESCE(onboarding->'conseils', '[]'::jsonb)) >= ${MAX_CONSEILS}
             THEN onboarding
             ELSE onboarding || jsonb_build_object('conseils', COALESCE(onboarding->'conseils', '[]'::jsonb) || to_jsonb($3::text))
           END
           WHERE id = $1 AND tenant_id = $2 RETURNING onboarding`;
    params = [userId, tenantId, a.cle];
  }
  try {
    const r = await db.query(sql, params);
    if (!r.rows[0]) throw erreur(404, 'Utilisateur introuvable.');
    return normaliser(r.rows[0].onboarding);
  } catch (err) {
    if (err.code === '42703') throw erreur(503, 'La progression ne peut pas encore être enregistrée (migration 026 à appliquer).');
    throw err;
  }
}

module.exports = { VISITES, lireAction, normaliser, lire, enregistrer };
