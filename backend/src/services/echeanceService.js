// ============================================================================
// echeanceService — échéancier des documents (migration 035).
//
//   SOURCES   'manuelle' (posée depuis la fiche), 'metadonnee' (propriété
//             DATE marquée échéance : metadata_fields.est_echeance) et
//             'analyse' (date d'échéance lue par l'analyse, migration 030).
//             La dérivation est idempotente : une ligne par document et par
//             source (cle_source), mise à jour si la date change — le cycle
//             de rappel repart alors.
//   RAPPELS   à J-n (rappel_jours_avant, sinon echeances_rappel_jours), puis
//             le jour même, une fois chacun. « Reporter » diffère jusqu'à
//             reporte_au, où une relance unique est envoyée.
//   PÉRIMÈTRE une échéance n'est montrée, ni notifiée, qu'à qui peut lire
//             le document (ACL du dossier).
// ============================================================================
const db = require('../config/db');
const aclService = require('./aclService');
const integrite = require('./integriteService');

const STATUTS = ['a_venir', 'notifiee', 'traitee', 'annulee'];
const RAPPEL_DEFAUT = 15;

const erreur = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const texte = (v) => (v === null || v === undefined ? '' : String(v).trim());

let migrationPromesse = null;
function migrationPassee() {
  if (!migrationPromesse) {
    migrationPromesse = db.query("SELECT to_regclass('document_echeances') IS NOT NULL AS ok")
      .then((r) => r.rows[0].ok).catch(() => { migrationPromesse = null; return false; });
  }
  return migrationPromesse;
}

function dateValide(v, nom = 'date') {
  const s = texte(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) throw erreur(400, `${nom} invalide (AAAA-MM-JJ).`);
  return s;
}

function versEcheance(e) {
  return {
    id: e.id, document_id: e.document_id, reference_mfile: e.reference_mfile, nom_entreprise: e.nom_entreprise,
    date_echeance: e.date_echeance, libelle: e.libelle, note: e.note, source: e.source,
    rappel_jours_avant: e.rappel_jours_avant, destinataire_id: e.destinataire_id, destinataire_nom: e.destinataire_nom,
    statut: e.statut, reporte_au: e.reporte_au, traitee_par: e.traitee_par_nom, traitee_at: e.traitee_at, commentaire: e.commentaire,
    en_retard: ['a_venir', 'notifiee'].includes(e.statut) && String(e.date_echeance).slice(0, 10) < new Date().toISOString().slice(0, 10),
  };
}

const SELECT = `SELECT e.*, to_char(e.date_echeance, 'YYYY-MM-DD') AS date_echeance, to_char(e.reporte_au, 'YYYY-MM-DD') AS reporte_au,
                       d.reference_mfile, d.nom_entreprise, d.dossier_id, u.full_name AS destinataire_nom
                  FROM document_echeances e
                  JOIN documents d ON d.id = e.document_id AND d.tenant_id = e.tenant_id
                  LEFT JOIN users u ON u.id = e.destinataire_id`;

/** Échéancier de l'organisation, borné au périmètre. vue : a_venir | en_retard | traitees | toutes. */
async function lister(tenantId, user, { vue = 'a_venir', mois = null } = {}) {
  if (!(await migrationPassee())) return [];
  const conditions = ['e.tenant_id = $1', 'd.deleted_at IS NULL'];
  const params = [tenantId];
  if (vue === 'traitees') conditions.push("e.statut IN ('traitee', 'annulee')");
  else if (vue === 'en_retard') conditions.push("e.statut IN ('a_venir', 'notifiee') AND e.date_echeance < CURRENT_DATE");
  else if (vue !== 'toutes') conditions.push("e.statut IN ('a_venir', 'notifiee')");
  if (mois && /^\d{4}-\d{2}$/.test(mois)) {
    params.push(`${mois}-01`);
    conditions.push(`date_trunc('month', e.date_echeance) = $${params.length}::date`);
  }
  const { rows } = await db.query(`${SELECT} WHERE ${conditions.join(' AND ')} ORDER BY e.date_echeance, e.id LIMIT 1000`, params);
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  return rows.filter((e) => e.dossier_id === null || lisibles.has(e.dossier_id)).map(versEcheance);
}

async function deDocument(tenantId, documentId) {
  if (!(await migrationPassee())) return [];
  const { rows } = await db.query(`${SELECT} WHERE e.tenant_id = $1 AND e.document_id = $2 ORDER BY e.statut IN ('traitee', 'annulee'), e.date_echeance`, [tenantId, documentId]);
  return rows.map(versEcheance);
}

async function charger(tenantId, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw erreur(400, 'Identifiant invalide.');
  const { rows } = await db.query(`${SELECT} WHERE e.tenant_id = $1 AND e.id = $2`, [tenantId, n]);
  if (!rows[0]) throw erreur(404, 'Échéance introuvable.');
  return rows[0];
}

/** Le document de l'échéance est-il lisible par l'utilisateur ? (sinon 404 : rien n'est révélé) */
async function chargerLisible(tenantId, id, user) {
  const e = await charger(tenantId, id);
  if (!(await aclService.peutLire(tenantId, user.id, e.dossier_id))) throw erreur(404, 'Échéance introuvable.');
  return e;
}

async function creer(tenantId, documentId, user, corps = {}) {
  const libelle = texte(corps.libelle);
  if (!libelle) throw erreur(400, "Le libellé de l'échéance est obligatoire (ex. Renouvellement du contrat).");
  if (libelle.length > 200) throw erreur(400, 'Libellé trop long (200 caractères au plus).');
  const date = dateValide(corps.date_echeance, "Date d'échéance");
  let rappel = null;
  if (corps.rappel_jours_avant !== undefined && corps.rappel_jours_avant !== null && corps.rappel_jours_avant !== '') {
    rappel = Number(corps.rappel_jours_avant);
    if (!Number.isInteger(rappel) || rappel < 0 || rappel > 365) throw erreur(400, 'Rappel : entre 0 et 365 jours avant.');
  }
  let destinataire = user.id;
  if (corps.destinataire_id) {
    const { rows } = await db.query('SELECT id FROM users WHERE id = $1 AND tenant_id = $2', [Number(corps.destinataire_id), tenantId]);
    if (!rows[0]) throw erreur(400, 'Destinataire inconnu.');
    destinataire = rows[0].id;
  }
  const note = texte(corps.note).slice(0, 2000) || null;
  const { rows } = await db.query(
    `INSERT INTO document_echeances (tenant_id, document_id, date_echeance, libelle, note, source, rappel_jours_avant, destinataire_id, created_by)
     VALUES ($1, $2, $3, $4, $5, 'manuelle', $6, $7, $8) RETURNING id`,
    [tenantId, documentId, date, libelle, note, rappel, destinataire, user.id]
  );
  await require('./documentIndexService').logHistory(tenantId, documentId, user.id, `Échéance ajoutée : ${libelle}`.slice(0, 100), null, null, `Au ${date}`);
  return versEcheance(await charger(tenantId, rows[0].id));
}

async function changerStatut(tenantId, id, user, statut, { commentaire = null } = {}) {
  const e = await chargerLisible(tenantId, id, user);
  if (['traitee', 'annulee'].includes(e.statut)) throw erreur(409, 'Cette échéance est déjà close.');
  const qui = await integrite.identite(user);
  await db.query(
    `UPDATE document_echeances SET statut = $3, traitee_par = $4, traitee_par_nom = $5, traitee_at = now(), commentaire = $6, updated_at = now()
      WHERE id = $1 AND tenant_id = $2`,
    [e.id, tenantId, statut, qui.id, qui.nom, texte(commentaire).slice(0, 2000) || null]
  );
  return versEcheance(await charger(tenantId, e.id));
}
const traiter = (tenantId, id, user, corps = {}) => changerStatut(tenantId, id, user, 'traitee', corps);
const annuler = (tenantId, id, user, corps = {}) => changerStatut(tenantId, id, user, 'annulee', corps);

/** Reporter les rappels jusqu'à une date (une relance unique sera envoyée ce jour-là). */
async function reporter(tenantId, id, user, { au } = {}) {
  const e = await chargerLisible(tenantId, id, user);
  if (['traitee', 'annulee'].includes(e.statut)) throw erreur(409, 'Cette échéance est déjà close.');
  const date = dateValide(au, 'Date de report');
  if (date <= new Date().toISOString().slice(0, 10)) throw erreur(400, 'Le report doit viser une date future.');
  await db.query('UPDATE document_echeances SET reporte_au = $3, relance_envoyee_at = NULL, updated_at = now() WHERE id = $1 AND tenant_id = $2', [e.id, tenantId, date]);
  return versEcheance(await charger(tenantId, e.id));
}

/** Supprimer une échéance MANUELLE (les dérivées suivent leur source). */
async function supprimer(tenantId, id, user) {
  const e = await chargerLisible(tenantId, id, user);
  if (e.source !== 'manuelle') throw erreur(409, "Une échéance tirée d'une propriété ou de l'analyse suit sa source : annulez-la plutôt.");
  await db.query('DELETE FROM document_echeances WHERE id = $1 AND tenant_id = $2', [e.id, tenantId]);
  return { supprimee: true };
}

// --------------------------------------------------------------- dérivation

/**
 * Dérive les échéances des propriétés DATE marquées « échéance » et de
 * l'analyse. Idempotent ; une date changée relance le cycle de rappel.
 * @returns {Promise<number>} lignes créées ou mises à jour
 */
async function deriver({ tenantId = null, documentId = null } = {}) {
  if (!(await migrationPassee())) return 0;
  const analyse = (await db.query("SELECT to_regclass('document_extractions') IS NOT NULL AS ok")).rows[0].ok;
  const sources = [
    `SELECT d.tenant_id, d.id AS document_id, 'champ:' || f.id AS cle_source, 'metadonnee' AS source, f.id AS champ_id,
            left(f.label, 200) AS libelle, left(v.value_json #>> '{}', 10)::date AS date_echeance, d.created_by
       FROM metadata_values v
       JOIN metadata_fields f ON f.id = v.field_id AND f.est_echeance AND f.type = 'date'
       JOIN documents d ON d.id = v.document_id
      WHERE (v.value_json #>> '{}') ~ '^\\d{4}-\\d{2}-\\d{2}'`,
  ];
  if (analyse) {
    sources.push(
      `SELECT d.tenant_id, d.id, 'analyse', 'analyse', NULL::int,
              CASE x.nature WHEN 'attestation' THEN 'Fin de validité de l''attestation' WHEN 'facture' THEN 'Échéance de paiement' ELSE 'Échéance lue dans le document' END,
              left(x.donnees->>'date_echeance', 10)::date, d.created_by
         FROM document_extractions x JOIN documents d ON d.id = x.document_id AND d.tenant_id = x.tenant_id
        WHERE (x.donnees->>'date_echeance') ~ '^\\d{4}-\\d{2}-\\d{2}'`
    );
  }
  const { rowCount } = await db.query(
    `INSERT INTO document_echeances (tenant_id, document_id, cle_source, source, champ_id, libelle, date_echeance, destinataire_id)
     SELECT s.tenant_id, s.document_id, s.cle_source, s.source, s.champ_id, s.libelle, s.date_echeance, s.created_by
       FROM (${sources.join(' UNION ALL ')}) s
       JOIN documents d ON d.id = s.document_id
      WHERE d.deleted_at IS NULL
        AND ($1::int IS NULL OR s.tenant_id = $1) AND ($2::int IS NULL OR s.document_id = $2)
     ON CONFLICT (document_id, cle_source) WHERE cle_source IS NOT NULL
     DO UPDATE SET date_echeance = EXCLUDED.date_echeance, libelle = EXCLUDED.libelle, statut = 'a_venir',
                   rappel_envoye_at = NULL, echeance_envoyee_at = NULL, reporte_au = NULL, relance_envoyee_at = NULL,
                   traitee_par = NULL, traitee_par_nom = NULL, traitee_at = NULL, updated_at = now()
      WHERE document_echeances.date_echeance IS DISTINCT FROM EXCLUDED.date_echeance`,
    [tenantId, documentId]
  );
  return rowCount;
}

// ------------------------------------------------------------------ rappels

async function notifier(e, titre, message) {
  if (!e.destinataire_id) return false;
  if (!(await aclService.peutLire(e.tenant_id, e.destinataire_id, e.dossier_id))) return false;
  await db.query(
    `INSERT INTO notifications (id_user, title, message, type, tenant_id, document_id) VALUES ($1, $2, $3, 'echeance', $4, $5)`,
    [e.destinataire_id, titre.slice(0, 255), message, e.tenant_id, e.document_id]
  ).catch((err) => console.warn('[échéances] notification non enregistrée :', err.message));
  return true;
}

/**
 * Rappels dus : J-n (une fois), jour J (une fois), fin de report (une fois).
 * Chaque envoi est réservé par UPDATE … RETURNING : jamais deux fois.
 */
async function envoyerRappels({ tenantId = null } = {}) {
  if (!(await migrationPassee())) return 0;
  const delai = `COALESCE(e.rappel_jours_avant, (SELECT CASE WHEN s.value ~ '^[0-9]{1,3}$' THEN s.value::int END FROM settings s
                   WHERE s.tenant_id = e.tenant_id AND s.key = 'echeances_rappel_jours'), ${RAPPEL_DEFAUT})`;
  const actif = `e.statut IN ('a_venir', 'notifiee') AND ($1::int IS NULL OR e.tenant_id = $1)
                 AND EXISTS (SELECT 1 FROM documents d WHERE d.id = e.document_id AND d.deleted_at IS NULL)`;
  const reserve = async (condition, colonne) => (await db.query(
    `UPDATE document_echeances e SET ${colonne} = now(), statut = 'notifiee', updated_at = now()
      WHERE ${actif} AND ${condition}
      RETURNING e.*, to_char(e.date_echeance, 'DD/MM/YYYY') AS date_fr,
                (SELECT reference_mfile FROM documents WHERE id = e.document_id) AS reference_mfile,
                (SELECT dossier_id FROM documents WHERE id = e.document_id) AS dossier_id`,
    [tenantId]
  )).rows;
  let n = 0;
  const reportEnCours = '(e.reporte_au IS NULL OR e.reporte_au <= CURRENT_DATE)';
  for (const e of await reserve(`e.rappel_envoye_at IS NULL AND e.date_echeance > CURRENT_DATE AND e.date_echeance - ${delai} <= CURRENT_DATE AND ${reportEnCours}`, 'rappel_envoye_at')) {
    if (await notifier(e, `Échéance le ${e.date_fr} : ${e.libelle}`, `${e.reference_mfile} — ${e.libelle}, à échéance le ${e.date_fr}.`)) n += 1;
  }
  for (const e of await reserve(`e.echeance_envoyee_at IS NULL AND e.date_echeance <= CURRENT_DATE AND ${reportEnCours}`, 'echeance_envoyee_at')) {
    if (await notifier(e, `Échéance atteinte : ${e.libelle}`, `${e.reference_mfile} — ${e.libelle} : échéance du ${e.date_fr}.`)) n += 1;
  }
  for (const e of await reserve('e.reporte_au IS NOT NULL AND e.reporte_au <= CURRENT_DATE AND e.relance_envoyee_at IS NULL', 'relance_envoyee_at')) {
    if (await notifier(e, `Relance : ${e.libelle}`, `${e.reference_mfile} — ${e.libelle} (échéance du ${e.date_fr}), reportée jusqu'à aujourd'hui.`)) n += 1;
  }
  return n;
}

/** Tâche de fond : dérivation et rappels, toutes les heures. */
function demarrerEcheances() {
  const tour = async () => {
    try {
      await deriver();
      const n = await envoyerRappels();
      if (n) console.log(`[échéances] ${n} rappel(s) envoyé(s)`);
    } catch (err) {
      console.warn('[échéances] passage différé :', err.message);
    }
    setTimeout(tour, 3600000).unref();
  };
  setTimeout(tour, 150000).unref();
}

module.exports = {
  STATUTS, migrationPassee, lister, deDocument, creer, traiter, annuler, reporter, supprimer,
  deriver, envoyerRappels, demarrerEcheances, versEcheance,
};
