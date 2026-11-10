// ============================================================================
// absenceService — absence et suppléance (migration 042).
//
// Pendant l'absence déclarée d'une personne, ce qui lui serait confié (tâche
// de validation, courrier) va à son suppléant, « pour le compte de » l'absent.
// La chaîne est suivie (le suppléant peut être absent lui aussi) sur trois
// maillons au plus et sans boucle ; au-delà, la personne d'origine garde la
// charge : mieux vaut une tâche qui attend qu'une tâche perdue.
// ============================================================================
const db = require('../config/db');

function erreur(status, message) { return Object.assign(new Error(message), { status }); }
const jour = (v) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};
const aujourdhui = () => new Date().toISOString().slice(0, 10);

const SELECT = `SELECT a.user_id, to_char(a.du, 'YYYY-MM-DD') AS du, to_char(a.au, 'YYYY-MM-DD') AS au, a.suppleant_id, a.motif,
    COALESCE(s.full_name, s.username) AS suppleant_nom, COALESCE(u.full_name, u.username) AS nom
  FROM absences a JOIN users s ON s.id = a.suppleant_id JOIN users u ON u.id = a.user_id`;

const vers = (a, ref = aujourdhui()) => (a ? { ...a, en_cours: a.du <= ref && ref <= a.au, a_venir: a.du > ref } : null);

/** Absence en cours ou à venir d'une personne (null sinon). */
async function etat(tenantId, userId) {
  try {
    const a = (await db.query(`${SELECT} WHERE a.user_id = $1 AND a.tenant_id = $2 AND a.au >= CURRENT_DATE`, [userId, tenantId])).rows[0];
    return vers(a);
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

/** Collègues pouvant suppléer (tous les comptes de l'organisation, sauf soi). */
async function collegues(tenantId, userId) {
  return (await db.query(
    `SELECT id, COALESCE(full_name, username) AS full_name, section FROM users
      WHERE tenant_id = $1 AND id <> $2 AND username NOT LIKE 'portail-citoyen-%' ORDER BY full_name`, [tenantId, userId])).rows;
}

/** Déclare (ou remplace) l'absence de `userId`. */
async function definir(tenantId, userId, { du, au, suppleant_id: suppleant, motif } = {}, par = null) {
  const d = jour(du);
  const f = jour(au);
  if (!d || !f) throw erreur(400, "Indiquez les dates de début et de fin de l'absence.");
  if (f < d) throw erreur(400, 'La date de fin précède la date de début.');
  if (f < aujourdhui()) throw erreur(400, "Cette absence est déjà terminée.");
  const s = Number(suppleant);
  if (!Number.isInteger(s) || s <= 0) throw erreur(400, 'Choisissez votre suppléant.');
  if (s === Number(userId)) throw erreur(400, 'Vous ne pouvez pas être votre propre suppléant.');
  if (!(await collegues(tenantId, userId)).some((c) => c.id === s)) throw erreur(400, 'Suppléant introuvable dans votre organisation.');
  // Pas de boucle directe : A absent → B, B absent → A sur des périodes qui se recoupent.
  const croise = (await db.query(
    'SELECT 1 FROM absences WHERE user_id = $1 AND suppleant_id = $2 AND du <= $4 AND au >= $3', [s, userId, d, f])).rows[0];
  if (croise) throw erreur(409, 'Cette personne vous a désigné comme suppléant sur la même période : choisissez quelqu\'un d\'autre.');
  await db.query(
    `INSERT INTO absences (user_id, tenant_id, du, au, suppleant_id, motif, declare_par) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id) DO UPDATE SET du = EXCLUDED.du, au = EXCLUDED.au, suppleant_id = EXCLUDED.suppleant_id,
       motif = EXCLUDED.motif, declare_par = EXCLUDED.declare_par, created_at = now()`,
    [userId, tenantId, d, f, s, String(motif || '').trim().slice(0, 200) || null, par]);
  return etat(tenantId, userId);
}

async function lever(tenantId, userId) {
  await db.query('DELETE FROM absences WHERE user_id = $1 AND tenant_id = $2', [userId, tenantId]);
  return null;
}

/**
 * Qui reçoit ce qui est destiné à `userId` aujourd'hui ? Rend
 * { id, nom, pour_le_compte_de, jusqu_au } si un suppléant prend le relais,
 * null si la personne est présente (ou la chaîne sans issue).
 * `run` : client de transaction ou db.
 */
async function suppleant(run, tenantId, userId) {
  let courant = Number(userId);
  let premier = null;
  const vus = new Set([courant]);
  try {
    for (let i = 0; i < 3; i += 1) {
      const a = (await run.query(
        `${SELECT} WHERE a.user_id = $1 AND a.tenant_id = $2 AND a.du <= CURRENT_DATE AND a.au >= CURRENT_DATE`, [courant, tenantId])).rows[0];
      if (!a) break;
      if (vus.has(a.suppleant_id)) return null; // boucle : on ne redirige pas
      if (!premier) premier = a;
      vus.add(a.suppleant_id);
      courant = a.suppleant_id;
      if (i === 2) {
        // Troisième maillon encore absent : chaîne sans issue.
        const encore = (await run.query('SELECT 1 FROM absences WHERE user_id = $1 AND du <= CURRENT_DATE AND au >= CURRENT_DATE', [courant])).rows[0];
        if (encore) return null;
      }
    }
  } catch (err) {
    if (err.code === '42P01') return null; // migration 042 absente
    throw err;
  }
  if (!premier || courant === Number(userId)) return null;
  const nom = (await run.query('SELECT COALESCE(full_name, username) AS nom FROM users WHERE id = $1', [courant])).rows[0]?.nom;
  return { id: courant, nom, pour_le_compte_de: premier.nom, jusqu_au: premier.au };
}

module.exports = { etat, collegues, definir, lever, suppleant };
