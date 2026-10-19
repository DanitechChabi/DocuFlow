// ============================================================================
// loanService — prêt des dossiers physiques (migration 025).
//
// Le registre de sortie papier, rendu électronique. La DEMANDE est la ligne
// du registre (l'agent l'a faite de son compte) ; un prêt y ajoute la remise,
// la date de retour prévue et le retour.
//
//   remettre   — l'archiviste remet le dossier : la demande passe « livré »
//                (machine à états inchangée), l'agent est notifié. Remise =
//                accusé de réception TACITE : l'agent peut la signaler.
//   retourner  — l'archiviste enregistre le retour (et le rangement) ;
//                l'agent reçoit sa décharge.
//   signaler   — l'agent conteste la remise (« je ne l'ai pas reçu »).
//   confirmer  — l'agent confirme la réception, si l'organisation l'exige.
//   registre   — ce qui est dehors, en retard, signalé, revenu.
//   relancerRetards — une relance par jour au plus et par prêt en retard.
//
// Chaque geste est inscrit dans audit_logs (append-only) : c'est la preuve,
// à la place de la signature au registre.
// ============================================================================
const db = require('../config/db');
const settingsService = require('./settingsService');
const mailService = require('./mailService');
const requestStateMachine = require('./requestStateMachine');
const { libelleDemande, aujourdhui } = require('../helpers/requestInput');

const ETATS = ['en_cours', 'en_retard', 'signale', 'retourne'];

/** Erreur métier portant son code HTTP — le contrôleur la traduit telle quelle. */
function erreur(statut, message, code) {
  const e = new Error(message);
  e.statut = statut;
  if (code) e.code = code;
  return e;
}

/**
 * État d'un prêt, pour l'affichage et les filtres. Fonction pure.
 * Le signalement prime sur le retard : c'est l'anomalie à traiter d'abord.
 * @param {object} pret  ligne request_loans
 * @param {string} jour  AAAA-MM-JJ du jour
 */
function etatPret(pret, jour = aujourdhui()) {
  if (!pret) return null;
  if (pret.retourne_at) return 'retourne';
  if (pret.signale_at) return 'signale';
  const prevue = pret.date_retour_prevue instanceof Date
    ? aujourdhui(pret.date_retour_prevue)
    : String(pret.date_retour_prevue).slice(0, 10);
  return prevue < jour ? 'en_retard' : 'en_cours';
}

/** Date de retour : AAAA-MM-JJ réelle, pas avant aujourd'hui. Fonction pure. */
function lireDateRetour(brute, { defautJours = 7, now = new Date() } = {}) {
  const jour = aujourdhui(now);
  if (brute === undefined || brute === null || String(brute).trim() === '') {
    const d = new Date(now);
    d.setDate(d.getDate() + (Number(defautJours) || 7));
    return { valeur: aujourdhui(d) };
  }
  const s = String(brute).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    return { erreur: `Date de retour invalide : « ${s} » (attendu : AAAA-MM-JJ).` };
  }
  if (s < jour) return { erreur: 'La date de retour ne peut pas être déjà passée.' };
  return { valeur: s };
}

const texte = (v, max) => {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
};

async function notifier(client, tenantId, userId, title, message, type, requestId) {
  if (!userId) return;
  try {
    await client.query(
      `INSERT INTO notifications (id_user, title, message, type, request_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, title, message, type, requestId, tenantId]
    );
  } catch (err) {
    // Une cloche manquée ne doit pas défaire un prêt enregistré.
    console.error('[prêts] notification non enregistrée :', err.message);
  }
}

async function auditer(client, tenantId, userId, action, requestId) {
  await client.query(
    'INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, $3, $4)',
    [userId, action, requestId, tenantId]
  );
}

async function emailA(tenantId, userId, event, request, extra) {
  try {
    const r = await db.query('SELECT email FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
    if (r.rows[0]?.email) {
      await mailService.notify({ tenantId, to: r.rows[0].email, event, request, extra });
    }
  } catch (err) {
    console.error(`[prêts] e-mail ${event} non envoyé :`, err.message);
  }
}

async function nomDe(tenantId, userId) {
  const r = await db.query('SELECT full_name FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
  return r.rows[0]?.full_name || null;
}

/** Exécute `fn(client)` dans une transaction. */
async function enTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Remise du dossier physique à l'auteur de la demande.
 * @returns {Promise<{pret, request}>}
 */
async function remettre(tenantId, requestId, user, { date_retour_prevue, observation } = {}) {
  const settings = await settingsService.getAll(tenantId);
  const date = lireDateRetour(date_retour_prevue, { defautJours: settings.loan_default_days });
  if (date.erreur) throw erreur(400, date.erreur);
  const obs = texte(observation, 1000);

  const { pret, request } = await enTransaction(async (client) => {
    const r = await client.query(
      'SELECT * FROM requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [requestId, tenantId]
    );
    const request = r.rows[0];
    if (!request) throw erreur(404, 'Demande non trouvée');
    if (requestStateMachine.isTerminal(request.statut)) {
      throw erreur(409, `La demande est déjà « ${requestStateMachine.label(request.statut)} » : le dossier ne peut plus être remis.`, 'DEMANDE_TERMINEE');
    }
    const existant = await client.query('SELECT id FROM request_loans WHERE request_id = $1', [requestId]);
    if (existant.rows[0]) throw erreur(409, 'Ce dossier a déjà été remis pour cette demande.', 'DEJA_REMIS');

    await client.query(
      `UPDATE requests SET statut = 'livré', date_livraison = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
      [requestId, tenantId]
    );
    const ins = await client.query(
      `INSERT INTO request_loans (tenant_id, request_id, emprunteur_id, remis_par, date_retour_prevue, observation_remise)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, requestId, request.id_user, user.id, date.valeur, obs]
    );
    const emprunteur = await client.query('SELECT full_name FROM users WHERE id = $1', [request.id_user]);
    const nomEmprunteur = emprunteur.rows[0]?.full_name || 'l\'agent';

    await client.query(
      `INSERT INTO request_history (request_id, user_id, action, previous_status, new_status, comment, user_name, tenant_id)
       VALUES ($1, $2, $3, $4, 'livré', $5, $6, $7)`,
      [requestId, user.id, `Dossier physique remis à ${nomEmprunteur}`.slice(0, 100), request.statut, obs, user.full_name || null, tenantId]
    );
    await auditer(client, tenantId, user.id,
      `A remis le dossier « ${libelleDemande(request)} » à ${nomEmprunteur} (retour prévu le ${date.valeur.split('-').reverse().join('/')})`, requestId);
    await notifier(client, tenantId, request.id_user, 'Dossier remis',
      `Le dossier « ${libelleDemande(request)} » vous a été remis. Retour prévu le ${date.valeur.split('-').reverse().join('/')}.`,
      'loan_handover', requestId);
    return { pret: ins.rows[0], request: { ...request, statut: 'livré' } };
  });

  // Numérisé à la sortie : si l'archiviste a joint le scan à la demande, il
  // est versé dans la GED par le mécanisme de livraison habituel — la
  // prochaine demande de ce dossier pourra être servie en numérique. Après
  // la transaction, et sans la défaire : le dossier papier est bel et bien
  // remis ; l'échec est rendu à l'archiviste, qui peut relancer l'indexation
  // depuis la fiche.
  let indexation = null;
  try {
    const f = await db.query('SELECT COUNT(*)::int AS n FROM request_files WHERE request_id = $1', [requestId]);
    if (f.rows[0].n > 0) {
      const { indexRequestToDocuments } = require('./documentIndexService');
      const res = await indexRequestToDocuments(tenantId, requestId, user.id);
      indexation = { ok: true, document_id: res?.document?.id || null };
    }
  } catch (err) {
    console.error('[prêts] scan non versé dans la GED :', err.message);
    indexation = { ok: false, message: err.message };
  }

  const par = await nomDe(tenantId, user.id).catch(() => null);
  await emailA(tenantId, request.id_user, 'loan_handover', request, {
    dateRetour: pret.date_retour_prevue, par, requireConfirmation: settings.loan_require_confirmation === true,
  });
  return { pret, request, indexation };
}

/** Retour du dossier aux archives (et rangement). */
async function retourner(tenantId, requestId, user, { observation } = {}) {
  const obs = texte(observation, 1000);
  const { pret, request } = await enTransaction(async (client) => {
    // L'emprunteur ne se décharge pas lui-même : un agent qui détient aussi
    // requests.process pourrait sinon déclarer rendu un dossier qu'il garde.
    // Le retour est constaté par un AUTRE membre de l'archive.
    const emp = await client.query(
      'SELECT emprunteur_id FROM request_loans WHERE request_id = $1 AND tenant_id = $2 FOR UPDATE',
      [requestId, tenantId]
    );
    if (emp.rows[0] && emp.rows[0].emprunteur_id === user.id) {
      throw erreur(403, 'Vous ne pouvez pas enregistrer le retour d\'un dossier qui vous a été prêté : un autre membre des archives doit le constater.');
    }
    const upd = await client.query(
      `UPDATE request_loans SET retourne_at = now(), retourne_par = $3, observation_retour = $4
        WHERE request_id = $1 AND tenant_id = $2 AND retourne_at IS NULL
        RETURNING *`,
      [requestId, tenantId, user.id, obs]
    );
    if (!upd.rows[0]) {
      const ex = await client.query('SELECT retourne_at FROM request_loans WHERE request_id = $1 AND tenant_id = $2', [requestId, tenantId]);
      if (!ex.rows[0]) throw erreur(404, 'Aucun prêt pour cette demande.');
      throw erreur(409, 'Le retour de ce dossier est déjà enregistré.', 'DEJA_RETOURNE');
    }
    const r = await client.query('SELECT * FROM requests WHERE id = $1 AND tenant_id = $2', [requestId, tenantId]);
    const request = r.rows[0];
    await client.query(
      `INSERT INTO request_history (request_id, user_id, action, previous_status, new_status, comment, user_name, tenant_id)
       VALUES ($1, $2, 'Dossier physique retourné aux archives', $3, $3, $4, $5, $6)`,
      [requestId, user.id, request.statut, obs, user.full_name || null, tenantId]
    );
    await auditer(client, tenantId, user.id, `A enregistré le retour du dossier « ${libelleDemande(request)} »${obs ? ` — ${obs}` : ''}`, requestId);
    await notifier(client, tenantId, upd.rows[0].emprunteur_id, 'Retour enregistré',
      `Le retour du dossier « ${libelleDemande(request)} » est enregistré : vous en êtes déchargé.`, 'loan_returned', requestId);
    return { pret: upd.rows[0], request };
  });
  const par = await nomDe(tenantId, user.id).catch(() => null);
  await emailA(tenantId, pret.emprunteur_id, 'loan_returned', request, { par });
  return { pret };
}

/** Lit le prêt en vérifiant que l'appelant en est l'emprunteur. */
async function pretDeLEmprunteur(client, tenantId, requestId, user) {
  const r = await client.query(
    `SELECT l.*, q.nom_entreprise, q.description, q.num_dossier, q.id AS rid
       FROM request_loans l JOIN requests q ON q.id = l.request_id
      WHERE l.request_id = $1 AND l.tenant_id = $2 FOR UPDATE OF l`,
    [requestId, tenantId]
  );
  const pret = r.rows[0];
  if (!pret) throw erreur(404, 'Aucun prêt pour cette demande.');
  if (pret.emprunteur_id !== user.id) throw erreur(403, 'Seul l\'agent à qui le dossier a été remis peut faire ce geste.');
  if (pret.retourne_at) throw erreur(409, 'Ce dossier est déjà retourné.', 'DEJA_RETOURNE');
  return pret;
}

/** L'agent conteste la remise. */
async function signaler(tenantId, requestId, user, { message } = {}) {
  const msg = texte(message, 1000);
  if (!msg) throw erreur(400, 'Décrivez le problème (ex. : « je n\'ai pas reçu ce dossier »).');
  return enTransaction(async (client) => {
    const pret = await pretDeLEmprunteur(client, tenantId, requestId, user);
    const upd = await client.query(
      'UPDATE request_loans SET signale_at = now(), signalement = $2 WHERE id = $1 RETURNING *',
      [pret.id, msg]
    );
    const libelle = libelleDemande({ ...pret, id: pret.rid });
    await auditer(client, tenantId, user.id, `A signalé un problème sur la remise du dossier « ${libelle} » : ${msg}`, requestId);
    await notifier(client, tenantId, pret.remis_par, 'Remise signalée',
      `${user.full_name || 'L\'agent'} signale un problème sur le dossier « ${libelle} » : ${msg}`, 'loan_reported', requestId);
    return { pret: upd.rows[0] };
  });
}

/** L'agent confirme la réception (organisations qui l'exigent). Idempotent. */
async function confirmer(tenantId, requestId, user) {
  return enTransaction(async (client) => {
    const pret = await pretDeLEmprunteur(client, tenantId, requestId, user);
    if (pret.reception_confirmee_at) return { pret };
    const upd = await client.query(
      'UPDATE request_loans SET reception_confirmee_at = now() WHERE id = $1 RETURNING *', [pret.id]
    );
    await auditer(client, tenantId, user.id, `A confirmé la réception du dossier « ${libelleDemande({ ...pret, id: pret.rid })} »`, requestId);
    return { pret: upd.rows[0] };
  });
}

/**
 * Le registre des prêts d'une organisation.
 * @param {string} [etat] en_cours | en_retard | signale | retourne ; absent = tous
 */
async function registre(tenantId, { etat } = {}) {
  if (etat && !ETATS.includes(etat)) throw erreur(400, `État inconnu : ${etat} (attendu : ${ETATS.join(', ')}).`);
  const conds = ['l.tenant_id = $1'];
  if (etat === 'retourne') conds.push('l.retourne_at IS NOT NULL');
  if (etat === 'signale') conds.push('l.retourne_at IS NULL AND l.signale_at IS NOT NULL');
  if (etat === 'en_retard') conds.push('l.retourne_at IS NULL AND l.signale_at IS NULL AND l.date_retour_prevue < CURRENT_DATE');
  if (etat === 'en_cours') conds.push('l.retourne_at IS NULL AND l.signale_at IS NULL AND l.date_retour_prevue >= CURRENT_DATE');
  const r = await db.query(
    `SELECT l.*, to_char(l.date_retour_prevue, 'YYYY-MM-DD') AS date_retour_prevue,
            q.nom_entreprise, q.description, q.num_dossier, q.num_acte, q.annee, q.type_document,
            ue.full_name AS emprunteur_name, ur.full_name AS remis_par_name, ut.full_name AS retourne_par_name
       FROM request_loans l
       JOIN requests q ON q.id = l.request_id AND q.tenant_id = l.tenant_id
       LEFT JOIN users ue ON ue.id = l.emprunteur_id
       LEFT JOIN users ur ON ur.id = l.remis_par
       LEFT JOIN users ut ON ut.id = l.retourne_par
      WHERE ${conds.join(' AND ')}
      ORDER BY (l.retourne_at IS NULL) DESC, l.date_retour_prevue ASC, l.remis_at DESC
      LIMIT 1000`,
    [tenantId]
  );
  const jour = aujourdhui();
  return r.rows.map((p) => ({ ...p, etat: etatPret(p, jour) }));
}

/**
 * Relance les prêts en retard — une fois par 20 h au plus et par prêt.
 * L'UPDATE … RETURNING réserve la relance : deux appels simultanés ne
 * l'envoient pas deux fois. Pas de tâche planifiée (Render free) : appelée
 * à la consultation du registre et de la liste des demandes.
 * @returns {Promise<number>} nombre de relances envoyées
 */
async function relancerRetards(tenantId) {
  let r;
  try {
    r = await db.query(
      `UPDATE request_loans l SET derniere_relance_at = now()
         FROM requests q
        WHERE q.id = l.request_id AND l.tenant_id = $1
          AND l.retourne_at IS NULL AND l.date_retour_prevue < CURRENT_DATE
          AND (l.derniere_relance_at IS NULL OR l.derniere_relance_at < now() - interval '20 hours')
        RETURNING l.request_id, l.emprunteur_id, to_char(l.date_retour_prevue, 'YYYY-MM-DD') AS date_retour_prevue,
                  q.nom_entreprise, q.description, q.num_dossier, q.num_acte, q.annee, q.type_document, q.priorite`,
      [tenantId]
    );
  } catch (err) {
    if (err.code === '42P01') return 0; // migration 025 non appliquée
    throw err;
  }
  for (const p of r.rows) {
    const request = { ...p, id: p.request_id };
    await notifier(db, tenantId, p.emprunteur_id, 'Dossier à retourner',
      `Le dossier « ${libelleDemande(request)} » devait être retourné le ${p.date_retour_prevue.split('-').reverse().join('/')}.`,
      'loan_overdue', p.request_id);
    await emailA(tenantId, p.emprunteur_id, 'loan_overdue', request, { dateRetour: p.date_retour_prevue });
  }
  return r.rows.length;
}

/** Prêt d'une demande (fiche détaillée) ; null si aucun ou base non migrée. */
async function pretDeLaDemande(tenantId, requestId) {
  try {
    const r = await db.query(
      `SELECT l.*, to_char(l.date_retour_prevue, 'YYYY-MM-DD') AS date_retour_prevue,
              ur.full_name AS remis_par_name, ut.full_name AS retourne_par_name
         FROM request_loans l
         LEFT JOIN users ur ON ur.id = l.remis_par
         LEFT JOIN users ut ON ut.id = l.retourne_par
        WHERE l.request_id = $1 AND l.tenant_id = $2`,
      [requestId, tenantId]
    );
    const p = r.rows[0];
    return p ? { ...p, etat: etatPret(p) } : null;
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

/**
 * Ajoute `loan_etat` aux lignes d'une liste de demandes (badge). Une seule
 * requête pour toute la liste ; base non migrée → lignes inchangées.
 */
async function annoterListe(tenantId, rows) {
  if (!rows.length) return rows;
  let r;
  try {
    r = await db.query(
      `SELECT request_id, retourne_at, signale_at, to_char(date_retour_prevue, 'YYYY-MM-DD') AS date_retour_prevue
         FROM request_loans WHERE tenant_id = $1 AND request_id = ANY($2::int[])`,
      [tenantId, rows.map((x) => x.id)]
    );
  } catch (err) {
    if (err.code === '42P01') return rows;
    throw err;
  }
  const jour = aujourdhui();
  const parDemande = new Map(r.rows.map((p) => [p.request_id, p]));
  return rows.map((x) => {
    const p = parDemande.get(x.id);
    return p ? { ...x, loan_etat: etatPret(p, jour), loan_retour_prevu: p.date_retour_prevue } : x;
  });
}

module.exports = {
  ETATS, etatPret, lireDateRetour,
  remettre, retourner, signaler, confirmer, registre, relancerRetards, pretDeLaDemande, annoterListe,
};
