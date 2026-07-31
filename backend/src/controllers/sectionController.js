const tenantDb = require('../config/db-tenant');

exports.getSections = async (req, res) => {
  // Route publique (utilisée dans le formulaire d'inscription)
  const tenantId = req.user?.tenant_id || 1;
  try {
    const result = await tenantDb.query(
      tenantId,
      'SELECT * FROM sections ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des sections' });
  }
};

exports.createSection = async (req, res) => {
  const { name } = req.body;
  const tenantId = req.user.tenant_id;
  try {
    const result = await tenantDb.insert(
      tenantId,
      'sections',
      ['name'],
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: 'La section existe déjà ou erreur serveur' });
  }
};

exports.deleteSection = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.tenant_id;
  try {
    const db = require('../config/db');
    // Tentative avec tenant_id ; fallback si colonne absente (mode mono-tenant)
    try {
      await db.query(
        'DELETE FROM sections WHERE id = $1 AND tenant_id = $2',
        [id, tenantId]
      );
    } catch (err) {
      if (err.code === '42703') {
        await db.query('DELETE FROM sections WHERE id = $1', [id]);
      } else {
        throw err;
      }
    }
    res.json({ message: 'Section supprimée avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la suppression de la section' });
  }
};
