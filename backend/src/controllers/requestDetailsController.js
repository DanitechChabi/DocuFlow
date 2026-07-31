const tenantDb = require('../config/db-tenant');

exports.getRequestDetails = async (req, res) => {
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

    const db = require('../config/db');
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

    res.json({
      request,
      history: logsResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des détails' });
  }
};
