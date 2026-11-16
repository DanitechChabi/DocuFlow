// ============================================================================
// complementService — l'archive renvoie une demande insuffisante (051).
//
// Une demande à laquelle il manque de quoi retrouver le dossier (pas de
// n° d'acte pour une caution, année absente…) n'est ni servie au hasard, ni
// refusée sèchement : l'archiviste la renvoie à son auteur, « À compléter »,
// en cochant ce qui manque et en ajoutant un mot. Le demandeur la complète
// et la renvoie ; elle revient « En attente » dans la file de l'archive.
// ============================================================================
const db = require('../config/db');
const requestStateMachine = require('./requestStateMachine');
const roleService = require('./roleService');
const loanService = require('./loanService');
const listeService = require('./listeService');
const mailService = require('./mailService');
const exigencesTypologie = require('../helpers/exigencesTypologie');
const { lireSaisie, libelleDemande } = require('../helpers/requestInput');

const A_COMPLETER = 'a completer';

// Ce que l'archive peut demander de préciser.
const CHAMPS = {
  nom_entreprise: 'le nom de l\'entreprise',
  num_acte: 'le n° d\'acte',
  num_dossier: 'le n° de dossier',
  annee: 'l\'année',
  banque: 'la banque',
  type_document: 'la typologie',
  montant: 'le montant',
  description: 'des précisions',
};

function erreur(statut, message) {
  const e = new Error(message);
  e.statut = statut;
  return e;
}

const texte = (v, max) => {
  const s = v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

async function lire(tenantId, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw erreur(400, 'Identifiant de demande invalide.');
  const r = await db.query('SELECT * FROM requests WHERE id = $1 AND tenant_id = $2', [n, tenantId]);
  if (!r.rows[0]) throw erreur(404, 'Demande non trouvée.');
  return r.rows[0];
}

async function historiser(tenantId, { requestId, user, action, avant, apres, commentaire }) {
  try {
    await db.query(
      `INSERT INTO request_history (request_id, user_id, action, previous_status, new_status, comment, user_name, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [requestId, user.id, action.slice(0, 100), avant, apres, commentaire || null, (user.full_name || '').slice(0, 100) || null, tenantId]
    );
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }
}

async function courriel(tenantId, userId, request) {
  try {
    const email = (await db.query('SELECT email FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId])).rows[0]?.email;
    if (email) await mailService.notify({ tenantId, to: email, event: 'status_update', request });
  } catch (err) {
    console.error('[compléments] e-mail :', err.message);
  }
}

const enumeration = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}` : l[0] || '');

/**
 * L'archiviste renvoie la demande à son auteur : `champs` (ce qui manque,
 * parmi CHAMPS) et/ou `message` (un mot libre) — au moins l'un des deux.
 * Possible tant que le dossier n'est pas sorti.
 */
async function demander(tenantId, user, id, { champs, message } = {}) {
  if (!(await roleService.possede(tenantId, user.role, 'requests.process'))) {
    throw erreur(403, 'Seule l\'archive peut demander des compléments.');
  }
  const request = await lire(tenantId, id);
  const liste = [...new Set((Array.isArray(champs) ? champs : []).map(String).filter((c) => CHAMPS[c]))];
  const mot = texte(message, 1000);
  if (!liste.length && !mot) throw erreur(400, 'Indiquez ce qui manque : cochez au moins un élément ou écrivez un mot au demandeur.');
  if (await loanService.pretDeLaDemande(tenantId, request.id)) {
    throw erreur(409, 'Le dossier est déjà sorti : il n\'y a plus rien à compléter.');
  }
  const check = requestStateMachine.canTransition({ from: request.statut, to: A_COMPLETER, role: user.role, isOwner: false });
  if (!check.ok) throw erreur(409, check.reason);

  await db.query(
    `UPDATE requests SET statut = $1, complement_message = $2, complement_champs = $3, complement_demande_at = CURRENT_TIMESTAMP,
            complement_demande_par = $4, complement_fourni_at = NULL, complement_reponse = NULL
      WHERE id = $5 AND tenant_id = $6`,
    [A_COMPLETER, mot, liste, (user.full_name || '').slice(0, 255) || null, request.id, tenantId]
  );
  const manque = enumeration(liste.map((c) => CHAMPS[c]));
  const resume = [manque && `il manque ${manque}`, mot].filter(Boolean).join(' — ');
  await historiser(tenantId, { requestId: request.id, user, action: 'Compléments demandés', avant: request.statut, apres: A_COMPLETER, commentaire: resume });
  await loanService.notifier(db, tenantId, request.id_user, 'Votre demande est à compléter',
    `L'archive ne peut pas retrouver ${libelleDemande(request)} : ${resume}. Complétez-la depuis « Mes dossiers ».`.slice(0, 1000),
    'complement', request.id);
  await db.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, $3, $4)',
    [user.id, `A demandé des compléments pour ${libelleDemande(request)}`.slice(0, 500), request.id, tenantId]);
  await courriel(tenantId, request.id_user, { ...request, statut: A_COMPLETER });
  return { ...request, statut: A_COMPLETER, complement_message: mot, complement_champs: liste };
}

/**
 * Le demandeur complète sa demande et la renvoie : les références fournies
 * remplacent les anciennes (un champ laissé vide garde sa valeur), `reponse`
 * est un mot facultatif pour l'archive. Ce qui était demandé doit être là.
 */
async function completer(tenantId, user, id, corps = {}) {
  const request = await lire(tenantId, id);
  if (request.id_user !== user.id) throw erreur(403, 'Seul l\'auteur de la demande peut la compléter.');
  if (request.statut !== A_COMPLETER) throw erreur(409, 'Cette demande n\'attend pas de compléments.');

  // Un champ laissé vide garde sa valeur : la saisie est relue sur la demande complétée.
  const champsSaisis = ['nom_entreprise', 'num_dossier', 'num_acte', 'annee', 'banque', 'montant', 'description'];
  const vide = (v) => v === undefined || v === null || String(v).trim() === '';
  const corpsFusionne = Object.fromEntries(champsSaisis.map((c) => [c, vide(corps[c]) ? request[c] : corps[c]]));
  if (!vide(corps.reponse) && vide(corpsFusionne.description) && !champsSaisis.some((c) => c !== 'description' && !vide(corpsFusionne[c]))) {
    corpsFusionne.description = corps.reponse;
  }
  const { values, errors } = lireSaisie(corpsFusionne);
  if (errors.length) throw erreur(400, errors.join(' '));
  const fusion = Object.fromEntries(champsSaisis.map((c) => [c, values[c] ?? null]));
  const type = texte(corps.type_document, 100) || request.type_document || null;
  fusion.type_document = type;

  // Ce que l'archive a demandé, et ce que la typologie exige.
  const absents = (request.complement_champs || []).filter((c) => c !== 'description' && (fusion[c] === null || fusion[c] === ''));
  if (absents.length) throw erreur(400, `L'archive a besoin de ${enumeration(absents.map((c) => CHAMPS[c] || c))}.`);
  const manque = exigencesTypologie.manque(fusion, type, await exigencesTypologie.exigencesDe(tenantId));
  if (manque) throw erreur(400, manque);
  const reponse = texte(corps.reponse, 1000);
  if ((request.complement_champs || []).includes('description') && !fusion.description && !reponse) {
    throw erreur(400, 'L\'archive attend des précisions : écrivez-les dans le mot pour l\'archive.');
  }

  await db.query(
    `UPDATE requests SET statut = 'en attente', nom_entreprise = $1, num_dossier = $2, num_acte = $3, annee = $4, banque = $5,
            montant = $6, description = $7, type_document = $8, complement_fourni_at = CURRENT_TIMESTAMP, complement_reponse = $9
      WHERE id = $10 AND tenant_id = $11`,
    [fusion.nom_entreprise, fusion.num_dossier, fusion.num_acte, fusion.annee, fusion.banque, fusion.montant, fusion.description, type, reponse, request.id, tenantId]
  );
  const apres = { ...request, ...fusion, statut: 'en attente' };
  await historiser(tenantId, { requestId: request.id, user, action: 'Demande complétée', avant: A_COMPLETER, apres: 'en attente', commentaire: reponse });
  // L'archiviste qui a demandé les compléments n'est pas forcément là : toute l'archive est prévenue.
  for (const uid of await listeService.processeurs(tenantId)) {
    await loanService.notifier(db, tenantId, uid, 'Demande complétée',
      `${user.full_name || 'Le demandeur'} a complété ${libelleDemande(apres)}${reponse ? ` : « ${reponse} »` : ''}.`.slice(0, 1000),
      'complement', request.id);
  }
  await db.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, $3, $4)',
    [user.id, `A complété la demande ${libelleDemande(apres)}`.slice(0, 500), request.id, tenantId]);
  return apres;
}

module.exports = { A_COMPLETER, CHAMPS, demander, completer };
