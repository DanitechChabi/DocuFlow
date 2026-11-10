// ============================================================================
// courrierService — gestion du courrier, bureau d'ordre (migration 041).
//
// Le registre du courrier : arrivée, départ, interne. Chaque courrier reçoit à
// l'enregistrement un numéro chronologique annuel (A-2026-00001), puis suit
// son chemin, chaque étape horodatée dans courrier_evenements :
//
//   ARRIVÉE / INTERNE  enregistré → affecté → en traitement → clos
//                      (répondu, pour information, sans suite)
//   DÉPART             brouillon → expédié
//
// Une réponse est un courrier DÉPART lié à l'arrivée ; son expédition clôt
// l'arrivée (« répondu »). Le scan est un document de la GED.
//
// QUI VOIT QUOI. mail.manage ou mail.register (le secrétariat tient le
// registre) : tout le registre, sauf les confidentiels.
// Sinon : ce que l'on a enregistré, ce qui nous est affecté, ce dont on est en
// copie. Un confidentiel n'est vu que de ces trois cercles.
// ============================================================================
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const db = require('../config/db');
const roleService = require('./roleService');
const settingsService = require('./settingsService');

const SENS = { arrivee: 'A', depart: 'D', interne: 'I' };
const CANAUX = ['papier', 'poste', 'porteur', 'email', 'portail', 'autre'];
const NATURES = ['lettre', 'note', 'demande', 'reclamation', 'invitation', 'facture', 'rapport', 'autre'];
const MOTIFS_CLOTURE = ['repondu', 'information', 'sans_suite'];
const OUVERTS = ['enregistre', 'affecte', 'en_traitement'];

function erreur(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}
const texte = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const longTexte = (v, max) => String(v ?? '').trim().slice(0, max);
const jour = (v) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const plusJours = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Valide la saisie d'un enregistrement. Fonction pure. */
function lireSaisie(b = {}, { delaiJours = 15 } = {}) {
  const erreurs = [];
  const sens = SENS[b.sens] ? b.sens : null;
  if (!sens) erreurs.push('Sens du courrier inconnu (arrivée, départ ou interne).');
  const d = {
    sens,
    objet: texte(b.objet, 300),
    correspondant: texte(b.correspondant, 200),
    organisme: texte(b.organisme, 200) || null,
    reference_externe: texte(b.reference_externe, 80) || null,
    date_courrier: null,
    canal: CANAUX.includes(b.canal) ? b.canal : 'papier',
    nature: NATURES.includes(b.nature) ? b.nature : 'lettre',
    urgent: b.urgent === true || b.urgent === 'true',
    confidentiel: b.confidentiel === true || b.confidentiel === 'true',
    reponse_attendue: sens === 'depart' ? false : (b.reponse_attendue === true || b.reponse_attendue === 'true'),
    echeance: null,
    document_id: b.document_id ? Number(b.document_id) : null,
  };
  if (!d.objet) erreurs.push("L'objet du courrier est obligatoire.");
  if (!d.correspondant) erreurs.push(sens === 'depart' ? 'Le destinataire est obligatoire.' : "L'expéditeur est obligatoire.");
  if (b.date_courrier) {
    d.date_courrier = jour(b.date_courrier);
    if (!d.date_courrier) erreurs.push('Date du courrier invalide.');
    else if (d.date_courrier > aujourdhui()) erreurs.push('La date du courrier ne peut pas être dans le futur.');
  }
  if (b.echeance) {
    d.echeance = jour(b.echeance);
    if (!d.echeance) erreurs.push("Date d'échéance invalide.");
  } else if (d.reponse_attendue) {
    d.echeance = plusJours(delaiJours);
  }
  if (d.document_id !== null && (!Number.isInteger(d.document_id) || d.document_id <= 0)) erreurs.push('Document lié invalide.');
  return { erreurs, valeurs: d };
}

/** Un courrier ouvert a-t-il dépassé son échéance ? Fonction pure. */
function enRetard(c, ref = aujourdhui()) {
  return Boolean(c.echeance && OUVERTS.includes(c.statut) && String(c.echeance).slice(0, 10) < ref);
}

async function droits(user) {
  const [gerer, enregistrer] = await Promise.all([
    roleService.possede(user.tenant_id, user.role, 'mail.manage'),
    roleService.possede(user.tenant_id, user.role, 'mail.register'),
  ]);
  // Le registre entier (hors confidentiels) est vu de qui le supervise ou le tient.
  return { gerer, enregistrer, registre: gerer || enregistrer };
}

/** Clause de visibilité (voir l'en-tête). `i` = rang du paramètre « id de l'utilisateur ». */
function visible(gerer, i) {
  const cercle = `(c.created_by = $${i} OR c.assigne_a = $${i} OR $${i} = ANY(c.copies))`;
  return gerer ? `(c.confidentiel IS NOT TRUE OR ${cercle})` : cercle;
}

const COLONNES = `c.id, c.sens, c.numero, c.objet, c.correspondant, c.organisme, c.reference_externe,
  to_char(c.date_courrier, 'YYYY-MM-DD') AS date_courrier, c.canal, c.nature, c.urgent, c.confidentiel, c.statut,
  c.reponse_attendue, to_char(c.echeance, 'YYYY-MM-DD') AS echeance, c.assigne_a, c.assigne_nom, c.assigne_at,
  c.instruction, c.copies, c.document_id, c.reponse_a_id, c.expedie_at, c.mode_expedition, c.accuse_reception_at,
  c.clos_at, c.clos_motif, c.created_by, c.created_by_nom, c.created_at`;

const vers = (c) => ({ ...c, en_retard: enRetard(c) });

async function identite(user) {
  if (user.full_name) return { id: user.id, nom: user.full_name };
  const u = (await db.query('SELECT full_name, username FROM users WHERE id = $1', [user.id])).rows[0] || {};
  return { id: user.id, nom: u.full_name || u.username || `Utilisateur ${user.id}` };
}

async function evenement(client, tenantId, courrierId, action, qui, note = null) {
  await client.query(
    'INSERT INTO courrier_evenements (tenant_id, courrier_id, action, par, par_nom, note) VALUES ($1, $2, $3, $4, $5, $6)',
    [tenantId, courrierId, action, qui?.id || null, qui?.nom || null, note]);
}

async function notifier(tenantId, userIds, titre, message, courrierId) {
  for (const id of [...new Set(userIds.filter(Boolean))]) {
    try {
      await db.query(
        `INSERT INTO notifications (tenant_id, id_user, title, message, type, lien) VALUES ($1, $2, $3, $4, 'courrier', $5)`,
        [tenantId, id, titre.slice(0, 100), message, `/courrier/${courrierId}`]);
    } catch (err) { console.error('[courrier] notification non enregistrée :', err.message); }
  }
}

async function prochainNumero(client, tenantId, sens, annee) {
  const { rows } = await client.query(
    `INSERT INTO courrier_compteurs (tenant_id, sens, annee, dernier) VALUES ($1, $2, $3, 1)
     ON CONFLICT (tenant_id, sens, annee) DO UPDATE SET dernier = courrier_compteurs.dernier + 1 RETURNING dernier`,
    [tenantId, sens, annee]);
  return `${SENS[sens]}-${annee}-${String(rows[0].dernier).padStart(5, '0')}`;
}

/** Agents à qui un courrier peut être affecté (personnes qui peuvent le consulter). */
async function agents(tenantId) {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.section, r.name AS role
       FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.key = u.role
      WHERE u.tenant_id = $1 AND r.is_active AND u.username NOT LIKE 'portail-citoyen-%'
        AND ('*' = ANY(r.permissions) OR 'mail.view' = ANY(r.permissions))
      ORDER BY u.full_name`, [tenantId]);
  return rows;
}

async function verifierAgents(tenantId, ids) {
  const voulus = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!voulus.length) return [];
  const connus = await agents(tenantId);
  const inconnus = voulus.filter((id) => !connus.some((a) => a.id === id));
  if (inconnus.length) throw erreur(400, 'Un des agents choisis ne peut pas recevoir de courrier.');
  return voulus.map((id) => connus.find((a) => a.id === id));
}

/** Enregistre un courrier au registre. Rend le courrier. */
async function enregistrer(user, corps = {}, { reponseA = null } = {}) {
  const tenantId = user.tenant_id;
  const d0 = await droits(user);
  // Répondre à un courrier qui nous est affecté n'exige pas mail.register.
  if (!d0.enregistrer && !reponseA) throw erreur(403, "Vous n'avez pas le droit d'enregistrer du courrier.");
  const reglages = await settingsService.getAll(tenantId);
  const { erreurs, valeurs: d } = lireSaisie(corps, { delaiJours: Number(reglages.courrier_delai_reponse_jours) || 15 });
  if (erreurs.length) throw erreur(400, erreurs.join(' '));
  if (d.document_id && !(await db.query('SELECT 1 FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [d.document_id, tenantId])).rows[0]) {
    throw erreur(400, 'Document lié introuvable.');
  }
  const affecte = corps.assigne_a ? (await verifierAgents(tenantId, [corps.assigne_a]))[0] : null;
  const copies = (await verifierAgents(tenantId, Array.isArray(corps.copies) ? corps.copies : [])).map((a) => a.id);
  const qui = await identite(user);
  const client = await db.pool.connect();
  let c;
  try {
    await client.query('BEGIN');
    const numero = await prochainNumero(client, tenantId, d.sens, new Date().getFullYear());
    const statut = d.sens === 'depart' ? 'brouillon' : (affecte ? 'affecte' : 'enregistre');
    c = (await client.query(
      `INSERT INTO courriers (tenant_id, sens, numero, objet, correspondant, organisme, reference_externe, date_courrier, canal, nature,
         urgent, confidentiel, statut, reponse_attendue, echeance, assigne_a, assigne_nom, assigne_at, instruction, copies,
         document_id, reponse_a_id, created_by, created_by_nom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
      [tenantId, d.sens, numero, d.objet, d.correspondant, d.organisme, d.reference_externe, d.date_courrier, d.canal, d.nature,
        d.urgent, d.confidentiel, statut, d.reponse_attendue, d.echeance, affecte?.id || null, affecte?.full_name || null,
        affecte ? new Date() : null, longTexte(corps.instruction, 1000) || null, copies, d.document_id, reponseA?.id || null, qui.id, qui.nom])).rows[0];
    await evenement(client, tenantId, c.id, 'ENREGISTRE', qui, reponseA ? `Réponse au courrier ${reponseA.numero}` : null);
    if (affecte) await evenement(client, tenantId, c.id, 'AFFECTE', qui, `À ${affecte.full_name}${corps.instruction ? ` — ${longTexte(corps.instruction, 1000)}` : ''}`);
    // Le scan tout juste déposé (« à indexer ») prend le numéro pour description.
    if (d.document_id) {
      await client.query(
        `UPDATE documents SET description = $3 WHERE id = $1 AND tenant_id = $2 AND COALESCE(description, '') = ''`,
        [d.document_id, tenantId, `Courrier ${numero} — ${d.objet}`]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
  const courrier = await lire(user, c.id);
  if (affecte && affecte.id !== user.id) {
    await notifier(tenantId, [affecte.id], `Courrier ${courrier.numero} à traiter`, `${courrier.objet} — ${courrier.correspondant}${courrier.echeance ? `. Échéance : ${frDate(courrier.echeance)}` : ''}`, c.id);
  }
  await notifier(tenantId, copies.filter((id) => id !== user.id && id !== affecte?.id), `Courrier ${courrier.numero} en copie`, `${courrier.objet} — ${courrier.correspondant}`, c.id);
  return courrier;
}

const frDate = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');

/** Lit un courrier visible de l'utilisateur, avec son historique et ses liens. */
async function lire(user, id) {
  const d0 = await droits(user);
  const c = (await db.query(
    `SELECT ${COLONNES}, d.reference_mfile AS document_reference
       FROM courriers c LEFT JOIN documents d ON d.id = c.document_id AND d.tenant_id = c.tenant_id
      WHERE c.id = $1 AND c.tenant_id = $2 AND ${visible(d0.registre, 3)}`, [Number(id), user.tenant_id, user.id])).rows[0];
  if (!c) throw erreur(404, 'Courrier introuvable.');
  const [evts, reponses, origine, copies] = await Promise.all([
    db.query('SELECT id, action, par_nom, note, created_at FROM courrier_evenements WHERE courrier_id = $1 ORDER BY id', [c.id]),
    db.query('SELECT id, numero, objet, statut, expedie_at FROM courriers WHERE reponse_a_id = $1 AND tenant_id = $2 ORDER BY id', [c.id, user.tenant_id]),
    c.reponse_a_id ? db.query('SELECT id, numero, objet, correspondant FROM courriers WHERE id = $1 AND tenant_id = $2', [c.reponse_a_id, user.tenant_id]) : { rows: [] },
    c.copies.length ? db.query('SELECT id, full_name FROM users WHERE id = ANY($1) AND tenant_id = $2 ORDER BY full_name', [c.copies, user.tenant_id]) : { rows: [] },
  ]);
  const charge = c.assigne_a === user.id;
  const ouvert = OUVERTS.includes(c.statut);
  return {
    ...vers(c), evenements: evts.rows, reponses: reponses.rows, origine: origine.rows[0] || null, copies_noms: copies.rows,
    actions: {
      affecter: ouvert && (d0.gerer || d0.enregistrer || charge),
      prendre_en_charge: c.statut === 'affecte' && charge,
      repondre: ouvert && c.sens !== 'depart' && (charge || d0.gerer || d0.enregistrer),
      clore: ouvert && (charge || d0.gerer),
      expedier: c.statut === 'brouillon' && (c.created_by === user.id || d0.gerer || d0.enregistrer),
      accuse_reception: c.sens === 'arrivee' && (d0.enregistrer || d0.gerer),
      modifier: c.statut !== 'clos' && c.statut !== 'expedie' && (c.created_by === user.id || d0.registre),
    },
  };
}

/** Liste filtrée. vue : tous | a_moi | a_affecter | en_retard | copies. */
async function lister(user, { sens, statut, annee, q, vue = 'tous', page = 1, taille = 50, du, au } = {}) {
  const d0 = await droits(user);
  const params = [user.tenant_id, user.id];
  const ou = [`c.tenant_id = $1`, visible(d0.registre, 2)];
  const ajouter = (sql, v) => { params.push(v); ou.push(sql.replace('?', `$${params.length}`)); };
  if (SENS[sens]) ajouter('c.sens = ?', sens);
  if (statut === 'ouvert') ou.push(`c.statut IN ('enregistre', 'affecte', 'en_traitement', 'brouillon')`);
  else if (statut) ajouter('c.statut = ?', statut);
  if (annee && Number.isInteger(Number(annee))) ajouter('extract(year FROM c.created_at) = ?', Number(annee));
  if (jour(du)) ajouter('c.created_at >= ?::date', jour(du));
  if (jour(au)) ajouter(`c.created_at < ?::date + 1`, jour(au));
  if (vue === 'a_moi') ou.push(`c.assigne_a = $2 AND c.statut IN ('affecte', 'en_traitement')`);
  if (vue === 'a_affecter') ou.push(`c.statut = 'enregistre'`);
  if (vue === 'en_retard') ou.push(`c.echeance < CURRENT_DATE AND c.statut IN ('enregistre', 'affecte', 'en_traitement')`);
  if (vue === 'copies') ou.push('$2 = ANY(c.copies)');
  const terme = texte(q, 100);
  if (terme) {
    params.push(`%${terme.replace(/[%_\\]/g, '\\$&')}%`);
    const i = params.length;
    ou.push(`(c.numero ILIKE $${i} OR c.objet ILIKE $${i} OR c.correspondant ILIKE $${i} OR c.organisme ILIKE $${i} OR c.reference_externe ILIKE $${i})`);
  }
  const t = Math.min(Math.max(Number(taille) || 50, 1), 2000);
  const p = Math.max(Number(page) || 1, 1);
  const where = ou.join(' AND ');
  const total = (await db.query(`SELECT count(*)::int AS n FROM courriers c WHERE ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT ${COLONNES} FROM courriers c WHERE ${where}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ${t} OFFSET ${(p - 1) * t}`, params);
  return { courriers: rows.map(vers), total, page: p, taille: t };
}

/** Chiffres du tableau de bord, dans le périmètre visible de l'utilisateur. */
async function synthese(user) {
  const d0 = await droits(user);
  const r = (await db.query(
    `SELECT count(*) FILTER (WHERE c.statut = 'enregistre')::int AS a_affecter,
            count(*) FILTER (WHERE c.assigne_a = $2 AND c.statut IN ('affecte', 'en_traitement'))::int AS a_moi,
            count(*) FILTER (WHERE c.statut IN ('affecte', 'en_traitement'))::int AS en_cours,
            count(*) FILTER (WHERE c.echeance < CURRENT_DATE AND c.statut IN ('enregistre', 'affecte', 'en_traitement'))::int AS en_retard,
            count(*) FILTER (WHERE c.statut = 'brouillon')::int AS departs_a_expedier,
            count(*) FILTER (WHERE c.sens = 'arrivee' AND c.created_at >= date_trunc('month', now()))::int AS arrivees_mois,
            count(*) FILTER (WHERE c.sens = 'depart' AND c.created_at >= date_trunc('month', now()))::int AS departs_mois,
            round(avg(EXTRACT(EPOCH FROM (c.clos_at - c.created_at)) / 86400) FILTER (WHERE c.sens = 'arrivee' AND c.clos_motif = 'repondu')::numeric, 1)::float AS delai_reponse_jours
       FROM courriers c WHERE c.tenant_id = $1 AND ${visible(d0.registre, 2)}`, [user.tenant_id, user.id])).rows[0];
  return { ...r, droits: d0 };
}

/** Correspondants déjà connus (saisie assistée). */
async function correspondants(user, q) {
  const terme = texte(q, 80);
  if (terme.length < 2) return [];
  const { rows } = await db.query(
    `SELECT correspondant, max(organisme) AS organisme, count(*)::int AS n FROM courriers
      WHERE tenant_id = $1 AND confidentiel IS NOT TRUE AND (correspondant ILIKE $2 OR organisme ILIKE $2)
      GROUP BY correspondant ORDER BY n DESC, correspondant LIMIT 8`,
    [user.tenant_id, `%${terme.replace(/[%_\\]/g, '\\$&')}%`]);
  return rows;
}

/** Verrouille un courrier visible pour une action ; rend { c, d0, qui, client }. */
async function ouvrirAction(user, id) {
  const d0 = await droits(user);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const c = (await client.query(
      `SELECT c.*, to_char(c.date_courrier, 'YYYY-MM-DD') AS date_courrier_txt, to_char(c.echeance, 'YYYY-MM-DD') AS echeance_txt
         FROM courriers c WHERE c.id = $1 AND c.tenant_id = $2 AND ${visible(d0.registre, 3)} FOR UPDATE OF c`,
      [Number(id), user.tenant_id, user.id])).rows[0];
    if (!c) throw erreur(404, 'Courrier introuvable.');
    return { c, d0, qui: await identite(user), client };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    throw err;
  }
}

async function action(user, id, fn) {
  const ctx = await ouvrirAction(user, id);
  let apres;
  try {
    apres = await fn(ctx);
    await ctx.client.query('UPDATE courriers SET updated_at = now() WHERE id = $1', [ctx.c.id]);
    await ctx.client.query('COMMIT');
  } catch (err) {
    await ctx.client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { ctx.client.release(); }
  if (typeof apres === 'function') await apres();
  return lire(user, id).catch(() => ({ id: Number(id), hors_vue: true }));
}

/** Affecte (ou réaffecte) à un agent, avec instruction, échéance et copies. */
function affecter(user, id, corps = {}) {
  return action(user, id, async ({ c, d0, qui, client }) => {
    if (!OUVERTS.includes(c.statut)) throw erreur(409, 'Ce courrier ne peut plus être affecté.');
    if (!d0.gerer && !d0.enregistrer && c.assigne_a !== user.id) throw erreur(403, "Vous ne pouvez pas affecter ce courrier.");
    const [agent] = await verifierAgents(user.tenant_id, [corps.assigne_a]);
    if (!agent) throw erreur(400, "Choisissez l'agent chargé du courrier.");
    const copies = corps.copies === undefined ? c.copies : (await verifierAgents(user.tenant_id, Array.isArray(corps.copies) ? corps.copies : [])).map((a) => a.id);
    const instruction = longTexte(corps.instruction, 1000) || null;
    const echeance = corps.echeance === undefined ? c.echeance_txt : (corps.echeance ? jour(corps.echeance) : null);
    if (corps.echeance && !echeance) throw erreur(400, "Date d'échéance invalide.");
    await client.query(
      `UPDATE courriers SET assigne_a = $2, assigne_nom = $3, assigne_at = now(), instruction = $4, echeance = $5, copies = $6,
              statut = 'affecte', relance_at = NULL, retard_notifie_at = NULL WHERE id = $1`,
      [c.id, agent.id, agent.full_name, instruction, echeance, copies]);
    await evenement(client, user.tenant_id, c.id, c.assigne_a ? 'REAFFECTE' : 'AFFECTE', qui, `À ${agent.full_name}${instruction ? ` — ${instruction}` : ''}`);
    const nouvellesCopies = copies.filter((x) => !c.copies.includes(x));
    return async () => {
      if (agent.id !== user.id) {
        await notifier(user.tenant_id, [agent.id], `Courrier ${c.numero} à traiter`,
          `${c.objet} — ${c.correspondant}${instruction ? `. Instruction : ${instruction}` : ''}${echeance ? `. Échéance : ${frDate(echeance)}` : ''}`, c.id);
      }
      await notifier(user.tenant_id, nouvellesCopies.filter((x) => x !== user.id && x !== agent.id), `Courrier ${c.numero} en copie`, `${c.objet} — ${c.correspondant}`, c.id);
    };
  });
}

function prendreEnCharge(user, id) {
  return action(user, id, async ({ c, qui, client }) => {
    if (c.statut !== 'affecte' || c.assigne_a !== user.id) throw erreur(409, "Ce courrier ne vous est pas affecté, ou il est déjà pris en charge.");
    await client.query(`UPDATE courriers SET statut = 'en_traitement' WHERE id = $1`, [c.id]);
    await evenement(client, user.tenant_id, c.id, 'PRIS_EN_CHARGE', qui);
  });
}

function annoter(user, id, corps = {}) {
  return action(user, id, async ({ c, qui, client }) => {
    const note = longTexte(corps.note, 2000);
    if (!note) throw erreur(400, 'La note est vide.');
    await evenement(client, user.tenant_id, c.id, 'NOTE', qui, note);
    return () => notifier(user.tenant_id, [c.assigne_a, c.created_by].filter((x) => x !== user.id), `Note sur le courrier ${c.numero}`, `${qui.nom} : ${note.slice(0, 200)}`, c.id);
  });
}

function clore(user, id, corps = {}) {
  return action(user, id, async ({ c, d0, qui, client }) => {
    if (!OUVERTS.includes(c.statut)) throw erreur(409, 'Ce courrier est déjà clos.');
    if (!d0.gerer && c.assigne_a !== user.id) throw erreur(403, "Seul l'agent chargé du courrier ou un superviseur peut le clore.");
    if (!MOTIFS_CLOTURE.includes(corps.motif)) throw erreur(400, 'Motif de clôture attendu : répondu, pour information ou sans suite.');
    const note = longTexte(corps.note, 1000) || null;
    if (corps.motif === 'sans_suite' && !note) throw erreur(400, 'Expliquez pourquoi le courrier reste sans suite.');
    await client.query(`UPDATE courriers SET statut = 'clos', clos_at = now(), clos_motif = $2 WHERE id = $1`, [c.id, corps.motif]);
    await evenement(client, user.tenant_id, c.id, 'CLOS', qui, note);
  });
}

/** Prépare la réponse : un courrier DÉPART lié à l'arrivée. */
async function repondre(user, id, corps = {}) {
  const origine = await lire(user, id);
  if (!origine.actions.repondre) throw erreur(403, 'Vous ne pouvez pas répondre à ce courrier.');
  const reponse = await enregistrer(user, {
    sens: 'depart',
    objet: corps.objet || `Réponse — ${origine.objet}`,
    correspondant: corps.correspondant || origine.correspondant,
    organisme: corps.organisme === undefined ? origine.organisme : corps.organisme,
    reference_externe: origine.reference_externe,
    canal: corps.canal, nature: 'lettre', confidentiel: origine.confidentiel, document_id: corps.document_id,
  }, { reponseA: origine });
  await db.query(
    `INSERT INTO courrier_evenements (tenant_id, courrier_id, action, par, par_nom, note) VALUES ($1, $2, 'REPONSE_PREPAREE', $3, $4, $5)`,
    [user.tenant_id, origine.id, user.id, (await identite(user)).nom, `Courrier départ ${reponse.numero}`]);
  if (origine.statut === 'affecte' && origine.assigne_a === user.id) {
    await db.query(`UPDATE courriers SET statut = 'en_traitement' WHERE id = $1 AND statut = 'affecte'`, [origine.id]);
  }
  return reponse;
}

/** Constate l'expédition d'un départ ; clôt l'arrivée à laquelle il répond. */
function expedier(user, id, corps = {}) {
  return action(user, id, async ({ c, d0, qui, client }) => {
    if (c.statut !== 'brouillon') throw erreur(409, "Ce courrier n'est pas un départ en attente d'expédition.");
    if (!d0.gerer && !d0.enregistrer && c.created_by !== user.id) throw erreur(403, "Vous ne pouvez pas constater l'expédition de ce courrier.");
    const mode = texte(corps.mode, 80) || null;
    await client.query(`UPDATE courriers SET statut = 'expedie', expedie_at = now(), mode_expedition = $2, clos_at = now(), clos_motif = 'expedie' WHERE id = $1`, [c.id, mode]);
    await evenement(client, user.tenant_id, c.id, 'EXPEDIE', qui, mode);
    if (c.reponse_a_id) {
      const o = (await client.query(
        `UPDATE courriers SET statut = 'clos', clos_at = now(), clos_motif = 'repondu', updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND statut IN ('enregistre', 'affecte', 'en_traitement') RETURNING id`, [c.reponse_a_id, user.tenant_id])).rows[0];
      if (o) await evenement(client, user.tenant_id, o.id, 'CLOS', qui, `Répondu par le courrier départ ${c.numero}`);
    }
  });
}

/** Corrige la fiche (objet, correspondant, document lié…) tant que le courrier n'est pas clos. */
function modifier(user, id, corps = {}) {
  return action(user, id, async ({ c, d0, qui, client }) => {
    if (['clos', 'expedie'].includes(c.statut)) throw erreur(409, 'Un courrier clos ne se modifie plus.');
    if (!d0.registre && c.created_by !== user.id) throw erreur(403, 'Vous ne pouvez pas modifier ce courrier.');
    const { erreurs, valeurs: d } = lireSaisie({ ...c, date_courrier: c.date_courrier_txt, echeance: c.echeance_txt, ...corps, sens: c.sens });
    if (erreurs.length) throw erreur(400, erreurs.join(' '));
    if (d.document_id && !(await client.query('SELECT 1 FROM documents WHERE id = $1 AND tenant_id = $2', [d.document_id, user.tenant_id])).rows[0]) throw erreur(400, 'Document lié introuvable.');
    await client.query(
      `UPDATE courriers SET objet = $2, correspondant = $3, organisme = $4, reference_externe = $5, date_courrier = $6, canal = $7, nature = $8,
              urgent = $9, confidentiel = $10, reponse_attendue = $11, echeance = $12, document_id = $13 WHERE id = $1`,
      [c.id, d.objet, d.correspondant, d.organisme, d.reference_externe, d.date_courrier, d.canal, d.nature, d.urgent, d.confidentiel,
        d.reponse_attendue, d.echeance, d.document_id]);
    await evenement(client, user.tenant_id, c.id, 'MODIFIE', qui);
  });
}

/** Accusé de réception d'un courrier arrivée (PDF). Rend { numero, pdf }. */
async function accuseReception(user, id) {
  const c = await lire(user, id);
  if (!c.actions.accuse_reception) throw erreur(403, "Vous ne pouvez pas délivrer l'accusé de réception de ce courrier.");
  const { encodable, lignes } = require('./copieCertifieeService');
  const reglages = await settingsService.getAll(user.tenant_id);
  const organisation = reglages.legal_entity || (await db.query('SELECT name FROM tenants WHERE id = $1', [user.tenant_id])).rows[0]?.name || '';
  const qui = await identite(user);
  const doc = await PDFDocument.create();
  doc.setTitle(`Accusé de réception ${c.numero}`);
  doc.setProducer('DocuFlow');
  const police = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const x = 64;
  let y = 770;
  const ecrire = (t, { taille = 11, f = police, apres = 8, couleur = rgb(0.1, 0.1, 0.1) } = {}) => {
    for (const l of lignes(f, taille, t, 595.28 - 2 * x)) { page.drawText(l, { x, y, size: taille, font: f, color: couleur }); y -= taille * 1.5; }
    y -= apres;
  };
  ecrire(organisation.toUpperCase(), { taille: 11, f: gras, apres: 30 });
  ecrire('ACCUSÉ DE RÉCEPTION', { taille: 18, f: gras, apres: 2 });
  ecrire(`Courrier n° ${c.numero}`, { taille: 11, f: gras, couleur: rgb(0.3, 0.3, 0.3), apres: 24 });
  ecrire(`À l'attention de : ${c.correspondant}${c.organisme ? `, ${c.organisme}` : ''}`, { apres: 14 });
  ecrire(`Nous accusons réception de votre courrier${c.date_courrier ? ` du ${frDate(c.date_courrier)}` : ''}${c.reference_externe ? `, référence ${c.reference_externe}` : ''}, reçu le ${new Date(c.created_at).toLocaleDateString('fr-FR')} et enregistré sous le numéro ${c.numero}.`);
  ecrire(`Objet : ${c.objet}`);
  ecrire('Votre courrier a été transmis au service compétent. Merci de rappeler le numéro ci-dessus dans toute correspondance à ce sujet.', { apres: 28 });
  ecrire(`Fait le ${new Date().toLocaleDateString('fr-FR')}.`, { apres: 30 });
  ecrire(encodable(police, qui.nom), { f: gras, apres: 0 });
  ecrire('Service du courrier', { taille: 9.5, couleur: rgb(0.4, 0.4, 0.4) });
  const pdf = Buffer.from(await doc.save());
  if (!c.accuse_reception_at) {
    await db.query('UPDATE courriers SET accuse_reception_at = now() WHERE id = $1', [c.id]);
    await db.query(`INSERT INTO courrier_evenements (tenant_id, courrier_id, action, par, par_nom) VALUES ($1, $2, 'ACCUSE_RECEPTION', $3, $4)`,
      [user.tenant_id, c.id, qui.id, qui.nom]);
  }
  return { numero: c.numero, pdf };
}

/** Rappels : deux jours avant l'échéance, puis au dépassement. Rend le nombre de rappels. */
async function relancer() {
  let n = 0;
  const proches = (await db.query(
    `UPDATE courriers SET relance_at = now()
      WHERE statut IN ('affecte', 'en_traitement') AND assigne_a IS NOT NULL AND relance_at IS NULL
        AND echeance IS NOT NULL AND echeance <= CURRENT_DATE + 2 AND echeance >= CURRENT_DATE
      RETURNING id, tenant_id, numero, objet, assigne_a, to_char(echeance, 'DD/MM/YYYY') AS echeance`)).rows;
  for (const c of proches) { await notifier(c.tenant_id, [c.assigne_a], `Courrier ${c.numero} : échéance le ${c.echeance}`, c.objet, c.id); n += 1; }
  const retards = (await db.query(
    `UPDATE courriers SET retard_notifie_at = now()
      WHERE statut IN ('affecte', 'en_traitement') AND assigne_a IS NOT NULL AND retard_notifie_at IS NULL
        AND echeance IS NOT NULL AND echeance < CURRENT_DATE
      RETURNING id, tenant_id, numero, objet, assigne_a, created_by, to_char(echeance, 'DD/MM/YYYY') AS echeance`)).rows;
  for (const c of retards) { await notifier(c.tenant_id, [c.assigne_a, c.created_by], `Courrier ${c.numero} en retard`, `Échéance dépassée depuis le ${c.echeance} — ${c.objet}`, c.id); n += 1; }
  return n;
}

function demarrerCourrier() {
  const tour = () => relancer().catch((err) => { if (err.code !== '42P01') console.warn('[courrier] rappels différés :', err.message); });
  setTimeout(tour, 90000).unref();
  setInterval(tour, 60 * 60000).unref();
}

module.exports = {
  SENS, CANAUX, NATURES, MOTIFS_CLOTURE, lireSaisie, enRetard, agents, enregistrer, lire, lister, synthese, correspondants,
  affecter, prendreEnCharge, annoter, clore, repondre, expedier, modifier, accuseReception, relancer, demarrerCourrier,
};
