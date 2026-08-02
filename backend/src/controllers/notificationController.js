const db = require('../config/db');
const tenantDb = require('../config/db-tenant');

exports.getNotifications = async (req, res) => {
  const userId = req.user.id;
  const tenantId = req.user.tenant_id;
  try {
    const result = await tenantDb.query(
      tenantId,
      'SELECT * FROM notifications WHERE id_user = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des notifications' });
  }
};

exports.markAsRead = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const tenantId = req.user.tenant_id;
  try {
    // Inclure tenant_id pour éviter l'accès cross-tenant
    const result = await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND id_user = $2 AND tenant_id = $3',
      [id, userId, tenantId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Notification non trouvée' });
    }
    res.json({ message: 'Notification marquée comme lue' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour' });
  }
};

exports.markAllAsRead = async (req, res) => {
  const userId = req.user.id;
  const tenantId = req.user.tenant_id;
  try {
    // Inclure tenant_id pour éviter l'accès cross-tenant
    await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE id_user = $1 AND tenant_id = $2',
      [userId, tenantId]
    );
    res.json({ message: 'Toutes les notifications ont été marquées comme lues' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour' });
  }
};
