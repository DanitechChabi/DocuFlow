// ============================================================================
// requestAccessService — qui peut voir quelle demande.
//
// Trois contrôles avaient chacun leur liste de rôles en dur
// (['archiviste', 'admin', 'superadmin']) : la fiche détaillée, les pièces
// jointes, et rien du tout sur GET /api/requests/all, qui n'exigeait que
// requests.view — permission que porte le demandeur. Un demandeur pouvait
// donc lister TOUTES les demandes de son organisation d'un simple appel API.
// À l'inverse, un rôle « agent » ou « responsable » ne pouvait pas ouvrir la
// fiche d'une demande qu'on lui avait pourtant assignée.
//
// La règle tient ici, une seule fois :
//   * voir TOUTES les demandes = traiter (requests.process) ou affecter
//     (requests.assign) — le personnel de traitement et de supervision ;
//   * voir UNE demande = en être l'auteur, en être l'assigné, ou voir toutes.
// requests.view ne suffit plus pour « toutes » : c'est la permission de
// consulter SES demandes (voir sa description dans config/permissions.js).
// ============================================================================
const roleService = require('./roleService');

const PERMISSIONS_VUE_GLOBALE = ['requests.process', 'requests.assign'];

/** L'utilisateur voit-il toutes les demandes de son organisation ? */
async function peutVoirToutes(user) {
  if (!user) return false;
  for (const permission of PERMISSIONS_VUE_GLOBALE) {
    if (await roleService.possede(user.tenant_id, user.role, permission)) return true;
  }
  return false;
}

/**
 * L'utilisateur peut-il consulter cette demande ?
 * @param {Object} user    - { id, tenant_id, role }
 * @param {Object} request - ligne requests (au moins id_user, assignee_id)
 */
async function peutConsulter(user, request) {
  if (!user || !request) return false;
  if (request.id_user === user.id) return true;
  if (request.assignee_id != null && request.assignee_id === user.id) return true;
  return peutVoirToutes(user);
}

module.exports = { PERMISSIONS_VUE_GLOBALE, peutVoirToutes, peutConsulter };
