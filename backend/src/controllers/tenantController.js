const db = require('../config/db');
const tenantDb = require('../config/db-tenant');

exports.getAllTenants = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, slug, status, created_at FROM tenants ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des entreprises' });
  }
};

exports.getTenant = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'SELECT id, name, slug, status, created_at FROM tenants WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Entreprise non trouvée' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération de l\'entreprise' });
  }
};

exports.createTenant = async (req, res) => {
  const { name, slug, email_domain, contact_email } = req.body;

  if (!name || !slug) {
    return res.status(400).json({ message: 'Nom et slug requis' });
  }

  try {
    const result = await db.query(
      `INSERT INTO tenants (name, slug, email_domain, contact_email, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, name, slug, status, created_at`,
      [name, slug.toLowerCase(), email_domain || null, contact_email || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Ce slug est déjà utilisé' });
    }
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la création de l\'entreprise' });
  }
};

exports.updateTenantStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ message: 'Statut invalide' });
  }

  try {
    const result = await db.query(
      'UPDATE tenants SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, slug, status',
      [status, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Entreprise non trouvée' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour' });
  }
};

exports.deleteTenant = async (req, res) => {
  const { id } = req.params;
  try {
    // Supprimer en cascade (les contraintes FK gèrent)
    await db.query('DELETE FROM tenants WHERE id = $1', [id]);
    res.json({ message: 'Entreprise supprimée' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la suppression' });
  }
};
