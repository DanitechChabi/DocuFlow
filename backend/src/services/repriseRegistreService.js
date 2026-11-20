// ============================================================================
// Reprise du registre papier des sorties (059).
//
// Les sorties notées à la main avant l'application entrent dans « Dossiers
// sortis » telles quelles : date de sortie, client, acte, motif, emprunteur
// (nom écrit au registre, avec ou sans compte), retour s'il est noté. Rien
// n'est notifié ni relancé : ce sont des faits passés. Une ligne déjà reprise
// est ignorée (empreinte), un registre complété peut donc être réimporté.
// ============================================================================
const crypto = require('crypto');
const db = require('../config/db');
const settingsService = require('./settingsService');
const { dureeMotif, enTransaction } = require('./loanService');

const LIMITE = 1000;
function erreur(statut, message) { const e = new Error(message); e.statut = statut; return e; }
const texte = (v, max) => {
  const s = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const jour = (v) => {
  const s = texte(v, 10);
  const m = s && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : null;
};
const plusJours = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * @param {object[]} lignes [{ date_sortie, nom_entreprise, num_acte, annee, type_document, reference,
 *   date_acte, motif, emprunteur, date_retour, retourne, observation }]
 */
async function importer(tenantId, user, { fichier, lignes } = {}) {
  if (!Array.isArray(lignes) || !lignes.length) throw erreur(400, 'Aucune ligne à reprendre.');
  if (lignes.length > LIMITE) throw erreur(400, `Au plus ${LIMITE} lignes par envoi.`);
  const reglages = await settingsService.getAll(tenantId);
  const defaut = Number(reglages.loan_default_days) > 0 ? Number(reglages.loan_default_days) : 15;
  const source = texte(fichier, 200) || 'registre papier';
  const res = { ajoutees: 0, deja: 0, rejetees: [] };
  await enTransaction(async (client) => {
    for (const [i, l] of lignes.entries()) {
      const sortie = jour(l.date_sortie);
      const nom = texte(l.nom_entreprise, 255);
      if (!sortie || !nom) { res.rejetees.push({ ligne: i + 1, raison: !sortie ? 'date de sortie invalide' : 'client manquant' }); continue; }
      let retour = l.retourne ? (jour(l.date_retour) || sortie) : null;
      if (retour && retour < sortie) retour = sortie;
      const motif = texte(l.motif, 100) || 'Non précisé';
      const annee = Number(l.annee) >= 1950 && Number(l.annee) <= 2100 ? Number(l.annee) : null;
      const empreinte = crypto.createHash('sha256').update(JSON.stringify([sortie, nom, texte(l.num_acte, 50), annee, motif, texte(l.emprunteur, 255)])).digest('hex');
      const deja = await client.query('SELECT 1 FROM request_loans WHERE tenant_id = $1 AND reprise_empreinte = $2', [tenantId, empreinte]);
      if (deja.rows[0]) { res.deja += 1; continue; }
      const obs = [texte(l.date_acte, 60) && `Acte du ${texte(l.date_acte, 60)}`, texte(l.observation, 600)].filter(Boolean).join(' · ');
      const q = (await client.query(
        `INSERT INTO requests (tenant_id, id_user, nom_entreprise, num_acte, annee, motif, statut, description, type_document, banque, created_at, date_livraison)
         VALUES ($1, NULL, $2, $3, $4, $5, 'livré', $6, $7, $8, $9::date + time '09:00', $9::date + time '09:00') RETURNING id`,
        [tenantId, nom, texte(l.num_acte, 50), annee, motif, `Repris du registre papier (${source})`, texte(l.type_document, 100), texte(l.reference, 100), sortie]
      )).rows[0];
      const prevue = plusJours(sortie, dureeMotif(reglages.motifs_durees, motif) || defaut);
      await client.query(
        `INSERT INTO request_loans (tenant_id, request_id, emprunteur_id, emprunteur_nom, remis_par, remis_at, date_retour_prevue,
                                    observation_remise, retourne_at, retourne_par, observation_retour, reprise_empreinte, derniere_relance_at)
         VALUES ($1, $2, NULL, $3, $4, $5::date + time '09:00', $6, $7, $8::date + time '17:00', $9, $10, $11, now())`,
        [tenantId, q.id, texte(l.emprunteur, 255), user.id, sortie, prevue, obs || null, retour, retour ? user.id : null,
          retour ? (texte(l.observation_retour, 300) || 'Retour noté au registre papier') : null, empreinte]
      );
      await client.query(
        `INSERT INTO request_history (request_id, user_id, action, previous_status, new_status, comment, user_name, tenant_id)
         VALUES ($1, $2, 'Sortie reprise du registre papier', NULL, 'livré', $3, $4, $5)`,
        [q.id, user.id, obs || null, user.full_name || null, tenantId]
      );
      res.ajoutees += 1;
    }
    await client.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)',
      [user.id, `A repris ${res.ajoutees} sortie${res.ajoutees > 1 ? 's' : ''} du registre papier (« ${source} »)`.slice(0, 500), tenantId]);
  });
  return res;
}

module.exports = { importer, LIMITE };
