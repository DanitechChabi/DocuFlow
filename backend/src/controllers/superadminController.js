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
 *
 * La suppression échouait auparavant pour tout compte ayant une activité : treize
 * clés étrangères pointaient vers `users(id)` sans clause ON DELETE, dont
 * `audit_logs.id_user` — et `auditMiddleware` écrit une ligne d'audit à chaque
 * écriture HTTP. Postgres renvoyait 23503, converti ici en 500 opaque. La
 * migration 014 pose les règles manquantes (SET NULL sur l'attribution, CASCADE
 * sur les notifications) ; ce contrôleur en tire parti et, surtout, ne masque
 * plus la cause quand quelque chose bloque encore.
 */
exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  const userId = Number(id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Identifiant utilisateur invalide' });
  }
  if (userId === req.user.id) {
    return res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre propre compte' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const targetRes = await client.query(
      'SELECT id, role, username, full_name, tenant_id FROM users WHERE id = $1',
      [userId]
    );
    const target = targetRes.rows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    if (target.role === 'superadmin') {
      const saCount = await client.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'superadmin'");
      if (saCount.rows[0].n <= 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Impossible de supprimer le dernier superadmin de la plateforme' });
      }
    }

    // Le SET NULL de la migration 014 sur `audit_logs.id_user` / `actor_id` est
    // un UPDATE, que le trigger append-only refuse. Le drapeau l'autorise pour
    // cette seule anonymisation ; SET LOCAL le confine à cette transaction, il
    // ne peut pas fuir vers une autre requête via le pool.
    await client.query("SET LOCAL docuflow.audit_override = 'on'");

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    await client.query('COMMIT');
    res.json({
      message: `Utilisateur « ${target.full_name || target.username} » supprimé avec succès`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[superadmin] suppression utilisateur impossible :', err);

    // 23503 = violation de clé étrangère. Nommer la table blocante évite de
    // renvoyer « Erreur » quand il manque simplement la migration 014.
    if (err.code === '23503') {
      return res.status(409).json({
        message: `Suppression impossible : des données liées le référencent encore (table « ${err.table || 'inconnue'} »). `
          + 'La migration 014_admin_deletion_rules.sql doit être appliquée sur cette base.',
      });
    }
    res.status(500).json({ message: "Erreur lors de la suppression de l'utilisateur" });
  } finally {
    client.release();
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

    // Le trigger append-only refuse le DELETE sur audit_logs, et le refus
    // avortait toute la transaction : le `.catch(() => {})` qui entourait
    // autrefois ces requêtes masquait l'erreur JS mais pas l'abandon Postgres,
    // si bien que les suppressions suivantes échouaient en cascade avec
    // « current transaction is aborted ». Le drapeau lève le blocage à la
    // source, et les requêtes n'ont plus besoin d'être tolérées en échec.
    await client.query("SET LOCAL docuflow.audit_override = 'on'");

    await client.query('DELETE FROM request_history WHERE request_id = $1', [id]);
    await client.query('DELETE FROM audit_logs WHERE request_id = $1', [id]);
    await client.query('DELETE FROM request_files WHERE request_id = $1', [id]);

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

// ============================================================================
// Suppression d'entreprise et purge du journal d'audit
// ============================================================================

/**
 * Tenant du propriétaire de la plateforme. Il héberge le compte superadmin
 * global : le supprimer rendrait la console d'administration inaccessible et
 * orphelines toutes les autres entreprises. Refus par conception.
 */
const PLATFORM_TENANT_ID = 1;

/**
 * DELETE /tenants/:id — Supprime définitivement une entreprise et ses données.
 *
 * Irréversible. Deux garde-fous plutôt qu'un :
 *   - le tenant 1 (plateforme) est intouchable ;
 *   - l'appelant doit renvoyer le nom exact de l'entreprise dans `confirm`, ce
 *     qui écarte le clic accidentel sur la mauvaise carte — la confirmation
 *     porte sur l'identité de la cible, pas sur l'intention de supprimer.
 *
 * La suppression repose sur les CASCADE posées par la migration 014 (les dix
 * colonnes `tenant_id` étaient en NO ACTION). `tenantController.deleteTenant`
 * affirmait déjà « les contraintes FK gèrent » : c'est vrai depuis 014 seulement.
 */
exports.deleteTenant = async (req, res) => {
  const tenantId = Number(req.params.id);
  const { confirm } = req.body || {};

  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return res.status(400).json({ message: 'Identifiant d\'entreprise invalide' });
  }
  if (tenantId === PLATFORM_TENANT_ID) {
    return res.status(400).json({
      message: 'L\'entreprise propriétaire de la plateforme ne peut pas être supprimée',
    });
  }
  if (tenantId === req.user.tenant_id) {
    return res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre propre entreprise' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const tenantRes = await client.query('SELECT id, name, slug FROM tenants WHERE id = $1', [tenantId]);
    const tenant = tenantRes.rows[0];
    if (!tenant) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Entreprise introuvable' });
    }

    // Comparaison insensible à la casse et aux espaces de bord : on vérifie que
    // l'appelant a désigné la bonne entreprise, pas sa dextérité au clavier.
    const expected = String(tenant.name || '').trim().toLowerCase();
    if (String(confirm || '').trim().toLowerCase() !== expected) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Confirmation invalide : saisissez exactement « ${tenant.name} » pour confirmer la suppression`,
      });
    }

    // Volumétrie relevée AVANT la suppression : elle part dans le journal, seule
    // trace de ce que l'entreprise contenait une fois ses lignes disparues.
    const counts = await client.query(
      `SELECT (SELECT COUNT(*) FROM users     WHERE tenant_id = $1)::int AS users,
              (SELECT COUNT(*) FROM requests  WHERE tenant_id = $1)::int AS requests,
              (SELECT COUNT(*) FROM documents WHERE tenant_id = $1)::int AS documents,
              (SELECT COUNT(*) FROM audit_logs WHERE tenant_id = $1)::int AS audit_logs`,
      [tenantId]
    );
    const removed = counts.rows[0];

    // Les CASCADE de 014 emportent `audit_logs` du tenant : c'est un DELETE, que
    // le trigger append-only refuse sans ce drapeau. Le journal de l'entreprise
    // disparaît avec elle — le conserver serait d'ailleurs contraire à la
    // minimisation des données une fois le client parti.
    await client.query("SET LOCAL docuflow.audit_override = 'on'");

    await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);

    // Journalisé dans le tenant de la plateforme, pas dans celui qui vient de
    // disparaître : l'écrire dans le tenant supprimé violerait la clé étrangère.
    await client.query(
      `INSERT INTO audit_logs (tenant_id, id_user, action, ip_address, user_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.tenant_id,
        req.user.id,
        `Entreprise supprimée : « ${tenant.name} » (${tenant.slug || 'sans slug'}) — `
          + `${removed.users} utilisateur(s), ${removed.requests} demande(s), `
          + `${removed.documents} document(s), ${removed.audit_logs} entrée(s) de journal`,
        req.ip,
        req.user.username || `Utilisateur ${req.user.id}`,
      ]
    );

    await client.query('COMMIT');
    res.json({ message: `Entreprise « ${tenant.name} » supprimée définitivement`, removed });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[superadmin] suppression entreprise impossible :', err);

    if (err.code === '23503') {
      return res.status(409).json({
        message: `Suppression impossible : des données liées subsistent (table « ${err.table || 'inconnue'} »). `
          + 'La migration 014_admin_deletion_rules.sql doit être appliquée sur cette base.',
      });
    }
    res.status(500).json({ message: "Erreur lors de la suppression de l'entreprise" });
  } finally {
    client.release();
  }
};

/**
 * GET /audit — Journal d'audit de TOUTES les entreprises.
 *
 * `auditService.getLogs` passe par db-tenant, qui restreint au tenant appelant :
 * inadapté à la console globale, qui doit voir la plateforme entière. La requête
 * est donc écrite directement ici, en lecture seule.
 *
 * Query : ?tenant_id=<n> pour cibler une entreprise, ?limit / ?offset.
 */
exports.getGlobalAuditLogs = async (req, res) => {
  const { tenant_id } = req.query;
  const parsedLimit = parseInt(req.query.limit, 10);
  const parsedOffset = parseInt(req.query.offset, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 100;
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  const params = [];
  let where = '';
  if (tenant_id) {
    const tid = Number(tenant_id);
    if (!Number.isInteger(tid) || tid <= 0) {
      return res.status(400).json({ message: 'Identifiant d\'entreprise invalide' });
    }
    params.push(tid);
    where = `WHERE a.tenant_id = $${params.length}`;
  }

  try {
    // Tri sur `id` : monotone et toujours renseigné, contrairement aux deux
    // colonnes de date (`timestamp` historique, `occurred_at` GED) dont l'une
    // peut être nulle selon la génération de la ligne.
    const result = await db.query(
      `SELECT a.id, a.tenant_id, a.action, a.ip_address, a.request_id,
              a.id_user, a.actor_id, a.user_name, a.actor_username,
              a."timestamp", a.occurred_at, a.details_json,
              t.name AS tenant_name, u.full_name AS actor_full_name
       FROM audit_logs a
       LEFT JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN users u ON u.id = COALESCE(a.actor_id, a.id_user)
       ${where}
       ORDER BY a.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const totalRes = await db.query(
      `SELECT COUNT(*)::int AS n FROM audit_logs a ${where}`,
      params
    );

    // Même normalisation que auditService : le frontend lit un seul contrat,
    // quelle que soit la génération de colonnes de la ligne.
    const logs = result.rows.map((row) => ({
      ...row,
      actor_name: row.actor_username || row.user_name || row.actor_full_name || null,
      occurred_at: row.occurred_at || row.timestamp || null,
      details: row.details_json ?? null,
    }));

    res.json({ logs, total: totalRes.rows[0].n, limit, offset });
  } catch (err) {
    if (isMissingTable(err)) {
      return res.json({ logs: [], total: 0, limit, offset });
    }
    console.error('[superadmin] lecture du journal impossible :', err);
    res.status(500).json({ message: 'Erreur lors de la récupération du journal d\'audit' });
  }
};

/**
 * DELETE /audit — Purge le journal d'audit.
 *
 * `audit_logs` est append-only par conception (trigger `trg_audit_no_update`,
 * exigences GoBD / NF Z42-013). Cette route est la seule dérogation, et elle est
 * construite pour rester une exception traçable :
 *
 *   - elle exige `confirm: 'VIDER LE JOURNAL'`, saisi à la main ;
 *   - elle ouvre le drapeau `docuflow.audit_override` par SET LOCAL, donc pour
 *     cette transaction seulement ;
 *   - elle écrit, dans la même transaction, une entrée indiquant combien de
 *     lignes ont été purgées, par qui et depuis quelle IP. Le journal ne
 *     redémarre jamais vide : sa première ligne est le récit de sa purge.
 *
 * Filtres : ?tenant_id=<n> (une entreprise), ?before=<ISO 8601> (archivage
 * glissant, l'usage le plus sain — ne purger que le passé lointain).
 */
exports.purgeAuditLogs = async (req, res) => {
  const { confirm, tenant_id, before } = req.body || {};

  if (String(confirm || '').trim() !== 'VIDER LE JOURNAL') {
    return res.status(400).json({
      message: 'Confirmation requise : saisissez exactement « VIDER LE JOURNAL »',
    });
  }

  const conditions = [];
  const params = [];
  let scope = 'toutes les entreprises';

  if (tenant_id !== undefined && tenant_id !== null && tenant_id !== '') {
    const tid = Number(tenant_id);
    if (!Number.isInteger(tid) || tid <= 0) {
      return res.status(400).json({ message: 'Identifiant d\'entreprise invalide' });
    }
    params.push(tid);
    conditions.push(`tenant_id = $${params.length}`);
    scope = `entreprise #${tid}`;
  }

  if (before) {
    const cutoff = new Date(before);
    if (Number.isNaN(cutoff.getTime())) {
      return res.status(400).json({ message: 'Date « before » invalide (format ISO 8601 attendu)' });
    }
    params.push(cutoff.toISOString());
    // COALESCE : les lignes anciennes n'ont que `timestamp`, les récentes
    // `occurred_at`. Filtrer sur une seule colonne épargnerait la moitié du
    // journal sans le dire.
    conditions.push(`COALESCE(occurred_at, "timestamp") < $${params.length}`);
    scope += ` antérieur au ${cutoff.toISOString().slice(0, 10)}`;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL docuflow.audit_override = 'on'");

    const deleted = await client.query(`DELETE FROM audit_logs ${where}`, params);

    // Trace de la purge, écrite après le DELETE pour ne pas être emportée par
    // lui : le journal conserve toujours au minimum le récit de son effacement.
    await client.query(
      `INSERT INTO audit_logs (tenant_id, id_user, action, ip_address, user_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.user.tenant_id,
        req.user.id,
        `Journal d'audit purgé : ${deleted.rowCount} entrée(s) supprimée(s) (${scope})`,
        req.ip,
        req.user.username || `Utilisateur ${req.user.id}`,
      ]
    );

    await client.query('COMMIT');
    res.json({
      message: `${deleted.rowCount} entrée(s) supprimée(s) du journal d'audit`,
      deleted: deleted.rowCount,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[superadmin] purge du journal impossible :', err);

    // 23514 (check_violation) : code posé par le trigger append-only quand le
    // drapeau n'a pas été reconnu — signe que la migration 014 manque et que
    // l'ancien trigger, sans dérogation, est encore en place.
    if (err.code === '23514' || /append-only/i.test(err.message || '')) {
      return res.status(409).json({
        message: 'Le journal est verrouillé en append-only par la base. '
          + 'La migration 014_admin_deletion_rules.sql doit être appliquée pour autoriser la purge administrative.',
      });
    }
    res.status(500).json({ message: 'Erreur lors de la purge du journal d\'audit' });
  } finally {
    client.release();
  }
};
