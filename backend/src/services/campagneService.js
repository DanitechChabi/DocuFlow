// ============================================================================
// campagneService — campagnes d'archivage périodiques (migration 044).
//
// Sans rendez-vous, l'archivage n'a lieu ni à la clôture des dossiers ni à
// date fixe : chacun garde ses documents sur son poste, et personne ne sait
// plus ce qui reste à décrire. La campagne revient à chaque période (réglage
// `archivage_campagne`) :
//   — chaque agent qui peut déposer des documents est invité à verser ceux de
//     ses dossiers clos, et apprend combien des siens attendent d'être décrits ;
//   — les gestionnaires des archives reçoivent le bilan : à décrire, sans
//     classe, hors du plan de classement, courants depuis plus de deux ans,
//     durée de conservation échue.
// Le bilan est gardé : d'une campagne à l'autre, on voit le retard se résorber.
// ============================================================================
const db = require('../config/db');
const settingsService = require('./settingsService');
const integrite = require('./integriteService');

const PERIODICITES = ['aucune', 'mensuelle', 'trimestrielle', 'semestrielle', 'annuelle'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const erreur = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

/** Période en cours pour une périodicité : 2026-11, 2026-T4, 2026-S2, 2026. Fonction pure. */
function periodeDe(date, periodicite) {
  const d = date instanceof Date ? date : new Date(date);
  const [annee, mois] = [d.getFullYear(), d.getMonth() + 1];
  if (periodicite === 'mensuelle') return `${annee}-${String(mois).padStart(2, '0')}`;
  if (periodicite === 'trimestrielle') return `${annee}-T${Math.ceil(mois / 3)}`;
  if (periodicite === 'semestrielle') return `${annee}-S${mois <= 6 ? 1 : 2}`;
  if (periodicite === 'annuelle') return String(annee);
  return null;
}

/** « 4e trimestre 2026 », « novembre 2026 », « 2e semestre 2026 », « année 2026 ». Fonction pure. */
function libellePeriode(periode) {
  const rang = (n) => (n === 1 ? '1er' : `${n}e`);
  let m = /^(\d{4})-T([1-4])$/.exec(periode || '');
  if (m) return `${rang(Number(m[2]))} trimestre ${m[1]}`;
  m = /^(\d{4})-S([12])$/.exec(periode || '');
  if (m) return `${rang(Number(m[2]))} semestre ${m[1]}`;
  m = /^(\d{4})-(\d{2})$/.exec(periode || '');
  if (m && MOIS[Number(m[2]) - 1]) return `${MOIS[Number(m[2]) - 1]} ${m[1]}`;
  return /^\d{4}$/.test(periode || '') ? `année ${periode}` : String(periode || '');
}

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

/** Message adressé aux gestionnaires des archives. Fonction pure. */
function messageBilan(b) {
  const lignes = [
    b.a_decrire && `${pluriel(b.a_decrire, 'document à décrire', 'documents à décrire')}`,
    b.sans_classe && `${pluriel(b.sans_classe, 'document sans classe', 'documents sans classe')}`,
    b.sans_dossier && `${pluriel(b.sans_dossier, 'document hors du plan de classement', 'documents hors du plan de classement')}`,
    b.courants_anciens && `${pluriel(b.courants_anciens, 'document courant depuis plus de deux ans', 'documents courants depuis plus de deux ans')}`,
    b.echus && `${pluriel(b.echus, 'document dont la durée de conservation est échue', 'documents dont la durée de conservation est échue')}`,
  ].filter(Boolean);
  const invites = `${pluriel(b.agents_prevenus, 'agent invité', 'agents invités')} à verser ses dossiers clos.`;
  return lignes.length ? `${invites} Reste à traiter : ${lignes.join(' ; ')}.` : `${invites} Rien n'attend : tout est décrit, classé et dans les délais.`;
}

/** Ce qui reste à faire dans l'organisation, à l'instant. */
async function bilan(tenantId) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE statut = 'à indexer')::int AS a_decrire,
            count(*) FILTER (WHERE statut <> 'à indexer' AND classe_id IS NULL)::int AS sans_classe,
            count(*) FILTER (WHERE dossier_id IS NULL)::int AS sans_dossier,
            count(*) FILTER (WHERE statut IN ('disponible', 'prêt')
                               AND COALESCE(date_document, created_at::date) < CURRENT_DATE - INTERVAL '2 years')::int AS courants_anciens
       FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL AND elimine_at IS NULL`, [tenantId]);
  const echus = await require('./archivageService').compterEchus(tenantId).catch(() => 0);
  return { ...rows[0], echus };
}

async function notifier(tenantId, userId, titre, message, lien) {
  await db.query(
    "INSERT INTO notifications (tenant_id, id_user, title, message, type, lien) VALUES ($1, $2, $3, $4, 'archives', $5)",
    [tenantId, userId, titre.slice(0, 255), message, lien]
  ).catch((err) => console.warn('[campagne] notification non enregistrée :', err.message));
}

/**
 * Lance (ou relance) la campagne de la période en cours.
 * @param {{ user?: object|null, date?: Date }} options user absent : lancée par DocuFlow, à l'échéance
 * @returns {Promise<object>} la campagne, avec `nouvelle`
 */
async function lancer(tenantId, { user = null, date = new Date() } = {}) {
  const reglage = await settingsService.get(tenantId, 'archivage_campagne', 'trimestrielle');
  // Lancée à la main alors que le rendez-vous périodique est coupé : campagne du trimestre.
  const periodicite = PERIODICITES.includes(reglage) && reglage !== 'aucune' ? reglage : (user ? 'trimestrielle' : null);
  if (!periodicite) throw erreur(409, "Les campagnes d'archivage sont désactivées.");
  const periode = periodeDe(date, periodicite);
  const qui = user ? await integrite.identite(user) : null;

  const gestionnaires = new Set(await integrite.destinataires(tenantId, 'archives.manage'));
  const deposants = (await integrite.destinataires(tenantId, 'documents.upload')).filter((id) => !gestionnaires.has(id));
  const techniques = new Set((await db.query("SELECT id FROM users WHERE tenant_id = $1 AND username LIKE 'portail-citoyen-%'", [tenantId])).rows.map((r) => r.id));
  const agents = deposants.filter((id) => !techniques.has(id));
  const etat = { ...(await bilan(tenantId)), agents_prevenus: agents.length };

  const { rows } = await db.query(
    `INSERT INTO campagnes_archivage (tenant_id, periode, periodicite, lancee_par, lancee_par_nom, bilan)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, periode) DO UPDATE
        SET rappels = campagnes_archivage.rappels + 1, dernier_rappel_at = now(), bilan = EXCLUDED.bilan
     RETURNING *, (xmax = 0) AS nouvelle`,
    [tenantId, periode, periodicite, qui ? qui.id : null, qui ? qui.nom : null, JSON.stringify(etat)]
  );
  const campagne = rows[0];
  const titre = `${campagne.nouvelle ? "Campagne d'archivage" : "Rappel — campagne d'archivage"} : ${libellePeriode(periode)}`;

  const aDecrire = new Map((await db.query(
    `SELECT created_by, count(*)::int AS n FROM documents
      WHERE tenant_id = $1 AND deleted_at IS NULL AND elimine_at IS NULL AND (statut = 'à indexer' OR classe_id IS NULL)
        AND created_by = ANY($2::int[]) GROUP BY created_by`, [tenantId, agents])).rows.map((r) => [r.created_by, r.n]));
  for (const id of agents) {
    const n = aDecrire.get(id) || 0;
    await notifier(tenantId, id, titre,
      `Versez dans DocuFlow les documents de vos dossiers clos qui sont encore sur votre poste, dans votre messagerie ou dans une armoire.${n ? ` ${pluriel(n, 'document que vous avez déposé attend', 'documents que vous avez déposés attendent')} encore d'être décrits.` : ''}`,
      '/documents/liste');
  }
  for (const id of gestionnaires) {
    if (!techniques.has(id)) await notifier(tenantId, id, titre, messageBilan(etat), '/documents/outils?vue=campagnes');
  }
  await db.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json)
     VALUES ($1, $2, $3, $4, 'campagne_archivage', $5, $6)`,
    [tenantId, qui ? qui.id : null, qui ? qui.username : 'docuflow', campagne.nouvelle ? 'CAMPAGNE_ARCHIVAGE_LANCEE' : 'CAMPAGNE_ARCHIVAGE_RELANCEE',
      campagne.id, JSON.stringify({ periode, ...etat })]
  ).catch((err) => console.warn('[campagne] journal :', err.message));
  return versCampagne(campagne);
}

const versCampagne = (c) => ({
  id: c.id, periode: c.periode, libelle: libellePeriode(c.periode), periodicite: c.periodicite, lancee_at: c.lancee_at,
  lancee_par: c.lancee_par_nom || null, rappels: c.rappels, dernier_rappel_at: c.dernier_rappel_at, bilan: c.bilan || {},
  ...(c.nouvelle === undefined ? {} : { nouvelle: c.nouvelle }),
});

/** Les campagnes de l'organisation, la plus récente d'abord. */
async function lister(tenantId, limite = 12) {
  const { rows } = await db.query('SELECT * FROM campagnes_archivage WHERE tenant_id = $1 ORDER BY lancee_at DESC LIMIT $2', [tenantId, limite]);
  return rows.map(versCampagne);
}

/**
 * Tour de garde : lance la campagne de chaque organisation dont la période
 * vient de s'ouvrir. `seulement` borne le tour à quelques organisations (tests).
 */
async function tour(date = new Date(), seulement = null) {
  const { rows } = await db.query("SELECT id FROM tenants WHERE status = 'active' AND ($1::int[] IS NULL OR id = ANY($1::int[]))", [seulement]);
  let lancees = 0;
  for (const t of rows) {
    const periodicite = await settingsService.get(t.id, 'archivage_campagne', 'trimestrielle');
    const periode = periodeDe(date, periodicite);
    if (!periode) continue;
    const deja = await db.query('SELECT 1 FROM campagnes_archivage WHERE tenant_id = $1 AND periode = $2', [t.id, periode]);
    if (deja.rows[0]) continue;
    // Une organisation sans document ni équipe n'a rien à archiver.
    const vivante = await db.query('SELECT 1 FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1', [t.id]);
    if (!vivante.rows[0]) continue;
    await lancer(t.id, { date });
    lancees += 1;
  }
  return lancees;
}

function demarrer() {
  const passe = () => tour().catch((err) => { if (err.code !== '42P01') console.warn('[campagne] tour différé :', err.message); });
  setTimeout(passe, 120000).unref();
  setInterval(passe, 6 * 60 * 60000).unref();
}

module.exports = { PERIODICITES, periodeDe, libellePeriode, messageBilan, bilan, lancer, lister, tour, demarrer };
