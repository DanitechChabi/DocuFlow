# DocuFlow — Application de bureau (Windows)

L'app de bureau embarque le backend Express + l'interface React compilée dans une
fenêtre Electron. Elle fonctionne sur **PostgreSQL local** : au premier lancement,
elle crée automatiquement la base `docuflow`, applique le schéma et les migrations,
puis crée le compte superadmin par défaut.

## Prérequis

- Windows 10/11.
- **PostgreSQL** installé et démarré sur le port `5432` (compte `postgres`).
- Node.js ≥ 20 et npm (uniquement pour **construire** l'app, pas pour l'utiliser).

## Configuration de la base (défauts, surchargeables)

| Variable        | Défaut      | Description                          |
|-----------------|-------------|--------------------------------------|
| `DB_HOST`       | `localhost` | Hôte PostgreSQL                      |
| `DB_PORT`       | `5432`      | Port PostgreSQL                      |
| `DB_USER`       | `postgres`  | Utilisateur                          |
| `DB_PASSWORD`   | *(vide)*    | Mot de passe                         |
| `DB_NAME`       | `docuflow`  | Nom de la base (créée si absente)    |
| `ADMIN_USERNAME`| `admin`     | Superadmin par défaut                |
| `ADMIN_PASSWORD`| `Admin123!` | Mot de passe du superadmin par défaut|

> Ces variables peuvent être posées dans l'environnement avant de lancer l'app,
> ou dans un fichier `.env` placé à côté de l'exécutable (chargé en premier).

## Construction

```bat
cd desktop
npm install          REM télécharge Electron (~100 Mo, une fois)
scripts\build-desktop.bat
```

Sorties dans `desktop\release\` :

- `DocuFlow-Setup-<version>.exe` — installateur (NSIS).
- `DocuFlow-Portable-<version>.exe` — version portable (sans installation).

## Développement

```bat
cd desktop
npm run build:frontend   REM build frontend mode desktop (VITE_API_URL=/api)
npm start                REM lance Electron (fenêtre + backend local)
```

## Notes

- **Google OAuth est désactivé** dans la version bureau (connexion par identifiant /
  mot de passe uniquement).
- Les **e-mails** ne sont pas envoyés sans clé Resend (`RESEND_API_KEY`) : les
  notifications restent internes à l'application.
- Les **fichiers uploadés** (logo, pièces jointes) sont stockés dans
  `%APPDATA%\DocuFlow\uploads` (toujours accessible en écriture).
- L'exécutable **n'est pas signé** : SmartScreen peut afficher un avertissement
  (« Plus d'informations » → « Exécuter quand même »).
- L'app écoute uniquement sur `127.0.0.1` (port libre choisi par le système) —
  elle n'est pas exposée sur le réseau local.
