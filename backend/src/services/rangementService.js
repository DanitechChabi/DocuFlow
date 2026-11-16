// ============================================================================
// rangementService — le plan de rangement des dossiers entrés (052).
//
// À l'archive de l'AFGC, les dossiers d'une semaine de production (vendredi →
// jeudi), classés par lettre, se suivent d'armoire en armoire : l'armoire 3
// va du 7 au 13 février (lettre C) au 21 au 27 février (lettre S), l'armoire
// 4 reprend à S (« S' ») … Chaque armoire couvre donc une plage continue
// (semaine, lettre) → (semaine, lettre). Une lettre partagée entre deux
// armoires figure aux deux bornes : le dossier est dans l'une ou l'autre.
// ============================================================================
const db = require('../config/db');
const { EDITIONS } = require('../config/editions');

function erreur(statut, message) {
  const e = new Error(message);
  e.statut = statut;
  return e;
}

const texte = (v, max) => {
  const s = v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** Vendredi qui ouvre la semaine de production d'une date (AAAA-MM-JJ), ou null. */
function vendredi(dateIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateIso || '').slice(0, 10));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 5 + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/** Lettre de borne : A à Z, « # » (noms commençant par un chiffre), ou null (début / fin de semaine). */
function lettre(v) {
  const s = String(v ?? '').trim().toUpperCase().replace(/['’]/g, '');
  if (!s) return null;
  if (!/^[A-Z#]$/.test(s)) throw erreur(400, `Lettre invalide : « ${v} » (une lettre de A à Z).`);
  return s;
}

/**
 * Expression SQL : les armoires d'un dossier entré (alias `d`), « Armoire 3 »
 * ou « Armoire 3 ou Armoire 4 » pour une lettre partagée. Comparaison en
 * collation C : « # » < A … Z < « ~ » (un nom sans lettre va en fin de semaine).
 */
const ARMOIRE_SQL = (alias = 'd') => `(
  SELECT string_agg(r.nom || COALESCE(' · ' || r.lieu, ''), ' ou ' ORDER BY r.ordre, r.debut_semaine)
    FROM rangements r
   WHERE r.tenant_id = ${alias}.tenant_id
     AND (${alias}.semaine, COALESCE(${alias}.lettre, '~') COLLATE "C") >= (r.debut_semaine, COALESCE(r.debut_lettre, '#') COLLATE "C")
     AND (${alias}.semaine, COALESCE(${alias}.lettre, '~') COLLATE "C") <= (r.fin_semaine, COALESCE(r.fin_lettre, '~') COLLATE "C")
)`;

const COLONNES = `id, nom, lieu, ordre, to_char(debut_semaine, 'YYYY-MM-DD') AS debut_semaine, debut_lettre,
  to_char(fin_semaine, 'YYYY-MM-DD') AS fin_semaine, fin_lettre`;

async function lister(tenantId) {
  try {
    const r = await db.query(`SELECT ${COLONNES} FROM rangements WHERE tenant_id = $1 ORDER BY debut_semaine, COALESCE(debut_lettre, '#') COLLATE "C", ordre, id`, [tenantId]);
    return r.rows;
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

function lire(corps = {}) {
  const nom = texte(corps.nom, 60);
  if (!nom) throw erreur(400, 'Donnez un nom à l\'armoire (ex. « Armoire 3 »).');
  const debut = vendredi(corps.debut_semaine);
  const fin = vendredi(corps.fin_semaine);
  if (!debut || !fin) throw erreur(400, 'Indiquez la première et la dernière semaine rangées dans cette armoire.');
  const v = {
    nom, lieu: texte(corps.lieu, 120), ordre: Number.isInteger(Number(corps.ordre)) ? Number(corps.ordre) : 0,
    debut_semaine: debut, debut_lettre: lettre(corps.debut_lettre), fin_semaine: fin, fin_lettre: lettre(corps.fin_lettre),
  };
  const a = `${v.debut_semaine}${v.debut_lettre || '#'}`;
  const b = `${v.fin_semaine}${v.fin_lettre || '~'}`;
  if (a > b) throw erreur(400, 'La fin de l\'armoire précède son début.');
  return v;
}

async function journal(tenantId, user, action) {
  await db.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)', [user.id, action.slice(0, 500), tenantId]);
}

async function creer(tenantId, user, corps) {
  const v = lire(corps);
  const r = await db.query(
    `INSERT INTO rangements (tenant_id, nom, lieu, ordre, debut_semaine, debut_lettre, fin_semaine, fin_lettre, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLONNES}`,
    [tenantId, v.nom, v.lieu, v.ordre, v.debut_semaine, v.debut_lettre, v.fin_semaine, v.fin_lettre, user.id]
  );
  await journal(tenantId, user, `A ajouté « ${v.nom} » au plan de rangement`);
  return r.rows[0];
}

async function modifier(tenantId, user, id, corps) {
  const v = lire(corps);
  const r = await db.query(
    `UPDATE rangements SET nom = $3, lieu = $4, ordre = $5, debut_semaine = $6, debut_lettre = $7, fin_semaine = $8, fin_lettre = $9
      WHERE id = $1 AND tenant_id = $2 RETURNING ${COLONNES}`,
    [Number(id), tenantId, v.nom, v.lieu, v.ordre, v.debut_semaine, v.debut_lettre, v.fin_semaine, v.fin_lettre]
  );
  if (!r.rows[0]) throw erreur(404, 'Armoire introuvable.');
  await journal(tenantId, user, `A modifié « ${v.nom} » dans le plan de rangement`);
  return r.rows[0];
}

async function supprimer(tenantId, user, id) {
  const r = await db.query('DELETE FROM rangements WHERE id = $1 AND tenant_id = $2 RETURNING nom', [Number(id), tenantId]);
  if (!r.rows[0]) throw erreur(404, 'Armoire introuvable.');
  await journal(tenantId, user, `A retiré « ${r.rows[0].nom} » du plan de rangement`);
  return { supprime: true };
}

async function editionDe(tenantId) {
  const slug = (await db.query('SELECT slug FROM tenants WHERE id = $1', [tenantId])).rows[0]?.slug;
  return slug && EDITIONS[slug] ? EDITIONS[slug] : null;
}

/** Le plan fourni par l'organisation (config/editions.js) : ce qui reste à installer. */
async function planPropose(tenantId) {
  const plan = (await editionDe(tenantId))?.rangements || [];
  if (!plan.length) return { plan: [], manquants: 0 };
  const deja = new Set((await lister(tenantId)).map((x) => x.nom.toLowerCase()));
  return { plan, manquants: plan.filter((a) => !deja.has(a.nom.toLowerCase())).length };
}

/** Installe le plan fourni : les armoires absentes (par leur nom) sont ajoutées, rien n'est écrasé. */
async function installerPlan(tenantId, user) {
  const { plan } = await planPropose(tenantId);
  if (!plan.length) throw erreur(404, 'Aucun plan de rangement n\'est fourni pour cette organisation.');
  const deja = new Set((await lister(tenantId)).map((x) => x.nom.toLowerCase()));
  let ajoutees = 0;
  for (const [i, a] of plan.entries()) {
    if (deja.has(a.nom.toLowerCase())) continue;
    await creer(tenantId, user, { ...a, ordre: a.ordre ?? i });
    ajoutees += 1;
  }
  return { ajoutees, armoires: await lister(tenantId) };
}

module.exports = { ARMOIRE_SQL, vendredi, lettre, lister, creer, modifier, supprimer, planPropose, installerPlan };
