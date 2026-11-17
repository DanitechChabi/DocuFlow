// ============================================================================
// mfilesService — dossiers déjà numérisés dans M-Files.
//
// L'organisation indique les années numérisées (réglage mfiles_annees, ex.
// « 2025 ») et, si elle le souhaite, l'adresse de M-Files Web (mfiles_url).
// Pour un dossier de ces années, le papier ne sort plus : l'archiviste envoie
// la copie depuis M-Files, puis note ici « Servi par M-Files ». La demande est
// close (statut « livré »), le demandeur prévenu (cloche, courriel).
// ============================================================================
const db = require('../config/db');
const settingsService = require('./settingsService');
const loanService = require('./loanService');
const mailService = require('./mailService');
const { libelleDemande } = require('../helpers/requestInput');

function erreur(statut, message) {
  const e = new Error(message);
  e.statut = statut;
  return e;
}

/** Années numérisées (« 2025, 2024 » → [2025, 2024]). */
function lireAnnees(valeur) {
  return [...new Set(String(valeur || '').split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1950 && n <= 2100))];
}

async function annees(tenantId) {
  return lireAnnees((await settingsService.getAll(tenantId)).mfiles_annees);
}

/** Note qu'une demande a été servie par une copie envoyée depuis M-Files. */
async function servir(tenantId, user, id, { note } = {}) {
  const n = Number(id);
  if (!Number.isInteger(n)) throw erreur(400, 'Demande invalide.');
  const request = (await db.query('SELECT * FROM requests WHERE id = $1 AND tenant_id = $2', [n, tenantId])).rows[0];
  if (!request) throw erreur(404, 'Demande non trouvée.');
  if (!['en attente', 'a traiter'].includes(request.statut)) throw erreur(409, 'Cette demande n\'attend plus d\'être servie.');
  if (await loanService.pretDeLaDemande(tenantId, n)) throw erreur(409, 'Le dossier papier a déjà été transmis pour cette demande.');
  const mot = note ? String(note).replace(/\s+/g, ' ').trim().slice(0, 500) : null;
  await db.query("UPDATE requests SET statut = 'livré', date_livraison = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2", [n, tenantId]);
  try {
    await db.query(
      `INSERT INTO request_history (request_id, user_id, action, previous_status, new_status, comment, user_name, tenant_id)
       VALUES ($1, $2, 'Servi par M-Files', $3, 'livré', $4, $5, $6)`,
      [n, user.id, request.statut, mot, (user.full_name || '').slice(0, 100) || null, tenantId]
    );
  } catch (err) { if (err.code !== '42P01') throw err; }
  await loanService.notifier(db, tenantId, request.id_user, 'Copie envoyée depuis M-Files',
    `La copie numérique de ${libelleDemande(request)} vous a été envoyée depuis M-Files${mot ? ` : ${mot}` : ''}.`.slice(0, 1000), 'delivered', n);
  await db.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, $3, $4)',
    [user.id, `A servi par M-Files la demande ${libelleDemande(request)}`.slice(0, 500), n, tenantId]);
  mailService.notifierComptes(tenantId, [request.id_user], 'servi_mfiles', { ...request, statut: 'livré' }, { note: mot, par: user.full_name || null });
  return { ...request, statut: 'livré' };
}

module.exports = { lireAnnees, annees, servir };
