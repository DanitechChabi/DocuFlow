// ============================================================================
// Pont minimal entre la fenêtre et le processus principal (Electron).
//
// contextBridge est le SEUL canal de confiance : la fenêtre tourne avec
// `sandbox: true` et `contextIsolation: true` (main.js), donc sans accès à Node.
// Tout ce qui est exposé ici devient utilisable par le code de la page — d'où une
// surface réduite au strict nécessaire, et aucune fonction générique du genre
// `invoke(canal, ...args)` qui rendrait tout l'IPC accessible d'un coup.
//
// La licence n'est PAS exposée ici : elle passe par l'API HTTP locale
// (/api/license, voir routes/desktopLicenseRoutes.js). Deux raisons — le frontend
// est le même code sur le web et en bureau, donc un appel HTTP fonctionne dans
// les deux cas sans branche particulière ; et la décision d'autorisation doit de
// toute façon se prendre côté serveur (licenseMiddleware), pas dans la fenêtre.
// ============================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  platform: process.platform,

  /**
   * Ouvre une URL dans le navigateur par défaut.
   *
   * Nécessaire pour le lien vers la page d'achat : une fenêtre Electron ne doit
   * pas devenir un navigateur, et surtout pas afficher une page de paiement
   * (l'utilisateur n'y verrait ni la barre d'adresse ni le cadenas, donc aucun
   * moyen de vérifier qu'il paie sur le bon site).
   *
   * Le filtrage du schéma a lieu côté processus principal, pas ici : ce code-ci
   * s'exécute dans la fenêtre et ne peut donc pas servir de garde-fou.
   */
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),

  /** Version de l'application, affichée à l'écran « À propos » et au support. */
  getVersion: () => ipcRenderer.invoke('desktop:version'),
  setTitle: (title) => ipcRenderer.invoke('desktop:set-title', title),
});
