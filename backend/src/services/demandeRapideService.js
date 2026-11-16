// ============================================================================
// demandeRapideService — demandes reçues par l'archive (téléphone, couloir).
//
// Même avec une plateforme, on continuera d'appeler l'archive. Plutôt que de
// laisser ces demandes hors du registre, l'archiviste les enregistre au nom
// de l'agent, en un geste, et peut transmettre le dossier dans le même temps :
// c'est l'ancien « on cherche le dossier, on l'inscrit au registre, on le
// remet », sans papier. La demande est celle de l'agent (il la retrouve dans
// « Mes dossiers ») ; l'historique et le journal d'audit disent qui l'a
// enregistrée.
//
//   demandeurs — les agents de l'organisation, pour le choix de l'archiviste
//                (nom et service seulement : l'archive n'a pas accès à la
//                gestion des comptes)
//   pourAgent  — enregistre la demande, et la transmet si on le demande
// ============================================================================
const db = require('../config/db');
const loanService = require('./loanService');
const listeService = require('./listeService');
const { allowedValues } = require('../helpers/requestOptions');
const { lireSaisie, libelleDemande } = require('../helpers/requestInput');
const exigencesTypologie = require('../helpers/exigencesTypologie');

function erreur(statut, message, code) {
  const e = new Error(message);
  e.statut = statut;
  if (code) e.code = code;
  return e;
}

/** Les comptes de l'organisation qui peuvent emprunter un dossier. */
async function demandeurs(tenantId) {
  const r = await db.query(
    `SELECT id, full_name, section
       FROM users
      WHERE tenant_id = $1
        AND COALESCE(full_name, '') <> ''
        AND username NOT LIKE 'portail-citoyen-%'
      ORDER BY full_name`,
    [tenantId]
  );
  return r.rows;
}

/**
 * Enregistre la demande d'un agent reçue par l'archive.
 * @param {object} corps { pour_user_id, nom_entreprise?, num_dossier?, num_acte?,
 *   annee?, description?, motif?, transmettre?, date_retour_prevue? }
 * @returns {Promise<{ request: object, pret: object|null }>}
 */
async function pourAgent(tenantId, user, corps = {}) {
  const agentId = Number(corps.pour_user_id);
  if (!Number.isInteger(agentId) || agentId <= 0) throw erreur(400, 'Choisissez l\'agent qui demande le dossier.');
  const agent = (await db.query('SELECT id, full_name FROM users WHERE id = $1 AND tenant_id = $2', [agentId, tenantId])).rows[0];
  if (!agent) throw erreur(404, 'Agent introuvable.');

  const { values, errors } = lireSaisie({
    nom_entreprise: corps.nom_entreprise,
    num_dossier: corps.num_dossier,
    num_acte: corps.num_acte,
    annee: corps.annee,
    description: corps.description,
    banque: corps.banque,
    montant: corps.montant,
  });
  if (errors.length) throw erreur(400, errors.join(' '));

  const cadres = await listeService.cadresAdmis(tenantId);
  const cadre = String(corps.motif || '').trim() || cadres[0]?.value;
  if (!cadre || !allowedValues(cadres).includes(cadre)) {
    throw erreur(400, `Motif non proposé : « ${cadre || ''} ». Choisissez parmi : ${cadres.map((c) => c.label).join(', ')}.`);
  }
  const type = String(corps.type_document || '').trim() || null;
  if (type && !allowedValues(await listeService.typesAdmis(tenantId)).includes(type)) {
    throw erreur(400, `Typologie inconnue : « ${type} ».`);
  }
  const manque = exigencesTypologie.manque(values, type, await exigencesTypologie.exigencesDe(tenantId));
  if (manque) throw erreur(400, manque);
  const priorite = await listeService.prioriteParDefaut(tenantId);

  return loanService.enTransaction(async (client) => {
    const request = (await client.query(
      `INSERT INTO requests (tenant_id, id_user, nom_entreprise, num_dossier, num_acte, annee, motif, priorite, statut, description, type_document, banque, montant)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'en attente', $9, $10, $11, $12) RETURNING *`,
      [tenantId, agent.id, values.nom_entreprise, values.num_dossier, values.num_acte, values.annee, cadre, priorite, values.description, type,
        values.banque, values.montant]
    )).rows[0];
    await client.query(
      `INSERT INTO request_history (request_id, user_id, action, previous_status, new_status, user_name, tenant_id)
       VALUES ($1, $2, $3, NULL, 'en attente', $4, $5)`,
      [request.id, user.id, `Demande reçue par l'archive pour ${agent.full_name}`.slice(0, 100), user.full_name || null, tenantId]
    );
    await client.query(
      'INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, $3, $4)',
      [user.id, `A enregistré la demande de ${agent.full_name} : ${libelleDemande(request)}`, request.id, tenantId]
    );
    let pret = null;
    if (corps.transmettre) {
      ({ pret } = await loanService.remettre(tenantId, request.id, user,
        { date_retour_prevue: corps.date_retour_prevue, observation: 'Demande reçue par l\'archive' },
        { client, avecSuites: false }));
    } else {
      await loanService.notifier(client, tenantId, agent.id, 'Demande enregistrée',
        `L'archive a enregistré votre demande : ${libelleDemande(request)}.`, 'request_created', request.id);
    }
    return { request: { ...request, statut: pret ? 'livré' : request.statut }, pret };
  });
}

module.exports = { demandeurs, pourAgent };
