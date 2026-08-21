// ============================================================================
// Clé PUBLIQUE de vérification des licences de bureau (Ed25519).
//
// Elle est versionnée et livrée dans chaque installation : c'est son rôle. Elle
// permet de VÉRIFIER une licence, jamais d'en émettre une. La clé privée
// correspondante n'existe que dans la variable d'environnement Render
// DESKTOP_LICENSE_PRIVATE_KEY et ne quitte jamais le serveur.
//
// Pourquoi Ed25519 et pas le JWT_SECRET existant : desktop/main.js pose un
// JWT_SECRET par défaut IDENTIQUE sur toutes les installations. Tout ce qui
// serait signé avec lui serait forgeable par n'importe quel client, puisqu'il
// possède le secret. Un schéma asymétrique est le seul qui tienne quand le
// vérificateur tourne sur la machine de la personne qu'il contrôle.
//
// ROTATION — si cette clé doit changer un jour, la remplacer ici invalide
// instantanément toutes les licences en circulation. La procédure correcte est
// d'accepter deux clés en parallèle (ajouter un tableau et boucler dans
// verifyLicense) le temps que les postes rafraîchissent leur artefact.
// ============================================================================

const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA/wlIsPfmQRKevzT8q0VqeIyg0XrvTiwCCjqWaAp7Iy4=
-----END PUBLIC KEY-----`;

module.exports = { LICENSE_PUBLIC_KEY };
