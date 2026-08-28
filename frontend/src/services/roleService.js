import api from './api';

// ============================================================================
// roleService — rôles et permissions de l'organisation (RBAC).
//
// Le catalogue (modules, permissions, libellés) vient de /roles/catalogue :
// la matrice d'administration se construit sur ce que le SERVEUR connaît, pas
// sur une copie locale qui divergerait à la première permission ajoutée.
// ============================================================================
export const roleService = {
  /** Liste des rôles du tenant (avec users_count). */
  getRoles: async () => {
    const response = await api.get('/roles');
    return response.data;
  },

  /** Catalogue des permissions (modules + libellés). */
  getCatalogue: async () => {
    const response = await api.get('/roles/catalogue');
    return response.data;
  },

  /** Porteurs d'un rôle. */
  getRoleUsers: async (key) => {
    const response = await api.get(`/roles/${encodeURIComponent(key)}/users`);
    return response.data;
  },

  /** Créer un rôle personnalisé. */
  createRole: async (data) => {
    const response = await api.post('/roles', data);
    return response.data;
  },

  /** Modifier un rôle (nom, description, permissions, activation). */
  updateRole: async (key, data) => {
    const response = await api.patch(`/roles/${encodeURIComponent(key)}`, data);
    return response.data;
  },

  /** Supprimer un rôle (ni système ni porté). */
  deleteRole: async (key) => {
    const response = await api.delete(`/roles/${encodeURIComponent(key)}`);
    return response.data;
  },
};
