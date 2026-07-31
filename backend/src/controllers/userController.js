const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const bcrypt = require('bcryptjs');

exports.getAllUsers = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    const result = await tenantDb.query(
      tenantId,
      'SELECT id, username, email, full_name, role, section FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des utilisateurs' });
  }
};

exports.createUser = async (req, res) => {
  const { username, password, full_name, email, section, role } = req.body;
  const tenantId = req.user.tenant_id;

  try {
    const userCheck = await db.query(
      'SELECT * FROM users WHERE (username = $1 OR email = $2) AND tenant_id = $3',
      [username, email, tenantId]
    );
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: "L'utilisateur ou l'email existe déjà dans cette entreprise" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await tenantDb.insert(
      tenantId,
      'users',
      ['username', 'password_hash', 'full_name', 'email', 'section', 'role'],
      [username, hashedPassword, full_name, email, section, role],
      'id, username, email, role'
    );

    res.status(201).json({
      message: 'Utilisateur créé avec succès',
      user: newUser.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur lors de la création de l'utilisateur" });
  }
};

exports.updateUserRole = async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  const tenantId = req.user.tenant_id;

  try {
    await db.query(
      'UPDATE users SET role = $1 WHERE id = $2 AND tenant_id = $3',
      [role, id, tenantId]
    );
    res.json({ message: "Rôle de l'utilisateur mis à jour avec succès" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du rôle' });
  }
};

exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.tenant_id;
  try {
    await db.query(
      'DELETE FROM users WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    res.json({ message: 'Utilisateur supprimé avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de la suppression de l'utilisateur" });
  }
};

exports.getProfile = async (req, res) => {
  const userId = req.user.id;
  try {
    let result;
    try {
      result = await db.query(
        'SELECT id, username, full_name, email, section, role, created_at, tenant_id FROM users WHERE id = $1',
        [userId]
      );
    } catch (err) {
      if (err.code === '42703') {
        result = await db.query(
          'SELECT id, username, full_name, email, section, role, created_at FROM users WHERE id = $1',
          [userId]
        );
      } else {
        throw err;
      }
    }
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération du profil' });
  }
};

exports.updateProfile = async (req, res) => {
  const userId = req.user.id;
  const { full_name, email, section } = req.body;

  try {
    if (email) {
      const emailCheck = await db.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, userId]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Cet email est déjà utilisé par un autre compte' });
      }
    }

    const result = await db.query(
      `UPDATE users SET full_name = COALESCE($1, full_name), email = COALESCE($2, email), section = COALESCE($3, section)
       WHERE id = $4 RETURNING id, username, full_name, email, section, role, created_at`,
      [full_name, email, section, userId]
    );

    res.json({
      message: 'Profil mis à jour avec succès',
      user: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du profil' });
  }
};

exports.changePassword = async (req, res) => {
  const userId = req.user.id;
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ message: 'Les mots de passe sont requis' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ message: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
  }

  try {
    const userResult = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Le mot de passe actuel est incorrect' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, userId]);
    res.json({ message: 'Mot de passe modifié avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du changement de mot de passe' });
  }
};
