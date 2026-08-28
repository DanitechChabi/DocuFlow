// ============================================================================
// licenseMiddleware — refuse de servir l'API si l'installation n'est pas sous
// licence valide. ACTIF UNIQUEMENT EN MODE BUREAU.
//
// POURQUOI CETTE GARDE CÔTÉ SERVEUR ALORS QUE L'INTERFACE VÉRIFIE DÉJÀ
// Le frontend affiche l'écran de licence, mais il suffirait d'appeler l'API
// directement (curl sur 127.0.0.1) pour contourner un simple écran. La barrière
// utile est ici, à l'entrée des données.
//
// POURQUOI « UNIQUEMENT EN MODE BUREAU » (garde-fou capital)
// Ce même code tourne sur Render pour le SaaS. Sans la condition
// SERVE_FRONTEND === 'true', ce middleware bloquerait l'application en ligne de
// tous les clients existants dès le déploiement — aucun serveur Render n'a de
// license.dat. La condition est donc une protection contre une panne totale de
// production, pas une commodité.
//
// CODE 402 PAYMENT REQUIRED
// Délibérément distinct des 401 (authMiddleware : jeton absent) et 403
// (rôle insuffisant). Sans code propre, l'intercepteur du frontend traiterait un
// problème de licence comme une session expirée et déconnecterait l'utilisateur
// en boucle, sans jamais afficher la vraie raison.
//
// CORRIGE AU PASSAGE LA FAILLE « ENTREPRISE SUSPENDUE »
// authController ne vérifie tenants.status que si un tenant_slug est fourni, et
// la route /login sans slug existe. Un utilisateur d'entreprise suspendue se
// connecte donc normalement, et aucun contrôle par requête n'existe ensuite.
// Comme ce middleware lit déjà l'état à chaque requête en mode bureau, la
// vérification est faite ici dans la même lecture.
// ============================================================================
const licenseGuard = require('../desktop/licenseGuard');
const jwt = require('jsonwebtoken');

// Le mode bureau est le seul où ce contrôle a un sens. Lu à chaque requête et
// non mis en cache au chargement : desktop/main.js pose la variable avant de
// charger app.js, mais un test peut légitimement la changer entre deux appels.
const isDesktopMode = () => process.env.SERVE_FRONTEND === 'true';

/**
 * tenant_id du porteur du jeton, sans bloquer si le jeton manque ou est invalide.
 *
 * Ce middleware étant monté globalement, il passe AVANT les authMiddleware posés
 * route par route : `req.user` n'existe pas encore. Décoder ici est donc la seule
 * façon de connaître l'entreprise. Un jeton invalide n'est pas traité comme une
 * erreur — c'est authMiddleware qui rendra le 401, avec son propre message.
 */
function tenantFromToken(req) {
  const header = req.headers.authorization;
  const token = header && header.split(' ')[1];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.tenant_id || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Statut d'entreprise — mis en cache brièvement
//
// Sans cache, ce contrôle ajouterait une requête SQL à CHAQUE appel d'API : un
// écran de tableau de bord en déclenche une dizaine, donc dix allers-retours en
// base pour une valeur qui ne change qu'au moment où le vendeur suspend un
// client. 30 secondes suffisent à absorber les rafales tout en rendant une
// suspension effective assez vite pour être crédible.
// ---------------------------------------------------------------------------
const STATUS_TTL_MS = 30_000;
const statusCache = new Map(); // tenant_id → { status, at }

async function tenantStatus(tenantId) {
  const hit = statusCache.get(tenantId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.status;

  const db = require('../config/db');
  const { rows } = await db.query('SELECT status FROM tenants WHERE id = $1', [tenantId]);
  const status = rows[0]?.status || null;
  statusCache.set(tenantId, { status, at: Date.now() });
  return status;
}

// Chemins joignables SANS licence — sinon l'écran d'activation lui-même ne
// pourrait pas fonctionner. Liste tenue au plus court : chaque entrée est une
// porte laissée ouverte, et vérifiée route par route dans le code existant.
//
//   /api/license/*   — l'écran de licence (état, activation). Route montée par
//                      app.js en mode bureau uniquement.
//   /api/auth/login  — l'utilisateur doit pouvoir se connecter pour voir l'écran
//                      de licence à son nom. Se connecter ne donne accès à
//                      AUCUNE donnée métier : toutes les autres routes restent
//                      fermées tant que la licence manque.
//   /api/auth/company/:slug — lecture publique de la marque d'une entreprise,
//                      utilisée par la page de connexion (authRoutes.js:10).
//   /api/settings    — branding de la page de connexion. optionalAuthMiddleware
//                      (settingsRoutes.js:39) : sans jeton, ne renvoie que le
//                      nom, le logo et les couleurs. VÉRIFIÉ : il n'existe pas de
//                      route /api/settings/public — laisser cette entrée en
//                      préfixe large aurait ouvert /api/settings/configuration,
//                      donc `settingsExact` ci-dessous ne tolère que la racine.
const OPEN_PREFIXES = [
  '/api/license',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/company',
];

// Ouvert en lecture SEULE et sur le chemin EXACT : /api/settings renvoie le
// branding, mais /api/settings/configuration expose la console de configuration
// et PUT /api/settings modifie les réglages.
const isSettingsRead = (req) => req.method === 'GET' && req.path === '/api/settings';

const isOpen = (req) => isSettingsRead(req)
  || OPEN_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`));

module.exports = async function licenseMiddleware(req, res, next) {
  if (!isDesktopMode()) return next();

  // Seules les routes /api sont gardées : le frontend compilé (HTML, JS, CSS) et
  // les fichiers d'upload doivent rester servis, sans quoi l'écran de licence
  // n'aurait aucun moyen de s'afficher.
  if (!req.path.startsWith('/api')) return next();
  if (isOpen(req)) return next();

  try {
    // RÉ-ÉVALUATION À CHAQUE REQUÊTE, SANS RÉSEAU — correctif de la licence
    // « figée ». L'ancien code servait l'état calculé au démarrage pendant
    // toute la session : une expiration ou une révocation survenant pendant
    // que l'application restait ouverte (mise en veille, sessions de plusieurs
    // jours — usage courant d'une application de bureau) ne prenait effet
    // qu'au redémarrage. revalidate() relit le cache disque et réévalue
    // l'artefact signé : échéance et révocation contenues dans le jeton sont
    // réappliquées immédiatement, pour le coût d'une lecture fichier. Le
    // rafraîchissement réseau reste le rôle de check() (démarrage, écran de
    // licence) — ce n'est pas celui d'une requête d'API.
    let state = licenseGuard.revalidate();
    if (!state) state = await licenseGuard.check();

    if (!licenseGuard.isAllowed(state)) {
      return res.status(402).json({
        message: state.message || 'Licence DocuFlow requise.',
        code: 'LICENSE_REQUIRED',
        license_state: state.state,
        valid_until: state.valid_until || null,
        machine_id: state.machine_id || null,
      });
    }

    // Entreprise suspendue par le vendeur : contrôlé ici parce que c'est le seul
    // endroit traversé par toutes les requêtes authentifiées en mode bureau.
    //
    // ATTENTION À L'ORDRE : ce middleware est monté globalement dans app.js,
    // donc AVANT les authMiddleware posés route par route. `req.user` n'est donc
    // PAS encore renseigné ici — s'y fier ferait taire ce contrôle en silence,
    // sans qu'aucun test ne le remarque. Le jeton est donc décodé sur place.
    const tenantId = tenantFromToken(req);
    if (tenantId) {
      try {
        const status = await tenantStatus(tenantId);
        if (status === 'suspended') {
          return res.status(403).json({
            message: 'Cette entreprise est suspendue. Contactez le support DocuFlow.',
            code: 'TENANT_SUSPENDED',
          });
        }
      } catch (err) {
        // Échec de lecture non bloquant : une base indisponible produira de toute
        // façon une erreur explicite dans le contrôleur appelé, avec un message
        // plus utile que celui qu'on inventerait ici.
        console.warn('[license] Contrôle du statut de l\'entreprise différé :', err.message);
      }
    }

    return next();
  } catch (err) {
    // FAIL-OPEN, et c'est un choix assumé : une exception ici est un défaut de
    // NOTRE code (module absent, cache illisible), pas une fraude. Bloquer un
    // client qui a payé à cause de notre propre bogue serait le pire des deux
    // résultats. La trace permet de le voir en support.
    console.error('[license] Contrôle de licence en échec — accès laissé ouvert :', err.message);
    return next();
  }
};
