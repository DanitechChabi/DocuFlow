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
  try {
    await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND id_user = $2',
      [id, userId]
    );
    res.json({ message: 'Notification marquée comme lue' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour' });
  }
};

exports.markAllAsRead = async (req, res) => {
  const userId = req.user.id;
  try {
    await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE id_user = $1',
      [userId]
    );
    res.json({ message: 'Toutes les notifications ont été marquées comme lues' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour' });
  }
};
