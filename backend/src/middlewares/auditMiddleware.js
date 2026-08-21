const auditService = require('../services/auditService');

/**
 * auditMiddleware — journalise les actions métier dans `audit_logs`.
 *
 * Il enregistrait auparavant CHAQUE requête HTTP, lectures comprises, sous la
 * forme « Action: GET /api/requests | Details: Status: 200 | Duration: 12ms ».
 * Le frontend appelant plusieurs endpoints par écran, le journal se remplissait
 * de trafic technique : les vraies actions (création de demande, changement de
 * statut) s'y noyaient, et le tableau de bord affichait du bruit réseau au lieu
 * de l'activité de l'organisation.
 *
 * Trois règles désormais :
 *   1. seules les écritures sont journalisées (POST, PUT, PATCH, DELETE) — une
 *      consultation ne modifie rien et n'a pas à figurer dans l'historique ;
 *   2. chaque route porte un libellé français lisible (voir LABELS) ;
 *   3. les routes qui écrivent déjà leur propre entrée en cas de succès sont
 *      ignorées dans ce cas précis (SELF_LOGGED), sans quoi une même action
 *      apparaîtrait deux fois ; leurs échecs restent journalisés ici.
 *
 * Les échecs restent tracés : un refus d'autorisation est précisément ce qu'un
 * journal d'audit doit conserver.
 */

// Méthodes qui modifient l'état. GET/HEAD/OPTIONS sont ignorées.
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Routes dont le contrôleur écrit lui-même dans `audit_logs`, avec un libellé
// plus riche que ce que l'URL permet de deviner (il y nomme l'entreprise
// concernée). Les journaliser ici créerait un doublon par action.
//   - requestController.createRequest        → « A créé une demande pour X »
//   - requestController.updateRequestStatus  → « A changé le statut de la demande X vers Y »
//   - documentController.setDocumentMetadata → documentAuditService (METADATA_UPDATE)
//   - documentController.createDocumentRelation → documentAuditService (RELATION_CREATED)
//   - superadminController.deleteTenant      → nomme l'entreprise et sa volumétrie
//   - superadminController.purgeAuditLogs    → nombre de lignes purgées et périmètre
//
// Le contournement ne vaut QUE pour les réponses en succès : ces contrôleurs
// n'écrivent leur entrée qu'une fois l'opération aboutie (et, pour la purge,
// dans la transaction qui l'exécute — un ROLLBACK l'emporte avec elle). Ignorer
// aussi les échecs ferait disparaître les refus, alors qu'une suppression
// d'entreprise refusée est précisément ce qu'un journal doit retenir.
const SELF_LOGGED = new Set([
  'POST /requests',
  'PATCH /requests/:id/status',
  'POST /documents/:id/metadata',
  'POST /documents/:id/relations',
  'DELETE /superadmin/tenants/:id',
  'DELETE /tenants/:id',
  'DELETE /superadmin/audit',
]);

// Écritures de pure mécanique d'interface : accusés de lecture déclenchés par
// l'affichage, pas par une décision de l'utilisateur. Les journaliser
// reproduirait exactement le bruit que ce filtre supprime — le frontend marque
// les notifications comme lues à chaque ouverture du panneau.
const IGNORED = new Set([
  'PATCH /notifications/:id/read',
  'PATCH /notifications/read-all',
  'PATCH /messages/conversations/:id/read',
]);

// Libellé lisible par route. Clé : « MÉTHODE /chemin » (préfixe /api retiré,
// identifiants numériques remplacés par :id).
const LABELS = {
  // Demandes
  'PATCH /requests/:id/assign': 'Demande assignée',
  'PATCH /requests/:id/document': 'Document lié à la demande',

  // Champs configurables du formulaire de demande. Ces trois routes changent ce
  // que TOUS les demandeurs voient à l'écran : retirer un champ obligatoire ou
  // en ajouter un modifie le formulaire pour l'organisation entière. Le journal
  // doit dire qui l'a fait — c'est la seule trace de la raison pour laquelle les
  // demandes d'avant et d'après ne portent pas les mêmes informations.
  'PUT /requests/fields': 'Champs du formulaire de demande modifiés',
  'POST /requests/fields/provision': 'Champs du formulaire de demande réinitialisés',
  'PATCH /requests/fields/:id/visibility': 'Visibilité d\'un champ de demande modifiée',

  // Pièces jointes des demandes et messages
  'POST /upload/request/:id': 'Pièce jointe ajoutée à la demande',
  'DELETE /upload/request/file/:id': 'Pièce jointe supprimée',
  'POST /upload/message': 'Pièce jointe envoyée',
  'POST /upload/message/:id/link': 'Pièce jointe liée au message',

  // Documents (GED)
  'POST /documents': 'Document indexé',
  'PATCH /documents/:id': 'Document modifié',
  'DELETE /documents/:id': 'Document supprimé',
  'POST /documents/:id/files': 'Fichier ajouté au document',
  'DELETE /documents/:id/files/:id': 'Fichier retiré du document',
  'POST /documents/:id/status': 'Statut du document modifié',
  'POST /documents/:id/checkout': 'Document réservé pour modification',
  'POST /documents/:id/checkin': 'Document restitué',
  'POST /documents/:id/share': 'Document partagé par e-mail',
  'POST /documents/from-request/:id': 'Demande archivée en document',
  'POST /documents/assembly/generate': 'Document assemblé généré',

  // Dossiers et vues
  'POST /documents/folders': 'Dossier créé',
  'PATCH /documents/folders/:id': 'Dossier renommé',
  'DELETE /documents/folders/:id': 'Dossier supprimé',
  'POST /documents/dynamic-views': 'Vue dynamique créée',

  // Métadonnées
  'POST /metadata/schemas': 'Schéma de métadonnées créé',
  'PUT /metadata/schemas/:id': 'Schéma de métadonnées modifié',
  'PUT /metadata/schemas/:id/sync': 'Schéma de métadonnées synchronisé',
  'DELETE /metadata/schemas/:id': 'Schéma de métadonnées supprimé',
  'POST /metadata/schemas/:id/fields': 'Champ de métadonnée créé',
  'PUT /metadata/fields/:id': 'Champ de métadonnée modifié',
  'DELETE /metadata/fields/:id': 'Champ de métadonnée supprimé',
  'PUT /metadata/documents/:id': 'Métadonnées du document mises à jour',
  'PUT /metadata/documents/:id/values/:id': 'Métadonnée du document modifiée',
  'DELETE /metadata/documents/:id/values/:id': 'Métadonnée du document supprimée',

  // Groupes
  'POST /groups': 'Groupe créé',
  'PUT /groups/:id': 'Groupe modifié',
  'DELETE /groups/:id': 'Groupe supprimé',
  'POST /groups/:id/members': 'Membre ajouté au groupe',
  'DELETE /groups/:id/members/:id': 'Membre retiré du groupe',

  // Configuration
  'PUT /settings': 'Réglages de l\'organisation modifiés',
  'POST /settings/reset': 'Réglages réinitialisés',
  'POST /settings/provision': 'Configuration par défaut installée',
  'POST /settings/logo': 'Logo de l\'organisation mis à jour',

  // Comptes
  'PUT /users/profile': 'Profil modifié',
  'PUT /users/profile/password': 'Mot de passe changé',
  'POST /users': 'Utilisateur créé',
  'PATCH /users/:id/role': 'Rôle d\'un utilisateur modifié',
  'DELETE /users/:id': 'Utilisateur supprimé',

  // Organisations
  'POST /tenants': 'Organisation créée',
  'PATCH /tenants/:id/status': 'Statut d\'une organisation modifié',
  'DELETE /tenants/:id': 'Organisation supprimée',

  // Console superadministrateur
  'PATCH /superadmin/requests/:id/archive': 'Demande archivée',
  'PATCH /superadmin/requests/:id/unarchive': 'Demande désarchivée',
  'DELETE /superadmin/requests/:id': 'Demande supprimée',
  'POST /superadmin/users': 'Utilisateur créé',
  'PATCH /superadmin/users/:id': 'Utilisateur modifié',
  'DELETE /superadmin/users/:id': 'Utilisateur supprimé',
  'POST /superadmin/users/:id/reset-password': 'Mot de passe d\'un utilisateur réinitialisé',

  // Licences de bureau. Ces quatre routes ont une valeur commerciale directe —
  // une émission, une prolongation ou une révocation doit laisser une trace
  // nominative, c'est le journal qui répond à « qui a offert ce mois-ci ? ».
  //
  // Les activations côté client (POST /licenses/activate, /refresh) ne figurent
  // pas ici : elles sont ANONYMES par construction (le poste n'a pas de compte
  // au moment de s'activer), et `audit_logs.tenant_id` est NOT NULL. Le
  // middleware les écarte donc en amont, comme il écarte déjà la connexion.
  'POST /superadmin/licenses': 'Licence de bureau émise',
  'PATCH /superadmin/licenses/:id': 'Licence de bureau modifiée',
  'POST /superadmin/licenses/:id/reset-machine': 'Poste délié d\'une licence',

  // Opérations irréversibles : le libellé ne sert qu'aux ÉCHECS (en cas de
  // succès, le contrôleur écrit lui-même une entrée détaillée — voir SELF_LOGGED).
  'DELETE /superadmin/tenants/:id': 'Suppression d\'une entreprise',
  'DELETE /tenants/:id': 'Suppression d\'une entreprise',
  'DELETE /superadmin/audit': 'Purge du journal d\'audit',
  // Divers
  'POST /messages': 'Message envoyé',
  'POST /sections': 'Section créée',
  'DELETE /sections/:id': 'Section supprimée',
};

// Traduction de la première partie du chemin, pour le libellé de repli d'une
// route non encore répertoriée. Perdre une écriture serait plus grave que
// d'afficher un libellé approximatif : un journal d'audit doit rester exhaustif.
const RESOURCES = {
  requests: 'une demande',
  documents: 'un document',
  metadata: 'les métadonnées',
  groups: 'un groupe',
  settings: 'la configuration',
  users: 'un utilisateur',
  tenants: 'une organisation',
  superadmin: 'la console d\'administration',
  upload: 'un fichier',
  messages: 'la messagerie',
  sections: 'une section',
  notifications: 'les notifications',
  licenses: 'une licence',
};

/**
 * Réduit une URL à une clé de route stable : query string retirée, préfixe /api
 * retiré, segments numériques remplacés par « :id ».
 * `/api/documents/42/files/7?x=1` → `/documents/:id/files/:id`
 */
function routeKey(originalUrl) {
  const path = originalUrl.split('?')[0].replace(/\/+$/, '') || '/';
  return path
    .replace(/^\/api/, '')
    .split('/')
    .map((segment) => (/^\d+$/.test(segment) ? ':id' : segment))
    .join('/');
}

module.exports = (req, res, next) => {
  const { method, originalUrl, ip } = req;

  // Filtrage au plus tôt : une lecture n'installe même pas d'écouteur.
  if (!WRITE_METHODS.has(method)) return next();

  // L'événement 'finish' permet de connaître le code de réponse et de lire
  // `req.user`, renseigné entre-temps par authMiddleware.
  res.on('finish', async () => {
    const user = req.user;

    // `audit_logs.tenant_id` est NOT NULL : une requête non authentifiée
    // (connexion, inscription) ne peut être rattachée à aucune organisation.
    if (!user || !user.tenant_id) return;

    const key = `${method} ${routeKey(originalUrl)}`;
    if (IGNORED.has(key)) return;

    const status = res.statusCode;
    const succeeded = status >= 200 && status < 400;

    // Le contrôleur a déjà écrit son entrée détaillée : ne rien ajouter. En
    // revanche, si l'opération a échoué, il n'a rien écrit — on trace le refus.
    if (SELF_LOGGED.has(key) && succeeded) return;

    const resource = routeKey(originalUrl).split('/')[1] || '';
    const label = LABELS[key] || `Modification sur ${RESOURCES[resource] || resource}`;

    // Un refus ou une erreur reste consigné, explicitement marqué comme tel :
    // les tentatives infructueuses sont l'intérêt même d'un journal d'audit.
    let action = label;
    if (status === 401 || status === 403) action = `Refusé : ${label}`;
    else if (status >= 400) action = `Échec : ${label}`;

    // Identifiant de demande, quand la route en désigne une : rend la ligne
    // cliquable dans l'historique.
    const idMatch = originalUrl.split('?')[0].match(/\/api\/requests\/(\d+)/);
    const requestId = idMatch ? parseInt(idMatch[1], 10) : null;

    try {
      await auditService.logAction({
        tenantId: user.tenant_id,
        userId: user.id,
        requestId,
        action,
        ipAddress: ip,
        userName: user.username || `Utilisateur ${user.id}`,
      });
    } catch (err) {
      console.error('[auditMiddleware] écriture du journal impossible :', err.message);
    }
  });

  next();
};
