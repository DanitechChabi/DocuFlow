// ============================================================================
// aclService — périmètres d'accès par dossier.
//
// LA QUESTION À LAQUELLE CE SERVICE RÉPOND : « cet utilisateur, quel niveau
// d'accès détient-il sur CE dossier ? » — la permission RBAC dit ce qu'on
// peut faire, l'ACL dit sur quoi.
//
// RÈGLES :
//   • HÉRITAGE : une ACL posée sur un dossier vaut pour tout son sous-arbre —
//     en niveau (un read sur « RH » se propage à « RH/Paie ») ET en restriction
//     (un sous-dossier de « RH » restreinte n'ouvre pas à qui « RH » refuse).
//   • CUMUL : l'utilisateur est atteint par trois canaux — son rôle, ses
//     groupes, son identité directe. Le niveau effectif est le PLUS FORT.
//   • DÉFAUT OUVERT : un dossier dont NI lui NI ses ancêtres ne portent d'ACL
//     suit le RBAC seul — niveau 'libre'. Restreindre est un geste exprès
//     (sinon, la moindre migration manquée verrouillerait le référentiel
//     entier : une base sans la table folder_acls est une base sans ACL).
//   • DÉFAUT FERMÉ dès la première ACL : le dossier — et son sous-arbre —
//     n'ouvre plus qu'à ses sujets, et aux manageurs situés au-dessus.
//   • ADMINISTRATEUR : les rôles porteurs du joker (superadmin) passent
//     toujours ; le rôle admin également — administrer l'organisation
//     inclut son référentiel documentaire.
//   • ÉCHEC FERMÉ : base injoignable → refus (l'inverse ouvrirait en
//     silence). Seule exception : la table folder_acls elle-même absente
//     (base antérieure à la migration 022) — le service devient inerte et
//     tout est 'libre', exactement comme avant qu'il n'existe.
// ============================================================================
const db = require('../config/db');
const { ROLES_SYSTEME } = require('../config/permissions');

const NIVEAUX = { read: 1, write: 2, manage: 3 };

const RÔLES_TOUT_PUISSANTS = new Set(['superadmin', 'admin']);

// Cache : (tenantId, userId) → { dossiers: Map(folderId → info), ... }
// La résolution parcourt l'arborescence : une lecture par utilisateur et par
// fenêtre de 60 s — les listes la consultent dossier par dossier.
const TTL_MS = 60_000;
const cache = new Map(); // clé composite → contexte (voir chargerContexte)

function invalidate() {
  cache.clear();
}

// ---------------------------------------------------------------------------
// RÉSOLUTION PURE — aucun accès base. Extraite de chargerContexte pour être
// éprouvée par les tests (acl.test.js) : l'arbitrage de l'héritage est le
// cœur du jalon, il mérite mieux qu'un éprouvage par courbes HTTP.
//
// Entrée :
//   dossiers : [{ id, parent_id }]   — l'arborescence du tenant
//   acls     : [{ folder_id, subject_type, subject_id, level }]
//   sujet    : { role, groupes: [id], userId } — l'utilisateur à arbitrer
// Sortie : Map(folderId → { level, restricted })
//   level      : niveau HÉRITÉ cumulé (0 si aucun canal ne l'atteint)
//   restricted : le dossier OU un ancêtre porte au moins une ACL
// ---------------------------------------------------------------------------
function resoudrePerimetres(dossiers, acls, sujet) {
  // Index des dossiers par parent.
  const enfants = new Map();
  for (const d of dossiers) {
    const p = d.parent_id == null ? null : String(d.parent_id);
    if (!enfants.has(p)) enfants.set(p, []);
    enfants.get(p).push(d.id);
  }

  // L'ACL concerne-t-elle CET utilisateur ? (rôle, groupe, ou lui-même)
  const concerne = (acl) => {
    if (acl.subject_type === 'role') return String(acl.subject_id) === String(sujet.role);
    if (acl.subject_type === 'group') return sujet.groupes.map(String).includes(String(acl.subject_id));
    if (acl.subject_type === 'user') return String(acl.subject_id) === String(sujet.userId);
    return false;
  };

  // Pour chaque dossier : les ACL directes, et si le dossier porte restriction.
  const aclsParDossier = new Map();
  const porteurs = new Set(); // dossiers portant une ACL eux-mêmes
  for (const acl of acls) {
    if (!aclsParDossier.has(acl.folder_id)) aclsParDossier.set(acl.folder_id, []);
    aclsParDossier.get(acl.folder_id).push(acl);
    porteurs.add(acl.folder_id);
  }

  // Résolution par descente : niveau(userId, dossier) =
  //   max(ACLs utilisateur sur le dossier, niveau hérité du parent)
// et restricted(dossier) = porte une ACL OU hérite d'un ancêtre qui en porte.
  const resultat = new Map();
  const visiter = (dossierId, herite) => {
    const aclsDirectes = aclsParDossier.get(dossierId) || [];
    let niveau = herite.level;
    for (const acl of aclsDirectes) {
      if (concerne(acl)) {
        const v = NIVEAUX[acl.level] || 0;
        if (v > niveau) niveau = v;
      }
    }
    const restricted = porteurs.has(dossierId) || herite.restricted;
    resultat.set(dossierId, { level: niveau, restricted });
    for (const enfant of enfants.get(String(dossierId)) || []) {
      visiter(enfant, { level: niveau, restricted });
    }
  };
  for (const racine of enfants.get(null) || []) {
    visiter(racine, { level: 0, restricted: false });
  }
  // Dossiers hors arbre atteignable (parent disparu, données héritées) : la
  // descente ne les visite jamais. L'interface les rattache visuellement à la
  // racine (voir rattacherOrphelins) — ils suivent donc le RBAC seul, sinon
  // ils disparaîtraient de l'arbre de tout le monde dès la première ACL posée
  // ailleurs dans l'arborescence.
  for (const d of dossiers) {
    if (!resultat.has(d.id)) resultat.set(d.id, { level: 0, restricted: false });
  }
  return resultat;
}

/**
 * Charge les ACL du tenant et le profil utilisateur, puis résout dossier par
 * dossier. Les ACL, l'arborescence, les groupes et le rôle : quatre lectures,
 * une par fenêtre de cache.
 */
async function chargerContexte(tenantId, userId) {
  const cle = `${tenantId}|${userId}`;
  const hit = cache.get(cle);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  const roleRes = await db.query('SELECT role FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
  const role = roleRes.rows[0]?.role || null;
  if (!role) {
    // Compte introuvable : contexte vide, tout sera refusé (échec fermé).
    const vide = { at: Date.now(), role: null, groupes: [], dossiers: new Map(), sansTable: false };
    cache.set(cle, vide);
    return vide;
  }

  const groupesRes = await db.query(
    `SELECT g.id FROM groups g
       JOIN user_group_memberships ugm ON ugm.group_id = g.id
      WHERE ugm.user_id = $1 AND g.tenant_id = $2`,
    [userId, tenantId]
  );
  const groupes = groupesRes.rows.map((r) => String(r.id));

  // Tous les dossiers du tenant, et toutes les ACL — la résolution du
  // sous-arbre se fait en mémoire : les arborescences sont petites (des
  // centaines de dossiers), et une CTE par requête serait réexécutée à chaque
  // consultation de liste.
  const dossiersRes = await db.query(
    'SELECT id, parent_id FROM document_folders WHERE tenant_id = $1',
    [tenantId]
  );

  // Base antérieure à la migration 022 : la table n'existe pas. Le service
  // devient inerte — tout est 'libre' — plutôt que de verrouiller le
  // référentiel d'une organisation qui n'a jamais demandé de périmètres.
  let acls = [];
  let sansTable = false;
  try {
    const aclsRes = await db.query(
      'SELECT folder_id, subject_type, subject_id, level FROM folder_acls WHERE tenant_id = $1',
      [tenantId]
    );
    acls = aclsRes.rows;
  } catch (err) {
    if (err.code !== '42P01') throw err;
    sansTable = true;
  }

  const contexte = {
    at: Date.now(),
    role,
    groupes,
    sansTable,
    dossiers: resoudrePerimetres(dossiersRes.rows, acls, { role, groupes, userId }),
  };
  cache.set(cle, contexte);
  return contexte;
}

/**
 * Traduit le verdict du résolveur ({ level, restricted }) en niveau effectif —
 * pure, donc éprouvée directement par les tests (c'est ici que vivent le
 * défaut ouvert et le défaut fermé).
 */
function niveauDepuis(info) {
  if (!info) return 'none';             // dossier inconnu du tenant
  if (!info.restricted) return 'libre'; // défaut ouvert : le RBAC seul décide
  if (info.level >= NIVEAUX.manage) return 'manage';
  if (info.level >= NIVEAUX.write) return 'write';
  if (info.level >= NIVEAUX.read) return 'read';
  return 'none';
}

/**
 * Niveau d'accès effectif d'un utilisateur sur un dossier.
 * @returns {Promise<'libre'|'none'|'read'|'write'|'manage'>}
 *   'libre' : ni ce dossier ni un ancêtre ne porte d'ACL — le RBAC seul
 *             décide (c'est le niveau de TOUT dossier tant qu'aucune ACL
 *             n'existe, et de tout document non classé).
 *   'none'  : sous-arbre restreint et l'utilisateur n'y est sujet d'aucune
 *             ACL — invisible, inexistant.
 */
async function niveauSur(tenantId, userId, dossierId) {
  try {
    const ctx = await chargerContexte(tenantId, userId);
    if (RÔLES_TOUT_PUISSANTS.has(ctx.role)) return 'manage';
    if (dossierId == null) return 'libre'; // hors dossier : périmètre GED (RBAC)
    return niveauDepuis(ctx.dossiers.get(Number(dossierId)));
  } catch (err) {
    console.error('[acl] Résolution impossible — accès refusé :', err.message);
    return 'none'; // échec fermé
  }
}

/** Lecture : tout niveau d'accès vaut, seul 'none' refuse. */
async function peutLire(tenantId, userId, dossierId) {
  return (await niveauSur(tenantId, userId, dossierId)) !== 'none';
}

/**
 * Écriture : 'libre' passe (le RBAC — déjà vérifié par la route — suffit sur
 * un dossier ouvert) ; dans un sous-arbre restreint, il faut 'write' ou plus.
 */
async function peutEcrire(tenantId, userId, dossierId) {
  const n = await niveauSur(tenantId, userId, dossierId);
  return n === 'libre' || n === 'write' || n === 'manage';
}

/**
 * L'ensemble des dossiers que l'utilisateur PEUT voir — pour borner les
 * listes. Un dossier restreint invisible n'apparaît ni dans l'arborescence
 * ni dans les filtres : la restriction protège, elle n'annonce pas.
 * @returns {Promise<{visibles: Set<number>, lisibles: Set<number>, restreints: Set<number>}>}
 *         visibles : consultables (arbre, filtres) ;
 *         lisibles : leurs documents sont lisibles ;
 *         restreints : sous-arbre tenant d'au moins une ACL (l'indicateur
 *         de l'interface — il couvre l'héritage : le sous-dossier d'un
 *         dossier restreint l'est aussi).
 */
async function dossiersAccessibles(tenantId, userId) {
  try {
    const ctx = await chargerContexte(tenantId, userId);
    const visibles = new Set();
    const lisibles = new Set();
    const restreints = new Set();
    // Les rôles tout-puissants doivent suivre niveauSur ('manage' partout) :
    // sans ce pont, l'administrateur qui pose LA première ACL perd le dossier
    // de vue au rechargement de l'arbre — au moment précis où il faut pouvoir
    // rouvrir la porte qu'il vient de fermer. Ils voient le cadenas comme les
    // autres (restreints), ils ne sont juste jamais enfermés dehors.
    const toutPuissant = RÔLES_TOUT_PUISSANTS.has(ctx.role);
    for (const [id, info] of ctx.dossiers) {
      if (!info.restricted) { visibles.add(id); lisibles.add(id); continue; }
      restreints.add(id);
      if (toutPuissant || info.level >= NIVEAUX.read) { visibles.add(id); lisibles.add(id); }
    }
    return { visibles, lisibles, restreints };
  } catch (err) {
    console.error('[acl] Énumération impossible — ensemble vide :', err.message);
    return { visibles: new Set(), lisibles: new Set(), restreints: new Set() }; // échec fermé
  }
}

/**
 * L'utilisateur peut-il administrer les ACL d'un dossier ? Il faut 'manage'
 * sur le dossier — directement ou par héritage (un manageur de « RH »
 * administre les ACL des sous-dossiers de RH) — ou un dossier encore libre,
 * où la permission RBAC folders.manage_permissions (déjà passée par la
 * route) suffit.
 */
async function peutGerer(tenantId, userId, dossierId) {
  const n = await niveauSur(tenantId, userId, dossierId);
  return n === 'libre' || n === 'manage';
}

// ---------------------------------------------------------------------------
// Administration des ACL (CRUD) — appelé par le contrôleur, gardé par la
// permission folders.manage_permissions.
// ---------------------------------------------------------------------------
async function listAcls(tenantId, folderId) {
  const { rows } = await db.query(
    `SELECT a.*,
            CASE a.subject_type
              WHEN 'user'  THEN (SELECT full_name FROM users u WHERE u.id = a.subject_id::int AND u.tenant_id = a.tenant_id)
              WHEN 'group' THEN (SELECT name FROM groups g WHERE g.id = a.subject_id::int AND g.tenant_id = a.tenant_id)
              WHEN 'role'  THEN (SELECT r.name FROM roles r WHERE r.key = a.subject_id AND r.tenant_id = a.tenant_id)
            END AS subject_name
       FROM folder_acls a
      WHERE a.tenant_id = $1 AND a.folder_id = $2
      ORDER BY a.subject_type, a.subject_id`,
    [tenantId, folderId]
  );
  // Les rôles SYSTÈME ne vivent pas dans la table roles : leur nom vient du
  // catalogue. Sans ce repli, une ACL posée sur « agent » s'afficherait « — ».
  for (const row of rows) {
    if (row.subject_type === 'role' && !row.subject_name) {
      row.subject_name = ROLES_SYSTEME.find((r) => r.key === row.subject_id)?.name || row.subject_id;
    }
  }
  return rows;
}

/**
 * Pose une ACL — en remplaçant le niveau du sujet s'il en avait déjà un.
 * Poser la PREMIÈRE ACL d'un dossier le RESTREINT (lui et son sous-arbre) :
 * l'appelant doit le savoir (le contrôleur le dit à l'interface).
 */
async function setAcl(tenantId, folderId, { subject_type, subject_id, level }, userId) {
  if (!['role', 'group', 'user'].includes(subject_type)) {
    throw Object.assign(new Error('Type de sujet invalide.'), { status: 400 });
  }
  if (!['read', 'write', 'manage'].includes(level)) {
    throw Object.assign(new Error('Niveau invalide (read, write, manage).'), { status: 400 });
  }
  await db.query(
    `INSERT INTO folder_acls (tenant_id, folder_id, subject_type, subject_id, level, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (folder_id, subject_type, subject_id)
     DO UPDATE SET level = EXCLUDED.level`,
    [tenantId, folderId, subject_type, String(subject_id), level, userId]
  );
  invalidate();
}

async function removeAcl(tenantId, folderId, subject_type, subject_id) {
  const { rowCount } = await db.query(
    'DELETE FROM folder_acls WHERE tenant_id = $1 AND folder_id = $2 AND subject_type = $3 AND subject_id = $4',
    [tenantId, folderId, subject_type, String(subject_id)]
  );
  invalidate();
  return rowCount > 0;
}

/** Le dossier est-il restreint (au moins une ACL à LUI) ? — pour l'interface. */
async function dossierRestreint(tenantId, folderId) {
  const { rows } = await db.query(
    'SELECT 1 FROM folder_acls WHERE tenant_id = $1 AND folder_id = $2 LIMIT 1',
    [tenantId, folderId]
  );
  return rows.length > 0;
}

module.exports = {
  NIVEAUX,
  invalidate,
  resoudrePerimetres,
  niveauDepuis,
  niveauSur,
  peutLire,
  peutEcrire,
  dossiersAccessibles,
  peutGerer,
  listAcls,
  setAcl,
  removeAcl,
  dossierRestreint,
};
