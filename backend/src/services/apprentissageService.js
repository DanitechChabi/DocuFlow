// ============================================================================
// DocuBot apprend de l'usage (056).
//
// Chaque question est gardée avec ce que DocuBot a compris. Deux sources
// d'exemples nouveaux :
//   - l'avis de la personne (« Utile » / « Pas ça », et ce qu'elle voulait) ;
//   - la correction de l'archive, dans la page « DocuBot apprend ».
// Le modèle des intentions de l'organisation est réentraîné aussitôt après
// une correction, et chaque nuit (avec effacement des échanges de plus d'un an).
// ============================================================================

const db = require('../config/db');
const intentions = require('./intentionService');

function erreur(statut, message) {
  const e = new Error(message);
  e.statut = statut;
  return e;
}

// Ce que l'archive peut choisir, et le libellé montré.
const CHOIX = {
  ou_est: 'Trouver un dossier',
  qui_a: 'Savoir qui a un dossier',
  mes_demandes: 'Suivre mes demandes',
  retards: 'Retards, dossiers à rendre',
  journee: 'Le travail du jour (archive)',
  chiffres: 'Des chiffres',
  semaine: 'Les entrées d\'une semaine ou d\'un jour',
  aide: 'Comment faire',
  salut: 'Bonjour, merci',
  autre: 'Hors sujet',
};
// Intentions de DocuBot → étiquettes du modèle.
const VERS_ETIQUETTE = { demander: 'ou_est', merci: 'salut', hors_sujet: 'autre' };
const etiquette = (i) => VERS_ETIQUETTE[i] || (CHOIX[i] ? i : null);

/** Garde un échange ; rend son id (null si la base ne suit pas : DocuBot répond quand même). */
async function noter(tenantId, userId, question, { intention, confiance = null, source = null } = {}) {
  try {
    const r = await db.query(
      `INSERT INTO docubot_echanges (tenant_id, user_id, question, intention, confiance, source)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, userId || null, String(question).slice(0, 500), intention || null, confiance, source]
    );
    return r.rows[0].id;
  } catch (err) {
    if (err.code !== '42P01') console.error('[docubot] échange non gardé :', err.message);
    return null;
  }
}

let minuteur = null;
/** Réentraîne bientôt (plusieurs avis d'affilée : un seul réentraînement). */
function bientot(tenantId) {
  clearTimeout(minuteur);
  minuteur = setTimeout(() => reentrainer(tenantId).catch((err) => console.error("[docubot] réentraînement :", err.message)), 500);
  minuteur.unref?.();
}

/** L'avis de la personne sur une réponse : utile, ou non (et, si elle le dit, ce qu'elle voulait). */
async function avis(tenantId, userId, id, { utile, voulait } = {}) {
  const correction = voulait && CHOIX[voulait] ? voulait : null;
  const r = await db.query(
    `UPDATE docubot_echanges SET utile = $4, correction = COALESCE($5, correction), corrige_par = CASE WHEN $5::text IS NULL THEN corrige_par ELSE $3 END,
            corrige_le = CASE WHEN $5::text IS NULL THEN corrige_le ELSE now() END
      WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING id`,
    [Number(id), tenantId, userId, Boolean(utile), correction]
  );
  if (!r.rowCount) throw erreur(404, 'Échange introuvable.');
  bientot(tenantId);
  return { ok: true };
}

/** La correction de l'archive : ce que la question voulait dire, ou « ignorer ». */
async function corriger(tenantId, user, id, intention) {
  if (intention !== 'ignorer' && !CHOIX[intention]) throw erreur(400, 'Choix inconnu.');
  const r = await db.query(
    `UPDATE docubot_echanges SET correction = $3, corrige_par = $4, corrige_le = now()
      WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [Number(id), tenantId, intention, user.id]
  );
  if (!r.rowCount) throw erreur(404, 'Échange introuvable.');
  bientot(tenantId);
  return { ok: true };
}

/**
 * Les questions à revoir (jugées « pas ça », ou comprises sans assurance), et
 * le bilan des 30 derniers jours. L'auteur d'une question n'est pas montré.
 */
async function aRevoir(tenantId) {
  const [liste, bilan] = await Promise.all([
    db.query(
      `SELECT id, question, intention, confiance, source, utile, to_char(cree_le, 'YYYY-MM-DD') AS le
         FROM docubot_echanges
        WHERE tenant_id = $1 AND correction IS NULL AND cree_le > now() - interval '90 days'
          AND (utile = false OR intention IN ('inconnu', 'hors_sujet') OR (confiance IS NOT NULL AND confiance < 0.6 AND utile IS NOT TRUE))
        ORDER BY (utile = false) DESC NULLS LAST, cree_le DESC LIMIT 100`,
      [tenantId]
    ),
    db.query(
      `SELECT count(*)::int AS questions,
              count(*) FILTER (WHERE utile)::int AS utiles,
              count(*) FILTER (WHERE utile = false)::int AS pas_utiles,
              count(*) FILTER (WHERE correction IS NOT NULL AND correction <> 'ignorer')::int AS corrigees
         FROM docubot_echanges WHERE tenant_id = $1 AND cree_le > now() - interval '30 days'`,
      [tenantId]
    ),
  ]);
  return { questions: liste.rows, bilan: bilan.rows[0], modele: intentions.etatEspace(tenantId), choix: CHOIX };
}

/** Les exemples tirés de l'usage : corrections, et réponses jugées utiles. */
async function exemples(tenantId) {
  const r = await db.query(
    `SELECT question, COALESCE(correction, intention) AS intention FROM docubot_echanges
      WHERE tenant_id = $1 AND COALESCE(correction, '') <> 'ignorer'
        AND (correction IS NOT NULL OR utile = true)
      ORDER BY cree_le DESC LIMIT 5000`,
    [tenantId]
  );
  return r.rows.map((x) => ({ question: x.question, intention: etiquette(x.intention) })).filter((x) => x.intention);
}

/** Réentraîne le modèle d'une organisation sur ses exemples. */
async function reentrainer(tenantId) {
  const ex = await exemples(tenantId);
  intentions.entrainerEspace(tenantId, ex);
  return { exemples: ex.length };
}

/** Au démarrage, puis chaque nuit : réentraîne chaque organisation et efface les échanges de plus d'un an. */
async function nuit() {
  try {
    await db.query("DELETE FROM docubot_echanges WHERE cree_le < now() - interval '365 days'");
    const r = await db.query('SELECT DISTINCT tenant_id FROM docubot_echanges');
    for (const { tenant_id: t } of r.rows) await reentrainer(t);
  } catch (err) {
    if (err.code !== '42P01') console.error('[docubot] apprentissage de la nuit :', err.message);
  }
}

function demarrer() {
  nuit();
  let dernier = new Date().toDateString();
  const t = setInterval(() => {
    const maintenant = new Date();
    // Vers 2 h du matin (heure du serveur), une fois par jour.
    if (maintenant.getHours() === 2 && maintenant.toDateString() !== dernier) {
      dernier = maintenant.toDateString();
      nuit();
    }
  }, 15 * 60 * 1000);
  t.unref?.();
}

module.exports = { CHOIX, etiquette, noter, avis, corriger, aRevoir, exemples, reentrainer, nuit, demarrer };
