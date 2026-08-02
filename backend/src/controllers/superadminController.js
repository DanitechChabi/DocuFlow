/**
 * superadminController — Contrôle global de la plateforme.
 * Le superadmin (utilisateur suprême) peut voir et gérer TOUS les utilisateurs,
 * y compris les autres superadmins, sur TOUS les tenants.
 */
const db = require('../config/db');
const bcrypt = require('bcryptjs');

const ALL_ROLES = ['demandeur', 'archiviste', 'admin', 'superadmin'];

// Erreur « relation n'existe pas » : table absente (base pré-migration)
const isMissingTable = (err) => err.code === '42P01' || err.code === '42703';

/**
 * GET / — Vue globale de tous les utilisateurs (tous tenants)
 * Retourne aussi les infos tenant, demandes ouvertes et messages non lus.
 */
exports.getAllUsers = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.section, u.tenant_id,
              t.name AS tenant_name, t.slug AS tenant_slug, u.created_at,
              (SELECT COUNT(*) FROM requests r
                WHERE r.id_user = u.id
                  AND r.statut NOT IN ('livré', 'rejete', 'annulé')) AS open_requests
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    if (isMissingTable(err)) {
      return res.json([]);
    }
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des utilisateurs' });
  }
};

/**
 * GET /superadmins — Liste des superadmins uniquement (garde-fous globaux)
 */
exports.getSuperAdmins = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.tenant_id,
              t.name AS tenant_name, t.slug AS tenant_slug, u.created_at
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.role = 'superadmin'
       ORDER BY u.created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    if (isMissingTable(err)) {
      return res.json([]);
    }
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des superadmins' });
  }
};

/**
 * POST / — Crée un utilisateur (n'importe quel rôle, y compris superadmin)
 */
exports.createUser = async (req, res) => {
  const { username, password, full_name, email, section, role, tenant_id } = req.body;

  if (!username || !password || !full_name || !email) {
    return res.status(400).json({ message: 'Tous les champs sont requis' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères' });
  }
  const finalRole = role || 'demandeur';
  if (!ALL_ROLES.includes(finalRole)) {
    return res.status(400).json({ message: 'Rôle invalide' });
  }

  const targetTenant = tenant_id ? Number(tenant_id) : 1;

  try {
    // Vérifier que le tenant existe
    const tenantRes = await db.query('SELECT id FROM tenants WHERE id = $1', [targetTenant]);
    if (tenantRes.rows.length === 0) {
      return res.status(400).json({ message: 'Entreprise (tenant) introuvable' });
    }

    // Vérifier unicité username/email au sein du tenant
    let existing;
    try {
      existing = await db.query(
        'SELECT id FROM users WHERE (username = $1 OR email = $2) AND tenant_id = $3',
        [username, email, targetTenant]
      );
    } catch (err) {
      if (err.code === '42703') {
        existing = await db.query(
          'SELECT id FROM users WHERE username = $1 OR email = $2',
          [username, email]
        );
      } else {
        throw err;
      }
    }
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "L'utilisateur ou l'email existe déjà dans cette entreprise" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await db.query(
      `INSERT INTO users (tenant_id, username, password_hash, full_name, email, section, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, email, full_name, role, section, tenant_id`,
      [targetTenant, username, hashedPassword, full_name, email, section || null, finalRole]
    );

    res.status(201).json({ message: 'Utilisateur créé avec succès', user: newUser.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de la création de l'utilisateur" });
  }
};

/**
 * PATCH /:id — Met à jour un utilisateur (y compris superadmin).
 * Champ(s) modifiables : full_name, email, section, role, tenant_id, username.
 */
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const userId = Number(id);
  const { full_name, email, section, role, tenant_id, username } = req.body;

  if (userId === req.user.id) {
    return res.status(400).json({ message: 'Utilisez votre page profil pour modifier votre propre compte' });
  }

  try {
    const targetRes = await db.query('SELECT id, role, tenant_id FROM users WHERE id = $1', [userId]);
    const target = targetRes.rows[0];
    if (!target) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    // Garde-fou : ne pas pouvoir dégrader le DERNIER superadmin
    if (target.role === 'superadmin' && role && role !== 'superadmin') {
      const saCount = await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'superadmin'");
      if (saCount.rows[0].n <= 1) {
        return res.status(400).json({ message: 'Impossible de dégrader le dernier superadmin de la plateforme' });
      }
    }

    const finalRole = role || target.role;
    if (!ALL_ROLES.includes(finalRole)) {
      return res.status(400).json({ message: 'Rôle invalide' });
    }

    const finalTenant = tenant_id ? Number(tenant_id) : target.tenant_id;

    await db.query(
      `UPDATE users
       SET full_name = $1, email = $2, section = $3, role = $4, tenant_id = $5, username = $6
       WHERE id = $7`,
      [full_name ?? target.full_name, email ?? target.email, section ?? target.section,
       finalRole, finalTenant, username ?? target.username, userId]
    );

    res.json({ message: 'Utilisateur mis à jour avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de la mise à jour de l'utilisateur" });
  }
};

/**
 * POST /:id/reset-password — Réinitialise le mot de passe d'un utilisateur.
 */
exports.resetPassword = async (req, res) => {
  const { id } = req.params;
  const userId = Number(id);
  const { new_password } = req.body;

  if (!new_password || String(new_password).length < 6) {
    return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères' });
  }

  try {
    const targetRes = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(String(new_password), salt);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, userId]);

    res.json({ message: 'Mot de passe réinitialisé avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de la réinitialisation du mot de passe" });
  }
};

/**
 * DELETE /:id — Supprime un utilisateur (y compris superadmin).
 * Garde-fous : pas d'auto-suppression, pas de suppression du dernier superadmin.
 */
exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  const userId = Number(id);

  if (userId === req.user.id) {
    return res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre propre compte' });
  }

  try {
    const targetRes = await db.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    const target = targetRes.rows[0];
    if (!target) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    if (target.role === 'superadmin') {
      const saCount = await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'superadmin'");
      if (saCount.rows[0].n <= 1) {
        return res.status(400).json({ message: 'Impossible de supprimer le dernier superadmin de la plateforme' });
      }
    }

    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ message: 'Utilisateur supprimé avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de la suppression de l'utilisateur" });
  }
};

/**
 * GET /stats — Statistiques globales de la plateforme.
 */
// S'assure que la colonne `archived` existe sur requests (migration auto)
async function ensureArchivedColumn() {
  try {
    await db.query('ALTER TABLE requests ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE');
  } catch (e) {
    /* table absente ou colonne déjà présente */
  }
}

// Statistiques par entreprise : nombre de demandes, en cours, livrées, archivées
const REQUESTS_BY_TENANT_SQL = `
  SELECT t.id AS tenant_id, t.name AS tenant_name, t.slug, t.status AS tenant_status,
         COUNT(r.id)::int AS total_requests,
         COUNT(r.id) FILTER (WHERE r.statut NOT IN ('livré', 'rejete', 'annulé') AND r.archived = FALSE)::int AS active_requests,
         COUNT(r.id) FILTER (WHERE r.statut IN ('livré', 'rejete', 'annulé') AND r.archived = FALSE)::int AS closed_requests,
         COUNT(r.id) FILTER (WHERE r.archived = TRUE)::int AS archived_requests,
         COALESCE(SUM(CASE WHEN r.archived = FALSE THEN 1 ELSE 0 END), 0)::int AS visible_requests
  FROM tenants t
  LEFT JOIN requests r ON r.tenant_id = t.id
  GROUP BY t.id, t.name, t.slug, t.status
  ORDER BY t.name ASC
`;

// Version sans la colonne archived (base pré-migration)
const REQUESTS_BY_TENANT_SQL_NO_ARCHIVE = `
  SELECT t.id AS tenant_id, t.name AS tenant_name, t.slug, t.status AS tenant_status,
         COUNT(r.id)::int AS total_requests,
         COUNT(r.id) FILTER (WHERE r.statut NOT IN ('livré', 'rejete', 'annulé'))::int AS active_requests,
         COUNT(r.id) FILTER (WHERE r.statut IN ('livré', 'rejete', 'annulé'))::int AS closed_requests,
         0::int AS archived_requests,
         COUNT(r.id)::int AS visible_requests
  FROM tenants t
  LEFT JOIN requests r ON r.tenant_id = t.id
  GROUP BY t.id, t.name, t.slug, t.status
  ORDER BY t.name ASC
`;

exports.getStats = async (req, res) => {
  try {
    const [users, tenants, requests, superadmins, activeRequests] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS n FROM users'),
      db.query('SELECT COUNT(*)::int AS n FROM tenants'),
      db.query('SELECT COUNT(*)::int AS n FROM requests'),
      db.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'superadmin'"),
      db.query("SELECT COUNT(*)::int AS n FROM requests WHERE statut NOT IN ('livré', 'rejete', 'annulé')"),
    ]);

    // Stats par entreprise (avec colonne archived si disponible)
    let requestsByTenant;
    try {
      await ensureArchivedColumn();
      const byTenant = await db.query(REQUESTS_BY_TENANT_SQL);
      requestsByTenant = byTenant.rows;
    } catch (e) {
      // Fallback : base sans archived
      const byTenant = await db.query(REQUESTS_BY_TENANT_SQL_NO_ARCHIVE);
      requestsByTenant = byTenant.rows;
    }

    res.json({
      totalUsers: users.rows[0].n,
      totalTenants: tenants.rows[0].n,
      totalRequests: requests.rows[0].n,
      totalSuperAdmins: superadmins.rows[0].n,
      activeRequests: activeRequests.rows[0].n,
      requestsByTenant,
    });
  } catch (err) {
    if (isMissingTable(err)) {
      return res.json({ totalUsers: 0, totalTenants: 0, totalRequests: 0, totalSuperAdmins: 0, activeRequests: 0, requestsByTenant: [] });
    }
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du calcul des statistiques' });
  }
};

/**
 * GET /requests — Liste toutes les demandes (tous tenants), filtrable.
 * Query params : ?archived=true|false (filtre par état d'archivage, défaut : toutes)
 */
exports.getAllRequests = async (req, res) => {
  try {
    await ensureArchivedColumn();
    const { archived } = req.query;
    const params = [];
    let where = 'WHERE 1=1';
    if (archived === 'true') {
      params.push(true);
      where += ` AND r.archived = $${params.length}`;
    } else if (archived === 'false') {
      params.push(false);
      where += ` AND r.archived = $${params.length}`;
    }
    const result = await db.query(
      `SELECT r.id, r.tenant_id, r.nom_entreprise, r.num_dossier, r.num_acte,
              r.type_document, r.motif, r.priorite, r.statut, r.archived,
              r.created_at, r.date_livraison,
              t.name AS tenant_name, t.slug AS tenant_slug,
              u.full_name AS requester_name
       FROM requests r
       LEFT JOIN tenants t ON t.id = r.tenant_id
       LEFT JOIN users u ON u.id = r.id_user
       ${where}
       ORDER BY r.created_at DESC
       LIMIT 500`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    if (isMissingTable(err)) {
      return res.json([]);
    }
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des demandes' });
  }
};

/**
 * PATCH /requests/:id/archive — Archive une demande
 */
exports.archiveRequest = async (req, res) => {
  try {
    await ensureArchivedColumn();
    const result = await db.query(
      'UPDATE requests SET archived = TRUE WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }
    res.json({ message: 'Demande archivée avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de l'archivage" });
  }
};

/**
 * PATCH /requests/:id/unarchive — Désarchive une demande
 */
exports.unarchiveRequest = async (req, res) => {
  try {
    await ensureArchivedColumn();
    const result = await db.query(
      'UPDATE requests SET archived = FALSE WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }
    res.json({ message: 'Demande désarchivée' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du désarchivage' });
  }
};

/**
 * DELETE /requests/:id — Supprime définitivement une demande
 * (nettoyage des tables liées : request_history, audit_logs, request_files)
 */
exports.deleteRequest = async (req, res) => {
  const { id } = req.params;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const exists = await client.query('SELECT id FROM requests WHERE id = $1', [id]);
    if (exists.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    // Supprimer les tables liées (sans ON DELETE CASCADE)
    await client.query('DELETE FROM request_history WHERE request_id = $1', [id]).catch(() => {});
    await client.query('DELETE FROM audit_logs WHERE request_id = $1', [id]).catch(() => {});
    await client.query('DELETE FROM request_files WHERE request_id = $1', [id]).catch(() => {});

    // Supprimer la demande
    await client.query('DELETE FROM requests WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.json({ message: 'Demande supprimée définitivement' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ message: "Erreur lors de la suppression de la demande" });
  } finally {
    client.release();
  }
};
