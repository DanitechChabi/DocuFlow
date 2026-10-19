const tenantDb = require('../config/db-tenant');
const requestFieldService = require('../services/requestFieldService');
// Qui consulte une demande qui ne lui appartient pas : son assigné et le
// personnel de traitement (voir requestAccessService). Sans ce contrôle, tout
// utilisateur connecté de l'organisation — donc un simple demandeur — ouvrait
// la fiche de n'importe quelle demande : motif, NOTES INTERNES du personnel,
// journal d'audit complet.
const requestAccess = require('../services/requestAccessService');
const loanService = require('../services/loanService');
const settingsService = require('../services/settingsService');

exports.getRequestDetails = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.tenant_id;
  try {
    const db = require('../config/db');
    // Requête avec JOIN (nom de l'assigné) — tenant_id qualifié car join
    let requestResult;
    try {
      requestResult = await db.query(
        `SELECT r.*, u2.full_name as assignee_name
         FROM requests r
         LEFT JOIN users u2 ON r.assignee_id = u2.id
         WHERE r.id = $1 AND r.tenant_id = $2`,
        [id, tenantId]
      );
    } catch (err) {
      if (err.code === '42703') {
        requestResult = await db.query(
          `SELECT r.*, u2.full_name as assignee_name
           FROM requests r
           LEFT JOIN users u2 ON r.assignee_id = u2.id
           WHERE r.id = $1`,
          [id]
        );
      } else {
        throw err;
      }
    }
    const request = requestResult.rows[0];

    if (!request) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    // Auteur, assigné ou personnel. Le 403 est renvoyé APRÈS le 404 pour ne
    // pas révéler l'existence d'une demande d'un autre tenant : l'appelant
    // sans droit sait seulement « rien pour lui ici ».
    if (!(await requestAccess.peutConsulter(req.user, request))) {
      return res.status(403).json({ message: 'Accès refusé' });
    }
    // Les notes internes sont celles du PERSONNEL : l'auteur qui consulte sa
    // propre demande ne les voit pas, ni les commentaires de transition, qui
    // en sont la copie (updateRequestStatus y consigne notes_internes).
    const personnel = await requestAccess.peutVoirToutes(req.user)
      || (request.assignee_id != null && request.assignee_id === req.user.id);
    if (!personnel) delete request.notes_internes;
    // Requête avec tentative tenant_id, fallback si colonne absente
    let logsResult;
    try {
      logsResult = await db.query(
        `SELECT al.*, u.full_name as user_name
         FROM audit_logs al
         JOIN users u ON al.id_user = u.id
         WHERE al.request_id = $1 AND al.tenant_id = $2
         ORDER BY al.timestamp ASC`,
        [id, tenantId]
      );
    } catch (err) {
      if (err.code === '42703') {
        logsResult = await db.query(
          `SELECT al.*, u.full_name as user_name
           FROM audit_logs al
           JOIN users u ON al.id_user = u.id
           WHERE al.request_id = $1
           ORDER BY al.timestamp ASC`,
          [id]
        );
      } else {
        throw err;
      }
    }

    // Historique d'états structuré (machine à états) depuis request_history
    let stateResult;
    try {
      stateResult = await db.query(
        `SELECT rh.* FROM request_history rh
         WHERE rh.request_id = $1 AND rh.tenant_id = $2
         ORDER BY rh.timestamp ASC`,
        [id, tenantId]
      );
    } catch (err) {
      if (err.code === '42703') {
        stateResult = await db.query(
          `SELECT rh.* FROM request_history rh WHERE rh.request_id = $1 ORDER BY rh.timestamp ASC`,
          [id]
        );
      } else {
        throw err;
      }
    }

    // Valeurs des champs ajoutés par l'organisation (migration 016).
    //
    // Sans cette lecture, les champs personnalisés s'enregistreraient à la
    // création sans jamais s'afficher ensuite : l'archiviste traiterait la
    // demande sans voir les informations que le demandeur a pourtant saisies.
    //
    // L'échec ne fait pas échouer la réponse : ces valeurs complètent le détail,
    // elles ne le constituent pas. Sur une base où la migration 016 n'est pas
    // passée, la fiche doit rester consultable.
    let customFields = [];
    try {
      customFields = await requestFieldService.getValues(tenantId, id);
    } catch (fieldErr) {
      if (fieldErr.code !== '42P01') {
        console.error('[requestDetails] champs personnalisés illisibles :', fieldErr.message);
      }
    }

    // Documents liés à la demande — la relation N↔N (migration 021) : le
    // livrable principal ET les références, chaque ligne avec son type.
    // Échec non bloquant : pré-migration, la fiche reste consultable.
    let linkedDocuments = [];
    try {
      const docs = await db.query(
        `SELECT d.id, d.reference_mfile, d.statut, d.type_document, d.dossier_id,
                f.name AS dossier_name,
                (SELECT COUNT(*) FROM document_files df WHERE df.document_id = d.id)::int AS files_count,
                rd.link_type
           FROM request_documents rd
           JOIN documents d ON d.id = rd.document_id AND d.tenant_id = $1
           LEFT JOIN document_folders f ON f.id = d.dossier_id AND f.tenant_id = d.tenant_id
          WHERE rd.request_id = $2
          ORDER BY rd.created_at ASC`,
        [tenantId, id]
      );
      linkedDocuments = docs.rows;
    } catch (linkErr) {
      if (linkErr.code !== '42P01') {
        console.error('[requestDetails] documents liés illisibles :', linkErr.message);
      }
    }

    // Prêt du dossier physique (migration 025) — null si aucun. Non bloquant.
    let loan = null;
    let loanRequireConfirmation = false;
    try {
      loan = await loanService.pretDeLaDemande(tenantId, id);
      loanRequireConfirmation = (await settingsService.getAll(tenantId)).loan_require_confirmation === true;
    } catch (loanErr) {
      console.error('[requestDetails] prêt illisible :', loanErr.message);
    }

    res.json({
      loan,
      loanRequireConfirmation,
      request,
      history: logsResult.rows,
      stateHistory: personnel ? stateResult.rows : stateResult.rows.map((h) => ({ ...h, comment: null })),
      customFields,
      linkedDocuments
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des détails' });
  }
};
