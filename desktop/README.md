# DocuFlow — Application de bureau (Windows)

L'application embarque le backend Express, l'interface React compilée **et son
propre serveur PostgreSQL** dans une fenêtre Electron. Les documents de la GED
restent sur le disque du poste : rien ne part vers un stockage en ligne.

Au premier lancement, elle démarre sa base locale, crée le schéma, applique les
migrations puis crée le compte superadministrateur — sans aucune intervention.

## Prérequis

- Windows 10/11.
- **Pour l'utiliser : rien d'autre.** PostgreSQL est fourni avec l'application.
- Pour la **compiler** : Node.js ≥ 20 et npm.

## Base de données : trois cas, dans cet ordre

`main.js` tranche à chaque démarrage :

1. **`DB_HOST` défini** → cette base est utilisée telle quelle. Un poste déjà
   configuré, ou une base sur un serveur de l'entreprise, garde la main.
2. **Sinon, binaires embarqués présents** → DocuFlow démarre sa propre instance
   dans `%APPDATA%\DocuFlow\pgdata`, sur un port qu'il choisit lui-même.
3. **Sinon** → repli sur un PostgreSQL installé sur la machine
   (`localhost:5432`). C'est le comportement des installations antérieures : une
   mise à jour ne doit pas leur retirer leurs données.

| Variable         | Défaut      | Description                             |
|------------------|-------------|-----------------------------------------|
| `DB_HOST`        | *(auto)*    | Défini ⇒ désactive la base embarquée    |
| `DB_PORT`        | `5432`      | Port (cas 3 uniquement)                 |
| `DB_USER`        | `postgres`  | Utilisateur                             |
| `DB_PASSWORD`    | *(vide)*    | Mot de passe                            |
| `DB_NAME`        | `docuflow`  | Nom de la base (créée si absente)       |
| `ADMIN_USERNAME` | `admin`     | Superadministrateur par défaut          |
| `ADMIN_PASSWORD` | `Admin123!` | Son mot de passe — **à changer**        |

> Posées dans l'environnement avant le lancement, ou dans un `.env` placé à côté
> de l'exécutable (chargé en premier).

## Construction

```bat
cd desktop
npm install                    REM Electron + electron-builder (~100 Mo, une fois)
scripts\build-desktop.bat
```

Le script enchaîne les quatre étapes dans l'ordre imposé par leurs dépendances :

| Étape | Action | Pourquoi cet ordre |
|-------|--------|--------------------|
| 0 | `fetch-postgres.js` | `vendor\pgsql` est déclaré en `extraResources` : electron-builder échoue si le dossier est absent. ~330 Mo au premier passage, idempotent ensuite. |
| 1 | `make-brand.js` | Vite recopie `public\` **pendant** le build : des déclinaisons régénérées après coup n'atteindraient `dist\` qu'au build suivant. |
| 2 | Build frontend `--mode desktop` | Fixe `VITE_API_URL=/api`. Un build d'un autre mode grave l'URL de Render dans le bundle. |
| 3 | `electron-builder --win` | Produit l'installateur. |

Sortie : `desktop\release\DocuFlow-Setup-1.0.0.exe` (NSIS, cible unique).

Pour reconstruire sans repasser par les binaires ni la marque :

```bat
npm run dist        REM rebuild du frontend en mode desktop + electron-builder
npm run dist:only   REM electron-builder seul — n'utiliser qu'après un dist réussi
```

> `npm run dist` **reconstruit** le frontend. C'est délibéré : la commande la plus
> naturelle empaquetait auparavant le `dist\` qui traînait, souvent celui d'un
> déploiement Vercel. L'application s'installait, s'ouvrait, et interrogeait
> Render — donc aucune donnée locale, sans le moindre message d'erreur.
> `dist:only` saute cette reconstruction : à réserver aux itérations sur le
> packaging lui-même.

Deux garde-fous couvrent le même défaut, à la compilation et à l'exécution :
`main.js` inspecte le bundle au démarrage (`detecterBuildDistant`) et **refuse de
démarrer** s'il y trouve une adresse d'API distante. `.tmp-dryrun\test-packaging.mjs`
vérifie les deux.

## Développement

```bat
cd desktop
npm run build:frontend   REM frontend en mode desktop (VITE_API_URL=/api)
npm start                REM Electron : fenêtre + backend + base locale
```

## Notes

- Le code est empaqueté dans une **archive asar**. Le backend n'a aucune
  dépendance à compilation native, ce qui rend l'archive sans risque ici ; si
  une telle dépendance apparaissait, il faudrait l'extraire via `asarUnpack`.
  L'archive gêne la lecture du code, elle ne le protège pas.
- **Google OAuth est désactivé** en version bureau (identifiant / mot de passe).
- Les **e-mails** ne partent pas sans clé Resend (`RESEND_API_KEY`) : les
  notifications restent internes.
- Les **fichiers** (logo, documents, pièces jointes) vont dans
  `%APPDATA%\DocuFlow\uploads`, toujours accessible en écriture — contrairement
  au dossier d'installation.
- Leurs **URL sont relatives** en mode bureau. Le port étant réattribué à chaque
  lancement, une URL absolue pointerait le lendemain sur un port fermé et les
  documents paraîtraient perdus. La règle et son pourquoi :
  `backend\src\helpers\publicUrl.js`.
- L'application écoute **uniquement sur `127.0.0.1`**, sur un port libre choisi
  par le système. Ce n'est pas un détail : `/uploads` est servi sans
  authentification, donc une écoute sur `0.0.0.0` publierait la GED sur le
  réseau local.
- L'exécutable **n'est pas signé** (certificat à acheter) : SmartScreen avertit
  au premier lancement — « Informations complémentaires » → « Exécuter quand même ».
- La **licence** n'empêche pas l'ouverture de l'application : l'écran de saisie
  a besoin d'une vraie interface, et le client doit pouvoir lire son empreinte
  machine. La garde qui compte est côté serveur (402 sur `/api`).

## Journaux en cas de problème

| Fichier | Contenu |
|---------|---------|
| `%APPDATA%\DocuFlow\postgres.log` | Démarrage et erreurs de la base embarquée |
| `%APPDATA%\DocuFlow\pgdata\` | Les données. **À sauvegarder.** |
| `%APPDATA%\DocuFlow\uploads\` | Les documents. **À sauvegarder.** |
