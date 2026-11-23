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
const { banqueAdmise } = require('../helpers/exigencesTypologie');

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
  const res = { ajoutees: 0, deja: 0, corrigees: 0, rejetees: [] };
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
      const deja = await client.query('SELECT id, request_id FROM request_loans WHERE tenant_id = $1 AND reprise_empreinte = $2', [tenantId, empreinte]);
      if (deja.rows[0] && l.correction && typeof l.correction === 'object') {
        // Ligne déjà reprise, à rectifier (typologie, banque, références) : retrouvée
        // par l'empreinte de son import d'origine, elle garde ses dates et son retour.
        const c = l.correction;
        const req = (await client.query('SELECT * FROM requests WHERE id = $1 AND tenant_id = $2', [deja.rows[0].request_id, tenantId])).rows[0];
        const val = (k, max) => (k in c ? texte(c[k], max) : req[k]);
        const type = val('type_document', 100);
        const nouveau = {
          nom_entreprise: val('nom_entreprise', 255) || req.nom_entreprise, num_dossier: val('num_dossier', 100), num_acte: val('num_acte', 50),
          type_document: type, banque: banqueAdmise(type) ? val('banque', 150) : null,
        };
        await client.query(
          'UPDATE requests SET nom_entreprise = $1, num_dossier = $2, num_acte = $3, type_document = $4, banque = $5 WHERE id = $6 AND tenant_id = $7',
          [nouveau.nom_entreprise, nouveau.num_dossier, nouveau.num_acte, nouveau.type_document, nouveau.banque, req.id, tenantId]
        );
        const empreinteCorrigee = crypto.createHash('sha256').update(JSON.stringify([sortie, nouveau.nom_entreprise, nouveau.num_acte, annee, motif, texte(l.emprunteur, 255)])).digest('hex');
        await client.query('UPDATE request_loans SET reprise_empreinte = $1 WHERE id = $2', [empreinteCorrigee, deja.rows[0].id]).catch(() => {});
        res.corrigees += 1;
        continue;
      }
      if (deja.rows[0]) { res.deja += 1; continue; }
      const obs = [texte(l.date_acte, 60) && `Acte du ${texte(l.date_acte, 60)}`, texte(l.observation, 600)].filter(Boolean).join(' · ');
      const q = (await client.query(
        `INSERT INTO requests (tenant_id, id_user, nom_entreprise, num_acte, num_dossier, annee, motif, statut, description, type_document, banque, created_at, date_livraison)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, 'livré', $7, $8, $9, $10::date + time '09:00', $10::date + time '09:00') RETURNING id`,
        [tenantId, nom, texte(l.num_acte, 50), texte(l.num_dossier || l.reference, 100), annee, motif, `Repris du registre papier (${source})`, texte(l.type_document, 100),
          banqueAdmise(l.type_document) ? texte(l.banque, 150) : null, sortie]
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
