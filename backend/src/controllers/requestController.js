const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const requestStateMachine = require('../services/requestStateMachine');
const mailService = require('../services/mailService');
const storage = require('../services/storageService');
const { indexRequestToDocuments } = require('../services/documentIndexService');
const auditService = require('../services/auditService');
require('dotenv').config({ path: './.env' });

/* ===== Helpers ===== */

// Enregistre une étape horodatée dans request_history (machine à états)
async function insertStateHistory(tenantId, { requestId, userId, userName, action, previousStatus, newStatus, comment }) {
  try {
    await tenantDb.insert(
      tenantId,
      'request_history',
      ['request_id', 'user_id', 'action', 'previous_status', 'new_status', 'comment', 'user_name'],
      [requestId, userId, action, previousStatus || null, newStatus || null, comment || null, userName || null]
    );
  } catch (err) {
    if (err.code === '42P01') {
      console.warn('[request] table request_history absente, étape non enregistrée');
      return;
    }
    throw err;
  }
}

// Insère une notification interne (cloche)
async function notifyUser(tenantId, userId, title, message, type, requestId) {
  await tenantDb.insert(
    tenantId,
    'notifications',
    ['id_user', 'title', 'message', 'type', 'request_id'],
    [userId, title, message, type, requestId]
  );
}

// Récupère l'e-mail d'un utilisateur (pas présent dans le JWT)
async function getUserEmail(tenantId, userId) {
  try {
    const res = await tenantDb.query(tenantId, 'SELECT email FROM users WHERE id = $1', [userId]);
    return res.rows[0]?.email || null;
  } catch (err) {
    console.error('[request] getUserEmail :', err.message);
    return null;
  }
}

exports.createRequest = async (req, res) => {
  const {
    nom_entreprise,
    num_dossier,
    num_acte,
    annee,
    type_document,
    motif,
    priorite
  } = req.body;

  const userId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    // 1. Enregistrement de la demande (Statut : en attente)
    const newRequest = await tenantDb.insert(
      tenantId,
      'requests',
      ['id_user', 'nom_entreprise', 'num_dossier', 'num_acte', 'annee', 'type_document', 'motif', 'priorite', 'statut'],
      [userId, nom_entreprise, num_dossier, num_acte, annee, type_document, motif, priorite, 'en attente']
    );

    const requestId = newRequest.rows[0].id;
    const requestRow = newRequest.rows[0];

    // 2. Historique d'état initial (machine à états)
    await insertStateHistory(tenantId, {
      requestId,
      userId,
      userName: req.user.full_name || null,
      action: 'Création de la demande',
      previousStatus: null,
      newStatus: 'en attente',
    });

    // 3. Notifier les archivistes et admins du même tenant
    // tenantDb.query gère le fallback si la colonne tenant_id n'existe pas
    const admins = await tenantDb.query(
      tenantId,
      "SELECT id FROM users WHERE role IN ('admin', 'superadmin', 'archiviste')"
    );
    for (const admin of admins.rows) {
      await notifyUser(tenantId, admin.id, 'Nouvelle demande reçue', `Une nouvelle demande a été créée pour l'entreprise ${nom_entreprise}.`, 'request_created', requestId);
    }

    // 4. Log l'action dans l'historique général
    await tenantDb.insert(
      tenantId,
      'audit_logs',
      ['id_user', 'action', 'request_id'],
      [userId, `A créé une demande pour ${nom_entreprise}`, requestId]
    );

    // 5. Accusé de réception par e-mail au demandeur
    try {
      const requesterEmail = await getUserEmail(tenantId, userId);
      if (requesterEmail) {
        await mailService.sendMail({
          to: requesterEmail,
          ...mailService.TEMPLATES.request_created(requestRow),
        });
      }
    } catch (emailErr) {
      console.error('[request] Erreur e-mail accusé de réception :', emailErr.message);
    }

    res.status(201).json({
      message: 'Votre demande a été enregistrée et est en attente de traitement par l\'archiviste.',
      request: newRequest.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de l'enregistrement de la demande" });
  }
};

exports.verifyMfile = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.tenant_id;

  try {
    const requestResult = await tenantDb.query(
      tenantId,
      'SELECT * FROM requests WHERE id = $1',
      [id]
    );
    const request = requestResult.rows[0];

    if (!request) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    // Vérification dans le référentiel documentaire (plus de mock)
    // db.query direct : db-tenant injecte tenant_id en double sur ORDER BY + LIMIT
    const docResult = await db.query(
      `SELECT * FROM documents
       WHERE num_dossier = $1 AND num_acte = $2 AND tenant_id = $3
       ORDER BY created_at DESC LIMIT 1`,
      [request.num_dossier, request.num_acte, tenantId]
    );
    const document = docResult.rows[0] || null;

    let fileUrl = null;
    if (document) {
      const fileRes = await db.query(
        'SELECT * FROM document_files WHERE document_id = $1 ORDER BY version DESC LIMIT 1',
        [document.id]
      );
      const f = fileRes.rows[0];
      if (f) fileUrl = storage.fileUrl(req, f);
    }

    res.json({
      exists: !!document,
      document,
      fileUrl,
      message: document ? 'Document trouvé dans le référentiel' : 'Document non trouvé dans le référentiel'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la vérification du document' });
  }
};

exports.linkDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { document_id } = req.body;

  try {
    if (document_id == null) {
      await tenantDb.query(tenantId, 'UPDATE requests SET document_id = NULL WHERE id = $1', [id]);
      return res.json({ message: 'Lien retiré' });
    }
    const docRes = await tenantDb.query(tenantId, 'SELECT * FROM documents WHERE id = $1', [document_id]);
    if (!docRes.rows[0]) return res.status(404).json({ message: 'Document non trouvé' });

    const result = await tenantDb.query(
      tenantId,
      'UPDATE requests SET document_id = $1 WHERE id = $2',
      [document_id, id]
    );
    if (!result.rowCount) return res.status(404).json({ message: 'Demande non trouvée' });
    res.json({ message: 'Demande liée au document', document_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la liaison' });
  }
};

exports.getUserRequests = async (req, res) => {
  const userId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    const result = await tenantDb.query(
      tenantId,
      'SELECT * FROM requests WHERE id_user = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des demandes' });
  }
};

exports.getAllRequests = async (req, res) => {
  const tenantId = req.user.tenant_id;

  try {
    // Filtrage tenant explicite avec colonnes qualifiées pour éviter l'ambiguïté
    const result = await db.query(
      `SELECT r.*, u.full_name as requester_name, u2.full_name as assignee_name
       FROM requests r
       JOIN users u ON r.id_user = u.id AND u.tenant_id = r.tenant_id
       LEFT JOIN users u2 ON r.assignee_id = u2.id AND u2.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1
       ORDER BY r.created_at DESC`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des demandes' });
  }
};

exports.getStats = async (req, res) => {
  const tenantId = req.user.tenant_id;

  try {
    const result = await tenantDb.query(
      tenantId,
      `SELECT statut, COUNT(*) as count FROM requests GROUP BY statut`
    );
    const stats = {};
    result.rows.forEach(row => {
      stats[row.statut] = parseInt(row.count);
    });
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des statistiques' });
  }
};

exports.getAuditLogs = async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  const tenantId = req.user.tenant_id;

  try {
    // Tentative avec tenant_id ; fallback si colonne absente
    let result;
    try {
      // LEFT JOIN et non JOIN : un INNER JOIN écartait toutes les entrées sans
      // auteur identifié (actions système, comptes supprimés), qui disparaissaient
      // alors de l'historique sans laisser de trace — inacceptable pour un
      // journal d'audit qui se veut exhaustif.
      let query = `SELECT al.*, COALESCE(u.full_name, al.user_name) as user_name
                   FROM audit_logs al
                   LEFT JOIN users u ON al.id_user = u.id
                   WHERE al.tenant_id = $1`;
      const params = [tenantId];

      if (role !== 'admin' && role !== 'superadmin') {
        query += ` AND al.id_user = $2`;
        params.push(userId);
      }

      query += ` ORDER BY al.id DESC`;
      result = await db.query(query, params);
    } catch (err) {
      if (err.code === '42703') {
        // Fallback : pas de tenant_id
        let query = `SELECT al.*, COALESCE(u.full_name, al.user_name) as user_name
                     FROM audit_logs al
                     LEFT JOIN users u ON al.id_user = u.id`;
        const params = [];

        if (role !== 'admin' && role !== 'superadmin') {
          query += ` WHERE al.id_user = $1`;
          params.push(userId);
        }

        query += ` ORDER BY al.id DESC`;
        result = await db.query(query, params);
      } else {
        throw err;
      }
    }

    // Contrat unique pour les deux vues du journal (historique des flux et
    // journal d'audit) : voir auditService.normalizeLog.
    res.json(result.rows.map(auditService.normalizeLog));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de la récupération de l'historique" });
  }
};

exports.updateRequestStatus = async (req, res) => {
  const { id } = req.params;
  const { status, notes_internes } = req.body;
  const tenantId = req.user.tenant_id;
  const role = req.user.role;
  const userId = req.user.id;

  try {
    // 1. Charger la demande pour valider la transition
    const requestResult = await tenantDb.query(
      tenantId,
      'SELECT * FROM requests WHERE id = $1',
      [id]
    );
    const request = requestResult.rows[0];
    if (!request) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    // 2. Validation par la machine à états (transition + rôle)
    const check = requestStateMachine.canTransition({
      from: request.statut,
      to: status,
      role,
      isOwner: request.id_user === userId,
    });
    if (!check.ok) {
      return res.status(400).json({ message: check.reason });
    }

    // 3. Mise à jour en base
    let query = 'UPDATE requests SET statut = $1';
    let params = [status];
    let paramCount = 2;

    if (notes_internes !== undefined) {
      query += `, notes_internes = $${paramCount++}`;
      params.push(notes_internes);
    }

    if (status === 'livré') {
      query += `, date_livraison = CURRENT_TIMESTAMP`;
    } else {
      query += `, date_livraison = NULL`;
    }

    // Tentative avec tenant_id ; fallback si colonne absente (mode mono-tenant)
    const queryWithTenant = query + ` WHERE id = $${paramCount++} AND tenant_id = $${paramCount}`;
    try {
      await db.query(queryWithTenant, [...params, id, tenantId]);
    } catch (err) {
      if (err.code === '42703') {
        // Le placeholder id est le dernier paramètre contigu (paramCount - 1)
        await db.query(query + ` WHERE id = $${paramCount - 1}`, [...params, id]);
      } else {
        throw err;
      }
    }

    // 3bis. À la livraison, indexer les fichiers dans le référentiel documentaire
    if (status === 'livré') {
      try {
        await indexRequestToDocuments(tenantId, id, userId);
      } catch (err) {
        console.error('[request] indexation automatique échouée :', err.message);
      }
    }

    // 4. Historique d'état (machine à états)
    await insertStateHistory(tenantId, {
      requestId: id,
      userId,
      userName: req.user.full_name || null,
      action: status === 'annulé' ? 'Demande annulée' : requestStateMachine.label(status),
      previousStatus: request.statut,
      newStatus: status,
      comment: notes_internes || null,
    });

    // 5. Notification interne au demandeur
    const notificationTitle = status === 'annulé' ? 'Votre demande a été annulée' : 'Mise à jour de votre demande';
    const notificationMessage = status === 'annulé'
      ? `La demande pour ${request.nom_entreprise} a été annulée.`
      : `Le statut de la demande pour ${request.nom_entreprise} est maintenant : ${requestStateMachine.label(status)}.`;
    await notifyUser(tenantId, request.id_user, notificationTitle, notificationMessage, 'status_update', id);

    // 6. Log dans l'historique général
    await tenantDb.insert(
      tenantId,
      'audit_logs',
      ['id_user', 'action', 'request_id'],
      [userId, `A changé le statut de la demande ${request.nom_entreprise} vers ${status}`, id]
    );

    // 7. E-mail au demandeur (template par événement, accusé à la livraison)
    try {
      const requesterEmail = await getUserEmail(tenantId, request.id_user);
      if (requesterEmail) {
        const template = status === 'livré'
          ? mailService.TEMPLATES.delivered
          : mailService.TEMPLATES.status_update;
        await mailService.sendMail({
          to: requesterEmail,
          ...template({ ...request, statut: status }),
        });
      }
    } catch (emailErr) {
      console.error('[request] Erreur e-mail statut :', emailErr.message);
    }

    res.json({ message: 'Statut de la demande mis à jour avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du statut' });
  }
};

// Attribution d'une demande à un archiviste (redistribution manuelle)
exports.assignRequest = async (req, res) => {
  const { id } = req.params;
  const { assignee_id } = req.body;
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;

  if (!assignee_id) {
    return res.status(400).json({ message: 'assignee_id est requis' });
  }

  try {
    // 1. Vérifier que la demande existe
    const requestResult = await tenantDb.query(
      tenantId,
      'SELECT * FROM requests WHERE id = $1',
      [id]
    );
    const request = requestResult.rows[0];
    if (!request) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    // 2. Vérifier que l'assigné est un membre du personnel du même tenant
    const assigneeResult = await tenantDb.query(
      tenantId,
      "SELECT id, full_name, role FROM users WHERE id = $1 AND role IN ('archiviste', 'admin', 'superadmin')",
      [assignee_id]
    );
    const assignee = assigneeResult.rows[0];
    if (!assignee) {
      return res.status(400).json({ message: 'Archiviste introuvable ou invalide' });
    }

    // 3. Mise à jour
    const queryWithTenant = 'UPDATE requests SET assignee_id = $1, assigned_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3';
    try {
      await db.query(queryWithTenant, [assignee_id, id, tenantId]);
    } catch (err) {
      if (err.code === '42703') {
        await db.query('UPDATE requests SET assignee_id = $1, assigned_at = CURRENT_TIMESTAMP WHERE id = $2', [assignee_id, id]);
      } else {
        throw err;
      }
    }

    // 4. Historique d'état
    await insertStateHistory(tenantId, {
      requestId: id,
      userId,
      userName: req.user.full_name || null,
      action: `Assignée à ${assignee.full_name}`,
      previousStatus: request.statut,
      newStatus: request.statut,
      comment: null,
    });

    // 5. Notification interne à l'assigné
    await notifyUser(tenantId, assignee_id, 'Nouvelle demande assignée', `La demande ${request.nom_entreprise} (${request.num_dossier || ''}) vous a été assignée.`, 'request_assigned', id);

    // 6. E-mail à l'assigné
    try {
      const assigneeEmail = await getUserEmail(tenantId, assignee_id);
      if (assigneeEmail) {
        await mailService.sendMail({
          to: assigneeEmail,
          ...mailService.TEMPLATES.assigned(request, assignee.full_name),
        });
      }
    } catch (emailErr) {
      console.error('[request] Erreur e-mail assignation :', emailErr.message);
    }

    res.json({ message: 'Demande assignée avec succès', assignee });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de l'assignation de la demande" });
  }
};

// « Mes tâches » : demandes assignées à l'utilisateur connecté, encore actives
exports.getMyTasks = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;

  try {
    const result = await db.query(
      `SELECT r.*, u.full_name as requester_name, u2.full_name as assignee_name
       FROM requests r
       JOIN users u ON r.id_user = u.id AND u.tenant_id = r.tenant_id
       LEFT JOIN users u2 ON r.assignee_id = u2.id AND u2.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1 AND r.assignee_id = $2
         AND r.statut NOT IN ('livré', 'rejete', 'annulé')
       ORDER BY r.created_at DESC`,
      [tenantId, userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des tâches' });
  }
};
