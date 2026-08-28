/**
 * Détection du mode d'exécution : application de bureau (Electron) ou web (SaaS).
 *
 * Le MÊME bundle est déployé sur Vercel et empaqueté dans l'installateur Windows.
 * `window.desktopApp` est exposé par desktop/preload.js via contextBridge : il
 * n'existe donc que dans Electron, et c'est le seul signal fiable côté client.
 *
 * Centralisé ici parce que la réponse gouverne des décisions de sécurité (quels
 * écrans d'administration existent) : trois copies de `window.desktopApp?.isDesktop`
 * dans trois fichiers finissent par divergerlors d'un renommage, et une garde
 * oubliée rouvre silencieusement un accès.
 *
 * CE N'EST PAS UNE BARRIÈRE DE SÉCURITÉ. Un utilisateur peut modifier le
 * JavaScript servi depuis sa propre machine. Le refus qui compte est celui du
 * serveur (vendorOnly dans backend/src/routes/superadminRoutes.js) ; ce drapeau
 * ne fait que retirer de l'écran ce qui ne fonctionnerait pas.
 */
export const estBureau = () => Boolean(window.desktopApp?.isDesktop);

/** Inverse lisible, pour les gardes « SaaS uniquement ». */
export const estWeb = () => !estBureau();
