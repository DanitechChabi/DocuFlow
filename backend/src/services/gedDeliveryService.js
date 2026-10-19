// ============================================================================
// gedDeliveryService — servir une demande avec un document déjà dans la GED.
//
// « Transmettre ce document » : l'archiviste a trouvé (souvent grâce à la
// recherche automatique) le document demandé. En un geste :
//   1. la version courante du document est JOINTE à la demande — le
//      demandeur, qui n'a pas accès à la GED, la télécharge depuis sa
//      demande ; le binaire est partagé, pas dupliqué (la suppression d'une
//      pièce jointe épargne un binaire encore référencé par la GED, voir
//      uploadController.deleteRequestFile) ;
//   2. le document est lié à la demande comme son livrable (« produit ») ;
//   3. la demande passe « livré » — depuis n'importe quel état non clos :
//      le document existe, il n'y a plus rien à préparer.
// Acte EXPLICITE et TRACÉ (exigence GED : jamais d'accès implicite) : il
// exige requests.process ET documents.view, la lecture du dossier du
// document (ACL), et s'inscrit au journal d'audit append-only.
// ============================================================================
const db = require('../config/db');
const aclService = require('./aclService');
const mailService = require('./mailService');
const requestStateMachine = require('./requestStateMachine');
const { libelleDemande } = require('../helpers/requestInput');

function erreur(statut, message, code) {
  const e = new Error(message);
  e.statut = statut;
  if (code) e.code = code;
  return e;
}

async function transmettre(tenantId, requestId, user, documentId) {
  if (!Number.isInteger(documentId) || documentId <= 0) throw erreur(400, 'Document à transmettre manquant.');

  const client = await db.pool.connect();
  let request;
  let doc;
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [requestId, tenantId]);
    request = r.rows[0];
    if (!request) throw erreur(404, 'Demande non trouvée');
    if (requestStateMachine.isTerminal(request.statut)) {
      throw erreur(409, `La demande est déjà « ${requestStateMachine.label(request.statut)} ».`, 'DEMANDE_TERMINEE');
    }

    const d = await client.query(
      'SELECT * FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [documentId, tenantId]
    );
    doc = d.rows[0];
    if (!doc) throw erreur(404, 'Document non trouvé');
    if (doc.dossier_id && !(await aclService.peutLire(tenantId, user.id, doc.dossier_id))) {
      throw erreur(403, 'Ce document est dans un dossier qui ne vous est pas ouvert.');
    }

    const f = await client.query(
      'SELECT * FROM document_files WHERE document_id = $1 ORDER BY version DESC LIMIT 1', [documentId]
    );
    const fichier = f.rows[0];
    if (!fichier) throw erreur(409, 'Ce document n\'a aucun fichier à transmettre.', 'DOCUMENT_SANS_FICHIER');

    await client.query(
      `INSERT INTO request_files (request_id, original_name, stored_name, cloudinary_public_id, mime_type, file_size,
                                  secure_url, uploaded_by, tenant_id, source_document_file_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [requestId, fichier.original_name, fichier.stored_name, fichier.cloudinary_public_id, fichier.mime_type,
        fichier.file_size, fichier.secure_url || null, user.id, tenantId, fichier.id]
    );
    await client.query(
      `INSERT INTO request_documents (request_id, document_id, link_type, created_by)
       VALUES ($1, $2, 'produit', $3) ON CONFLICT (request_id, document_id, link_type) DO NOTHING`,
      [requestId, documentId, user.id]
    );
    // Le livrable principal ; la réciproque n'est posée que si le document
    // n'est pas déjà le produit d'une autre demande (elle désigne SON origine).
    await client.query(
      `UPDATE requests SET statut = 'livré', date_livraison = CURRENT_TIMESTAMP, document_id = COALESCE(document_id, $3)
        WHERE id = $1 AND tenant_id = $2`,
      [requestId, tenantId, documentId]
    );
    await client.query('UPDATE documents SET request_id = $1 WHERE id = $2 AND tenant_id = $3 AND request_id IS NULL', [requestId, documentId, tenantId]);

    await client.query(
      `INSERT INTO request_history (request_id, user_id, action, previous_status, new_status, comment, user_name, tenant_id)
       VALUES ($1, $2, $3, $4, 'livré', NULL, $5, $6)`,
      [requestId, user.id, `Livré depuis la GED (${doc.reference_mfile})`.slice(0, 100), request.statut, user.full_name || null, tenantId]
    );
    await client.query(
      'INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, $3, $4)',
      [user.id, `A transmis le document ${doc.reference_mfile} (version ${fichier.version}) pour la demande « ${libelleDemande(request)} »`, requestId, tenantId]
    );
    await client.query(
      `INSERT INTO notifications (id_user, title, message, type, request_id, tenant_id)
       VALUES ($1, 'Votre document est disponible', $2, 'status_update', $3, $4)`,
      [request.id_user, `Le document demandé (« ${libelleDemande(request)} ») est joint à votre demande.`, requestId, tenantId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  try {
    const u = await db.query('SELECT email FROM users WHERE id = $1 AND tenant_id = $2', [request.id_user, tenantId]);
    if (u.rows[0]?.email) {
      await mailService.notify({ tenantId, to: u.rows[0].email, event: 'delivered', request: { ...request, statut: 'livré' } });
    }
  } catch (err) {
    console.error('[ged-livraison] e-mail non envoyé :', err.message);
  }
  return { document: { id: doc.id, reference: doc.reference_mfile } };
}

module.exports = { transmettre };
