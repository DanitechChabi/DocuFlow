const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const mfileService = require('../services/mfileService');
require('dotenv').config({ path: './.env' });

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

    // 2. Notifier les archivistes et admins du même tenant
    // tenantDb.query gère le fallback si la colonne tenant_id n'existe pas
    const admins = await tenantDb.query(
      tenantId,
      "SELECT id FROM users WHERE role IN ('admin', 'superadmin', 'archiviste')"
    );
    for (const admin of admins.rows) {
      await tenantDb.insert(
        tenantId,
        'notifications',
        ['id_user', 'title', 'message', 'type', 'request_id'],
        [admin.id, 'Nouvelle demande reçue', `Une nouvelle demande a été créée pour l'entreprise ${nom_entreprise}.`, 'request_created', requestId]
      );
    }

    // 3. Log l'action dans l'historique
    await tenantDb.insert(
      tenantId,
      'audit_logs',
      ['id_user', 'action', 'request_id'],
      [userId, `A créé une demande pour ${nom_entreprise}`, requestId]
    );

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

    const mfileCheck = await mfileService.verifyDocument({
      nom_entreprise: request.nom_entreprise,
      num_dossier: request.num_dossier,
      num_acte: request.num_acte,
      annee: request.annee
    });

    res.json({
      exists: mfileCheck.exists,
      fileUrl: mfileCheck.fileUrl || null,
      message: mfileCheck.exists ? 'Document trouvé dans mfile' : 'Document non trouvé dans mfile'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la vérification mfile' });
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
    const result = await tenantDb.query(
      tenantId,
      `SELECT r.*, u.full_name as requester_name
       FROM requests r
       JOIN users u ON r.id_user = u.id
       ORDER BY r.created_at DESC`
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
      let query = `SELECT al.*, u.full_name as user_name
                   FROM audit_logs al
                   JOIN users u ON al.id_user = u.id
                   WHERE al.tenant_id = $1`;
      const params = [tenantId];

      if (role !== 'admin' && role !== 'superadmin') {
        query += ` AND al.id_user = $2`;
        params.push(userId);
      }

      query += ` ORDER BY al.timestamp DESC`;
      result = await db.query(query, params);
    } catch (err) {
      if (err.code === '42703') {
        // Fallback : pas de tenant_id
        let query = `SELECT al.*, u.full_name as user_name
                     FROM audit_logs al
                     JOIN users u ON al.id_user = u.id`;
        const params = [];

        if (role !== 'admin' && role !== 'superadmin') {
          query += ` WHERE al.id_user = $1`;
          params.push(userId);
        }

        query += ` ORDER BY al.timestamp DESC`;
        result = await db.query(query, params);
      } else {
        throw err;
      }
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de la récupération de l'historique" });
  }
};

exports.updateRequestStatus = async (req, res) => {
  const { id } = req.params;
  const { status, notes_internes } = req.body;
  const tenantId = req.user.tenant_id;

  try {
    let query = 'UPDATE requests SET statut = $1';
    let params = [status];
    let paramCount = 2;

    if (notes_internes !== undefined) {
      query += `, notes_internes = $${paramCount++}`;
      params.push(notes_internes);
    }

    if (status === 'livré') {
      query += `, date_livraison = CURRENT_TIMESTAMP`;
    }

    query += ` WHERE id = $${paramCount++} AND tenant_id = $${paramCount}`;
    params.push(id, tenantId);

    await db.query(query, params);

    const requestResult = await tenantDb.query(
      tenantId,
      'SELECT id_user, nom_entreprise FROM requests WHERE id = $1',
      [id]
    );
    const request = requestResult.rows[0];
    if (request) {
      await tenantDb.insert(
        tenantId,
        'notifications',
        ['id_user', 'title', 'message', 'type', 'request_id'],
        [request.id_user, 'Mise à jour de votre demande', `Le statut de la demande pour ${request.nom_entreprise} est maintenant : ${status}.`, 'status_update', id]
      );

      await tenantDb.insert(
        tenantId,
        'audit_logs',
        ['id_user', 'action', 'request_id'],
        [req.user.id, `A changé le statut de la demande ${request.nom_entreprise} vers ${status}`, id]
      );
    }

    res.json({ message: 'Statut de la demande mis à jour avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du statut' });
  }
};
