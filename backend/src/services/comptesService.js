// ============================================================================
// comptesService — la gestion des comptes, simple, pour l'administrateur.
//
// La liste des agents avec ce qui compte au quotidien (département, rôle,
// dernière connexion, dossiers chez eux), et les gestes : changer le rôle ou
// le département, donner un mot de passe provisoire, désactiver un agent qui
// part (son historique reste : demandes, prêts, traces), le réactiver.
// ============================================================================
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const roleService = require('./roleService');

function erreur(statut, message) {
  const e = new Error(message);
  e.statut = statut;
  return e;
}

const texte = (v, max) => {
  const s = v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** Les rôles proposés, dans les mots de l'archive (le superadministrateur n'est pas attribuable). */
async function roles(tenantId) {
  const liste = await roleService.listRoles(tenantId).catch(() => []);
  return liste
    .filter((r) => r.key !== 'superadmin' && r.is_active !== false)
    .map((r) => ({ cle: r.key, libelle: r.label || r.name || r.key }));
}

async function lister(tenantId) {
  const r = await db.query(
    `SELECT u.id, u.username, u.full_name, u.email, u.section, u.role, u.created_at,
            u.desactive_le, u.desactive_par, u.derniere_connexion, u.mdp_a_changer,
            (SELECT count(*)::int FROM request_loans p WHERE p.emprunteur_id = u.id AND p.retourne_at IS NULL) AS dossiers_chez_lui,
            (SELECT count(*)::int FROM requests q LEFT JOIN request_loans p ON p.request_id = q.id
              WHERE q.id_user = u.id AND p.id IS NULL AND q.statut IN ('en attente', 'a traiter', 'a completer')) AS demandes_en_cours
       FROM users u WHERE u.tenant_id = $1
      ORDER BY (u.desactive_le IS NOT NULL), lower(u.full_name), u.id`,
    [tenantId]
  );
  const t = require('../helpers/tentativesConnexion');
  return { comptes: r.rows.map((c) => ({ ...c, bloque_minutes: t.blocageDe(c.username) })), roles: await roles(tenantId) };
}

async function cible(tenantId, auteur, id) {
  const n = Number(id);
  if (!Number.isInteger(n)) throw erreur(400, 'Compte invalide.');
  const u = (await db.query('SELECT * FROM users WHERE id = $1 AND tenant_id = $2', [n, tenantId])).rows[0];
  if (!u) throw erreur(404, 'Compte introuvable.');
  if (u.role === 'superadmin' && auteur.role !== 'superadmin') throw erreur(403, 'Le compte du super administrateur ne se modifie pas ici.');
  return u;
}

async function journal(tenantId, auteur, action) {
  await db.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)', [auteur.id, action.slice(0, 500), tenantId]);
}

/** Change le rôle, le département, le nom ou l'adresse d'un agent. */
async function modifier(tenantId, auteur, id, corps = {}) {
  const u = await cible(tenantId, auteur, id);
  const changements = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (corps.role !== undefined && corps.role !== u.role) {
    if (u.id === auteur.id) throw erreur(400, 'Vous ne pouvez pas changer votre propre rôle.');
    const ok = (await roles(tenantId)).some((r) => r.cle === corps.role);
    if (!ok) throw erreur(400, `Rôle « ${corps.role} » inconnu.`);
    changements.push(`role = ${p(corps.role)}`, 'token_version = COALESCE(token_version, 0) + 1');
  }
  if (corps.section !== undefined) changements.push(`section = ${p(texte(corps.section, 255))}`);
  if (corps.full_name !== undefined) {
    const nom = texte(corps.full_name, 255);
    if (!nom) throw erreur(400, 'Le nom ne peut pas être vide.');
    changements.push(`full_name = ${p(nom)}`);
  }
  if (corps.email !== undefined) {
    const email = texte(corps.email, 255);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw erreur(400, `Adresse invalide : « ${email} ».`);
    changements.push(`email = ${p(email ? email.toLowerCase() : null)}`);
  }
  if (!changements.length) return { ok: true };
  try {
    await db.query(`UPDATE users SET ${changements.join(', ')} WHERE id = ${p(u.id)} AND tenant_id = ${p(tenantId)}`, params);
  } catch (err) {
    if (err.code === '23505') throw erreur(409, 'Cette adresse est déjà celle d\'un autre compte.');
    throw err;
  }
  roleService.invalidateUser(u.id);
  await journal(tenantId, auteur, `A modifié le compte de ${u.full_name}${corps.role && corps.role !== u.role ? ` (rôle : ${u.role} → ${corps.role})` : ''}`);
  return { ok: true };
}

/** Désactive (agent qui part) ou réactive un compte. Les sessions ouvertes tombent aussitôt. */
async function activer(tenantId, auteur, id, actif) {
  const u = await cible(tenantId, auteur, id);
  if (u.id === auteur.id) throw erreur(400, 'Vous ne pouvez pas désactiver votre propre compte.');
  if (u.role === 'superadmin') throw erreur(403, 'Le compte du super administrateur ne se désactive pas.');
  if (actif) {
    await db.query('UPDATE users SET desactive_le = NULL, desactive_par = NULL WHERE id = $1', [u.id]);
  } else {
    await db.query('UPDATE users SET desactive_le = now(), desactive_par = $2, token_version = COALESCE(token_version, 0) + 1 WHERE id = $1',
      [u.id, (auteur.full_name || '').slice(0, 255) || null]);
  }
  roleService.invalidateUser(u.id);
  await journal(tenantId, auteur, `A ${actif ? 'réactivé' : 'désactivé'} le compte de ${u.full_name}`);
  const dehors = (await db.query('SELECT count(*)::int AS n FROM request_loans WHERE emprunteur_id = $1 AND retourne_at IS NULL', [u.id])).rows[0].n;
  return { ok: true, dossiers_chez_lui: dehors };
}

/** Mot de passe provisoire, montré UNE fois à l'administrateur (à remettre à l'agent). */
async function motDePasseProvisoire(tenantId, auteur, id) {
  const u = await cible(tenantId, auteur, id);
  // Lisible au téléphone : sans 0/O ni 1/l/I.
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const octets = crypto.randomBytes(10);
  const mdp = Array.from(octets, (b) => alphabet[b % alphabet.length]).join('');
  await db.query('UPDATE users SET password_hash = $1, mdp_a_changer = TRUE, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2',
    [await bcrypt.hash(mdp, 10), u.id]);
  roleService.invalidateUser(u.id);
  require('../helpers/tentativesConnexion').debloquer(u.username);
  await journal(tenantId, auteur, `A donné un mot de passe provisoire à ${u.full_name}`);
  return { mot_de_passe: mdp };
}

/** Lève le blocage après trop d'essais de connexion (061). */
async function debloquer(tenantId, auteur, id) {
  const u = await cible(tenantId, auteur, id);
  require('../helpers/tentativesConnexion').debloquer(u.username);
  await journal(tenantId, auteur, `A débloqué la connexion de ${u.full_name}`);
  return { ok: true };
}

module.exports = {
  debloquer, lister, modifier, activer, motDePasseProvisoire, roles };
