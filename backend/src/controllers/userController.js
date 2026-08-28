const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const bcrypt = require('bcryptjs');
const roleService = require('../services/roleService');

/**
 * Le rôle demandé est-il attribuable dans ce tenant ?
 *
 * La liste vivait en dur (« demandeur, archiviste, admin ») : aucun rôle
 * personnalisé n'était attribuable. Elle vient désormais de la table roles —
 * « superadmin » y est refusé : ce rôle reste réservé au propriétaire de
 * plateforme (routes /api/superadmin), et l'administrateur d'entreprise ne
 * doit pas pouvoir s'élever.
 */
async function validerRole(tenantId, role) {
  if (!role || typeof role !== 'string') {
    return { ok: false, message: 'Rôle requis.' };
  }
  if (role === 'superadmin') {
    return { ok: false, message: 'Le rôle super administrateur est géré par le propriétaire de la plateforme.' };
  }
  try {
    const { ok } = await roleService.roleAttribuable(tenantId, role);
    if (!ok) {
      return { ok: false, message: `Rôle « ${role} » inconnu ou désactivé dans votre organisation.` };
    }
    return { ok: true };
  } catch (err) {
    if (err.code === '42P01') {
      // Pré-RBAC : la table roles n'existe pas — la liste historique fait foi.
      const legacy = ['demandeur', 'archiviste', 'admin'];
      return legacy.includes(role)
        ? { ok: true }
        : { ok: false, message: 'Rôle invalide. Rôles autorisés : demandeur, archiviste, admin' };
    }
    throw err;
  }
}

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

// Liste des archivistes/admins (pour l'attribution des demandes), avec charge de travail
exports.getArchivists = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const role = req.user.role;

  if (!['archiviste', 'admin', 'superadmin'].includes(role)) {
    return res.status(403).json({ message: 'Accès réservé au personnel' });
  }

  try {
    const result = await db.query(
      `SELECT u.id, u.full_name, u.email, u.role,
              (SELECT COUNT(*) FROM requests r
                WHERE r.assignee_id = u.id
                  AND r.tenant_id = $1
                  AND r.statut NOT IN ('livré', 'rejete', 'annulé')) AS open_tasks
       FROM users u
       WHERE u.role IN ('archiviste', 'admin', 'superadmin')
         AND u.tenant_id = $1
       ORDER BY u.full_name ASC`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des archivistes' });
  }
};

exports.createUser = async (req, res) => {
  const { username, password, full_name, email, section, role } = req.body;
  const tenantId = req.user.tenant_id;

  // Validation du rôle : n'importe quel rôle ACTIF de l'organisation (table
  // roles), rôles personnalisés compris — plus de liste en dur. « superadmin »
  // reste réservé au propriétaire de plateforme (routes /api/superadmin).
  const roleCheck = await validerRole(tenantId, role);
  if (!roleCheck.ok) {
    return res.status(400).json({ message: roleCheck.message });
  }

  try {
    let userCheck;
    try {
      userCheck = await db.query(
        'SELECT * FROM users WHERE (username = $1 OR email = $2) AND tenant_id = $3',
        [username, email, tenantId]
      );
    } catch (err) {
      if (err.code === '42703') {
        // Colonne tenant_id absente (mode mono-tenant)
        userCheck = await db.query(
          'SELECT * FROM users WHERE username = $1 OR email = $2',
          [username, email]
        );
      } else {
        throw err;
      }
    }
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: "L'utilisateur ou l'email existe déjà dans cette entreprise" });
    }

    // Validation de la force du mot de passe
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères' });
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

  // Validation du rôle : tout rôle actif de l'organisation, personnalisés
  // compris (voir createUser).
  const roleCheck = await validerRole(tenantId, role);
  if (!roleCheck.ok) {
    return res.status(400).json({ message: roleCheck.message });
  }

  // Empêcher de modifier son propre rôle
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ message: 'Vous ne pouvez pas modifier votre propre rôle' });
  }

  try {
    // Vérifier que l'utilisateur cible existe et appartient au même tenant
    let targetUser;
    try {
      const targetResult = await db.query('SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      targetUser = targetResult.rows[0];
    } catch (err) {
      if (err.code === '42703') {
        const targetResult = await db.query('SELECT id, role FROM users WHERE id = $1', [id]);
        targetUser = targetResult.rows[0];
      } else {
        throw err;
      }
    }

    if (!targetUser) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    // Empêcher de modifier le rôle d'un superadmin
    if (targetUser.role === 'superadmin') {
      return res.status(403).json({ message: 'Impossible de modifier le rôle d\'un superadmin' });
    }

    // Tentative avec tenant_id ; fallback si colonne absente (mode mono-tenant).
    // token_version est incrémenté : le changement de rôle invalide les jetons
    // encore en circulation de ce compte — l'ancien jeton portait des droits
    // que ce compte n'a plus.
    try {
      await db.query(
        'UPDATE users SET role = $1, token_version = token_version + 1 WHERE id = $2 AND tenant_id = $3',
        [role, id, tenantId]
      );
      roleService.invalidateUser(Number(id));
    } catch (err) {
      if (err.code === '42703') {
        await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
      } else {
        throw err;
      }
    }
    res.json({ message: "Rôle de l'utilisateur mis à jour avec succès" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du rôle' });
  }
};

exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.tenant_id;

  // Empêcher l'auto-suppression
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre propre compte' });
  }

  try {
    // Vérifier que l'utilisateur cible existe et appartient au même tenant
    let targetUser;
    try {
      const targetResult = await db.query('SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      targetUser = targetResult.rows[0];
    } catch (err) {
      if (err.code === '42703') {
        const targetResult = await db.query('SELECT id, role FROM users WHERE id = $1', [id]);
        targetUser = targetResult.rows[0];
      } else {
        throw err;
      }
    }

    if (!targetUser) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    // Empêcher la suppression d'un superadmin
    if (targetUser.role === 'superadmin') {
      return res.status(403).json({ message: 'Impossible de supprimer un compte superadmin' });
    }

    // Tentative avec tenant_id ; fallback si colonne absente (mode mono-tenant)
    try {
      await db.query(
        'DELETE FROM users WHERE id = $1 AND tenant_id = $2',
        [id, tenantId]
      );
    } catch (err) {
      if (err.code === '42703') {
        await db.query('DELETE FROM users WHERE id = $1', [id]);
      } else {
        throw err;
      }
    }
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
