// ============================================================================
// Construction des URL d'accès aux fichiers servis par ce serveur.
//
// DEUX MODES DE DÉPLOIEMENT, DEUX RÉPONSES — ET LE RACCOURCI EST FAUX DES DEUX
// CÔTÉS. C'est pourquoi la règle vit ici, à un seul endroit : dupliquée dans
// chaque contrôleur, elle finirait par diverger, et le symptôme (une image
// absente) ne désigne jamais sa cause.
//
// • SaaS (backend sur Render, frontend sur Vercel) : origines DIFFÉRENTES. Un
//   chemin relatif « /uploads/logo.png » serait résolu par le navigateur contre
//   Vercel, qui ne sert pas ce dossier — le logo disparaît. L'URL doit être
//   absolue, bâtie sur l'hôte de la requête.
//
// • Bureau (Electron) : le backend sert lui-même le frontend, en même-origine,
//   sur un port que l'OS attribue à CHAQUE lancement (PORT=0 dans
//   desktop/main.js). Une URL absolue fige le port du jour ; au démarrage suivant
//   elle pointe sur un port fermé et le fichier paraît perdu — alors qu'il est
//   toujours sur le disque du client. Seul le chemin relatif est durable.
//
// SERVE_FRONTEND distingue les deux : c'est exactement la variable qui signifie
// « je sers moi-même le frontend », donc « nous sommes en même-origine ».
// ============================================================================

/**
 * Préfixe d'origine à placer devant un chemin absolu (« /uploads/… »).
 * @param {object} req - requête Express
 * @returns {string} '' en mode bureau, « https://hôte » en mode hébergé.
 */
function originPrefix(req) {
  if (process.env.SERVE_FRONTEND === 'true') return '';
  const host = req?.headers?.host || '127.0.0.1:30001';
  const protocol = req?.protocol || 'http';
  return `${protocol}://${host}`;
}

/**
 * URL d'un fichier du dossier d'uploads.
 *
 * Une valeur déjà absolue (Cloudinary, par exemple) est rendue telle quelle :
 * la préfixer produirait « https://monsite/https://res.cloudinary… ».
 *
 * @param {object} req      - requête Express
 * @param {string} fichier  - nom stocké, éventuellement dans un sous-dossier
 * @param {string} [dossier] - sous-chemin sous /uploads (ex. 'files')
 * @returns {string|null} null si aucun fichier n'est renseigné.
 */
function uploadUrl(req, fichier, dossier = '') {
  if (!fichier) return null;
  const valeur = String(fichier);
  if (valeur.startsWith('http://') || valeur.startsWith('https://')) return valeur;
  const chemin = dossier ? `/uploads/${dossier}/${valeur}` : `/uploads/${valeur}`;
  return `${originPrefix(req)}${chemin}`;
}

module.exports = { originPrefix, uploadUrl };
