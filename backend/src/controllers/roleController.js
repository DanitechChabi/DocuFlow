// ============================================================================
// roleController — administration des rôles et permissions d'une organisation.
//
// ÉCRITURE PROTÉGÉE PAR permissions.manage (voir roleRoutes) : celui qui
// définit qui a le droit de faire quoi détient le pouvoir le plus sensible de
// l'organisation — la matrice ne s'édite pas avec la permission qu'elle
// accorde (escalade de privilèges sinon : un rôle « éditeur de rôles »
// s'attribuerait '*' en une requête).
// ============================================================================
const roleService = require('../services/roleService');
const { CATALOGUE, TOUTES, estValide } = require('../config/permissions');
const db = require('../config/db');

/** Clé de rôle attribuable : minuscules, tirets, 3-50 caractères. */
const KEY_RE = /^[a-z][a-z0-9-]{2,49}$/;

/** Expose le catalogue (l'interface construit la matrice avec). */
exports.catalogue = (req, res) => {
  res.json({ catalogue: CATALOGUE, total: TOUTES.length });
};

/** Liste des rôles du tenant, avec le nombre d'utilisateurs de chacun. */
exports.list = async (req, res) => {
  try {
    const roles = await roleService.listRoles(req.user.tenant_id);
    res.json(roles);
  } catch (err) {
    if (err.code === '42P01') {
      // Pré-RBAC : la table n'existe pas — les rôles système en code, sans
      // effectifs, pour que l'interface affiche quelque chose de vrai.
      return res.json(
        roleService && (require('../config/permissions').ROLES_SYSTEME.map((r) => ({
          ...r, is_system: true, is_active: true, users_count: null,
        })))
      );
    }
    console.error('[roles] liste :', err.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des rôles.' });
  }
};

/**
 * POST / — crée un rôle personnalisé.
 * Corps : { key, name, description, permissions: string[] }
 */
exports.create = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { key, name, description, permissions } = req.body || {};

  if (!KEY_RE.test(String(key || ''))) {
    return res.status(400).json({
      message: 'La clé du rôle doit contenir 3 à 50 caractères : lettres minuscules, chiffres et tirets, commençant par une lettre.',
    });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: 'Le nom du rôle est requis.' });
  }
  if (!Array.isArray(permissions)) {
    return res.status(400).json({ message: 'permissions doit être un tableau de clés.' });
  }
  // Refus explicite du joker : seul le super administrateur système le porte.
  if (permissions.includes('*')) {
    return res.status(400).json({ message: 'Les rôles personnalisés ne peuvent pas porter toutes les permissions.' });
  }
  const inconnues = permissions.filter((p) => !estValide(p));
  if (inconnues.length) {
    return res.status(400).json({ message: `Permissions inconnues : ${inconnues.join(', ')}` });
  }

  try {
    const role = await roleService.createRole(tenantId, {
      key: String(key),
      name: String(name).trim(),
      description: description ? String(description).trim().slice(0, 500) : null,
      permissions,
    });
    res.status(201).json({ message: `Rôle « ${role.name} » créé.`, role });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: `La clé « ${key} » est déjà utilisée dans votre organisation.` });
    }
    console.error('[roles] création :', err.message);
    res.status(err.status || 500).json({ message: err.message || 'Erreur lors de la création du rôle.' });
  }
};

/**
 * PATCH /:key — modifie nom, description, permissions, activation.
 * La clé d'un rôle système est immuable ; ses PERMISSIONS, elles, sont
 * éditables — c'est précisément le levier d'administration (accorder la GED
 * au rôle demandeur remplace l'ancien réglage ged_access_role).
 */
exports.update = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { key } = req.params;
  const { name, description, permissions, is_active } = req.body || {};

  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ message: 'permissions doit être un tableau de clés.' });
    }
    if (permissions.includes('*')) {
      return res.status(400).json({ message: 'Les rôles personnalisés ne peuvent pas porter toutes les permissions.' });
    }
    const inconnues = permissions.filter((p) => !estValide(p));
    if (inconnues.length) {
      return res.status(400).json({ message: `Permissions inconnues : ${inconnues.join(', ')}` });
    }
  }

  try {
    // Toute modification de permissions invalide les jetons des porteurs du
    // rôle : leurs sessions portaient des droits que le rôle n'a plus.
    const role = await roleService.updateRole(tenantId, key, { name, description, permissions, is_active }, async () => {
      await db.query(
        'UPDATE users SET token_version = token_version + 1 WHERE tenant_id = $1 AND role = $2',
        [tenantId, key]
      );
      // Le cache utilisateur doit rafraîchir — token_version a bougé.
      roleService.invalidate();
    });
    if (!role) return res.status(404).json({ message: 'Rôle non trouvé.' });
    res.json({ message: `Rôle « ${role.name} » mis à jour.`, role });
  } catch (err) {
    console.error('[roles] mise à jour :', err.message);
    res.status(err.status || 500).json({ message: err.message || 'Erreur lors de la mise à jour du rôle.' });
  }
};

/** DELETE /:key — seulement si ni système ni porté. */
exports.remove = async (req, res) => {
  try {
    const supprime = await roleService.deleteRole(req.user.tenant_id, req.params.key);
    if (!supprime) return res.status(404).json({ message: 'Rôle non trouvé.' });
    res.json({ message: 'Rôle supprimé.' });
  } catch (err) {
    console.error('[roles] suppression :', err.message);
    res.status(err.status || 500).json({ message: err.message || 'Erreur lors de la suppression du rôle.' });
  }
};

/**
 * GET /:key/users — porteurs d'un rôle (l'interface propose leur
 * réassignation avant suppression).
 */
exports.users = async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, username, full_name, email FROM users WHERE tenant_id = $1 AND role = $2 ORDER BY full_name',
    [req.user.tenant_id, req.params.key]
  );
  res.json(rows);
};
