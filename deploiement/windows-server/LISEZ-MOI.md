# DocuFlow AFGC — installation sur le serveur interne (Windows Server)

Guide destiné à la DSI de l'AFGC. L'application des archives (demandes de
dossiers, entrée des dossiers, armoires, sorties) tourne sur **un serveur
Windows du réseau interne** : les données restent dans l'entreprise et les
agents y accèdent depuis leur navigateur, à une adresse interne comme
`https://archives.afgcsa.com`.

```
 Postes des agents (Edge, Chrome)          Windows Server (réseau interne)
 ───────────────────────────────           ─────────────────────────────────────
 https://archives.afgcsa.com   ──HTTPS──▶   Node.js : DocuFlow (interface + API)
                                            PostgreSQL : base « docuflow »
                                            C:\DocuFlow\donnees : fichiers déposés
                                            Sauvegarde chaque nuit ─▶ dossier copié hors du serveur
```

Un seul programme répond à tout (l'interface et l'API, à la même adresse). Il
tourne sous le compte SYSTEM, démarre avec Windows et redémarre seul s'il
s'arrête. Rien n'est exposé sur Internet : le pare-feu n'est ouvert que sur
les profils **Domaine** et **Privé**.

---

## 1. Ce qu'il faut avant de commencer

| Élément | Détail |
|---|---|
| Serveur | Windows Server 2016 ou plus récent (2019 / 2022 conseillés), joint au domaine. 4 processeurs, 8 Go de mémoire, 100 Go de disque, plus la place des documents numérisés. |
| Node.js | **22 LTS**, installateur Windows « .msi » sur <https://nodejs.org> (options par défaut). |
| PostgreSQL | **17**, installateur Windows (EDB) sur <https://www.postgresql.org/download/windows/>. Notez le mot de passe du compte `postgres` choisi pendant l'installation ; laissez le port 5432. Inutile d'ouvrir PostgreSQL au réseau : seul le serveur lui-même s'y connecte. |
| Certificat | Un certificat **.pfx** (avec sa clé privée) au nom du site, par exemple `archives.afgcsa.com`, délivré par l'autorité de certification interne (AD CS) — les postes du domaine lui font déjà confiance. Le nom doit figurer dans le champ « Autre nom de l'objet » (SAN). |
| DNS | Un enregistrement A `archives.afgcsa.com` → adresse IP du serveur, dans le DNS interne. |
| Paquet | `DocuFlow-AFGC-Serveur-<version>.zip`, à décompresser sur le serveur (par exemple dans `C:\Installation\`). |

L'accès Internet du serveur n'est nécessaire que pour le transfert des
données de la version en ligne (section 3) et pour l'envoi de courriels.

---

## 2. Installation

1. Décompressez le paquet, puis ouvrez **PowerShell en tant qu'administrateur**.
2. Allez dans son dossier `scripts` et autorisez les scripts pour cette fenêtre :

   ```powershell
   cd C:\Installation\DocuFlow-AFGC-Serveur\scripts
   Set-ExecutionPolicy -Scope Process Bypass
   Get-ChildItem . | Unblock-File
   ```

3. Lancez l'installation :

   ```powershell
   .\installer.ps1 -NomServeur archives.afgcsa.com -Certificat C:\Installation\archives.pfx
   ```

   Le script demande :
   - le mot de passe du compte `postgres` (pour créer la base « docuflow » et son compte, dont le mot de passe est tiré au hasard) ;
   - le mot de passe du certificat .pfx ;
   - l'identifiant, le nom, l'adresse et le mot de passe du **premier administrateur** de l'application.

   Options utiles :

   | Option | Rôle |
   |---|---|
   | `-DossierSauvegardes D:\Sauvegardes\DocuFlow` | Où écrire les sauvegardes (par défaut `C:\DocuFlow\sauvegardes`). Choisissez un disque ou un partage inclus dans votre sauvegarde habituelle. |
   | `-HeureSauvegarde 01:30` | Heure de la sauvegarde de nuit (02:00 par défaut). |
   | `-Dossier E:\DocuFlow` | Dossier d'installation (`C:\DocuFlow` par défaut). |
   | `-SansEspace` | Ne pas créer l'espace AFGC : à utiliser quand on reprend les données de la version en ligne (section 3). |
   | `-Port 8443` | Autre port que 443. |

4. À la fin, le script affiche l'adresse. Ouvrez-la depuis un poste du réseau,
   connectez-vous avec le compte administrateur, puis :
   - **Entrée des dossiers → Rangement → Installer le plan** (les armoires du couloir) ;
   - **Entrée des dossiers → Importer des points (Excel)** (les classeurs des dossiers retirés) ;
   - invitez les agents à s'inscrire (adresse @afgcsa.com) ou créez leurs comptes.

Le script peut être relancé sans risque : il garde la configuration et les
données existantes.

### Ce qui est installé

| Emplacement | Contenu |
|---|---|
| `C:\DocuFlow\app` | L'application (remplacée à chaque mise à jour). |
| `C:\DocuFlow\config\docuflow.env` | La configuration, avec les secrets (mot de passe de la base, clé des sessions, mot de passe du certificat). Lisible des seuls administrateurs et de SYSTEM. **Ne pas la copier ailleurs, ne pas l'envoyer par courriel.** |
| `C:\DocuFlow\config\certificat.pfx` | Le certificat du site. |
| `C:\DocuFlow\donnees\fichiers` | Les documents déposés dans l'application. |
| `C:\DocuFlow\journaux` | Un journal par jour (gardés 60 jours). |
| Tâche « DocuFlow AFGC » | Le serveur : démarre avec Windows, se relance en cas d'arrêt. |
| Tâche « DocuFlow AFGC - Sauvegarde » | La sauvegarde de chaque nuit. |
| Pare-feu | Ports 443 et 80 (80 renvoie vers 443), profils Domaine et Privé. |

---

## 3. Reprendre les données de la version en ligne

À faire une fois, **avant** que les agents n'utilisent le serveur interne :
les comptes, demandes, listes, dossiers entrés et armoires de la version en
ligne sont recopiés.

1. Installez avec `-SansEspace` :

   ```powershell
   .\installer.ps1 -NomServeur archives.afgcsa.com -Certificat C:\Installation\archives.pfx -SansEspace
   ```

2. Récupérez la **chaîne de connexion** de la base en ligne : tableau de bord
   Render → service de l'API → *Environment* → `DATABASE_URL` (ou chez
   l'hébergeur de la base). Elle commence par `postgres://`.
3. Lancez le transfert ; la chaîne est demandée à l'écran et n'est enregistrée
   nulle part :

   ```powershell
   cd C:\DocuFlow\scripts
   .\transferer.ps1
   ```

Les comptes et mots de passe restent ceux de la version en ligne. Les
utilisateurs doivent simplement se reconnecter.

Les **fichiers** déposés en ligne (pièces jointes) restent chez l'hébergeur en
ligne. S'il y en a, deux possibilités : les déposer à nouveau, ou ajouter
temporairement à `docuflow.env` les lignes `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY` et `CLOUDINARY_API_SECRET` (valeurs du tableau de bord
Render), le temps de les récupérer. Une fois le serveur interne en service,
la version en ligne peut être arrêtée.

---

## 4. Au quotidien

- **Adresse** : `https://archives.afgcsa.com` (à mettre en favori sur les postes).
- **Vérifier que tout va bien** : `https://archives.afgcsa.com/api/health`
  doit afficher `"api":"ok"` et `"base":"ok"`.
- **Redémarrer** (PowerShell administrateur) :

  ```powershell
  C:\DocuFlow\scripts\redemarrer.ps1
  ```

  Ou, sans PowerShell : Planificateur de tâches → « DocuFlow AFGC » → Fin, puis Exécuter.
- **Journaux** : `C:\DocuFlow\journaux\docuflow-AAAA-MM-JJ.log`.

---

## 5. Sauvegardes et restauration

Chaque nuit, la tâche « DocuFlow AFGC - Sauvegarde » écrit dans le dossier
de sauvegarde :

- `docuflow-AAAA-MM-JJ_HHmm.dump` : toute la base ;
- `fichiers-AAAA-MM-JJ_HHmm.zip` : les documents déposés ;
- `sauvegardes.log` : le compte rendu.

Elles sont gardées 30 jours (`SAUVEGARDE_JOURS` dans `docuflow.env`).
**Ce dossier doit être copié hors du serveur** (NAS, bande, autre site) par
votre sauvegarde habituelle : une sauvegarde restée sur le serveur ne protège
pas d'une panne de celui-ci.

Sauvegarde à la main (avant une intervention) :

```powershell
C:\DocuFlow\scripts\sauvegarder.ps1
```

Restauration (remplace les données actuelles ; l'état courant est sauvegardé juste avant) :

```powershell
cd C:\DocuFlow\scripts
.\restaurer.ps1 -Sauvegarde D:\Sauvegardes\DocuFlow\docuflow-2026-11-20_0200.dump `
                -Fichiers  D:\Sauvegardes\DocuFlow\fichiers-2026-11-20_0200.zip
```

Conseil : faites un essai de restauration une fois par trimestre, sur une
machine de test.

---

## 6. Mettre à jour l'application

1. Décompressez le nouveau paquet (par exemple dans `C:\Installation\DocuFlow-AFGC-Serveur-2.4.0`).
2. En PowerShell administrateur :

   ```powershell
   cd C:\Installation\DocuFlow-AFGC-Serveur-2.4.0\scripts
   Set-ExecutionPolicy -Scope Process Bypass; Get-ChildItem . | Unblock-File
   .\mettre-a-jour.ps1
   ```

Le script sauvegarde d'abord, remplace l'application (la configuration et les
données ne sont pas touchées), redémarre et vérifie. La base est mise à jour
automatiquement au redémarrage. La version précédente est gardée dans
`C:\DocuFlow\app-precedente` ; en cas de problème, le script indique comment y
revenir.

---

## 7. Sécurité

- Le site n'est joignable que depuis le réseau interne. N'ouvrez pas les ports
  443/80 vers Internet et ne publiez pas le site sur un proxy externe.
- PostgreSQL n'écoute que sur le serveur lui-même (réglage par défaut de
  l'installateur EDB) : ne l'ouvrez pas au réseau.
- `C:\DocuFlow\config` contient les secrets : ne pas élargir ses droits.
- **Certificat** : avant son expiration, remplacez `C:\DocuFlow\config\certificat.pfx`
  par le nouveau (même nom ; mettez à jour `HTTPS_PFX_PASSPHRASE` dans
  `docuflow.env` si le mot de passe change), puis redémarrez la tâche.
- Les mises à jour Windows et PostgreSQL suivent votre politique habituelle.
  Après une mise à jour majeure de PostgreSQL (17 → 18), relancez
  `installer.ps1 -PostgresBin "C:\Program Files\PostgreSQL\18\bin"`, ou
  corrigez `POSTGRES_BIN` dans `docuflow.env`.

---

## 8. Courriels (Outlook)

L'application prévient par courriel, depuis la boîte des archives :

| Événement | Destinataire |
|---|---|
| Nouvelle demande, nouvelle liste, demande complétée | l'archive |
| Accusé de réception de la demande | le demandeur |
| Dossier transmis (avec la date de retour) | le demandeur |
| Demande renvoyée pour compléments (avec le mot de l'archive) | le demandeur |
| Retour enregistré (preuve de restitution) | le demandeur |
| Retour en retard (rappel, une fois par jour) | le demandeur |

Les messages partent par **le serveur de messagerie de l'AFGC** (SMTP).
Ajoutez à `C:\DocuFlow\config\docuflow.env` les lignes de **l'un** des deux cas :

**Exchange interne (relais)** — demander à l'administrateur Exchange
d'autoriser l'adresse IP du serveur DocuFlow sur un connecteur de réception
« relais anonyme » :

```
SMTP_HOST=mail.afgcsa.com
SMTP_PORT=25
SMTP_FROM=archives@afgcsa.com
MAIL_FROM_NAME=Archives AFGC
```

**Microsoft 365** — une boîte (ou boîte partagée avec licence) dédiée,
avec « SMTP authentifié » activé pour elle dans le centre d'administration
Microsoft 365 :

```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=archives@afgcsa.com
SMTP_PASSWORD=<mot de passe de la boîte>
SMTP_FROM=archives@afgcsa.com
MAIL_FROM_NAME=Archives AFGC
```

Si le serveur Exchange présente un certificat de l'autorité interne et que
l'envoi échoue sur une erreur de certificat, ajoutez
`SMTP_TLS_ACCEPTER_CERTIFICAT_INTERNE=true`.

Puis redémarrez et faites un essai :

```powershell
C:\DocuFlow\scripts\redemarrer.ps1
C:\DocuFlow\scripts\tester-courriel.ps1 -Adresse prenom.nom@afgcsa.com
```

Dans l'application, **Réglages → Notifications** permet de couper chaque
type de courriel (par exemple l'accusé de réception au demandeur, ou les
courriels à l'archive pour chaque demande), ou tous.

---

## 8 bis. Aide automatique (IA locale)

Le paquet contient trois modèles qui tournent sur le serveur lui-même, sans Internet. Aucun texte ne sort de l'AFGC :

- **Noms proches** : « Crédo B.T.P » retrouve « CREDO BTP SARL ». La réponse est signalée « à vérifier ».
- **Lecture des phrases** : dans une demande écrite en phrase, l'application repère l'entreprise, l'acte et la date.
- **Typologie probable** : l'application propose la typologie d'après la phrase de la demande.

Les modèles sont copiés dans `C:\DocuFlow\modeles` à l'installation et à chaque mise à jour.

Les trois modèles demandent environ 2 Go de mémoire en plus de l'application. L'application ne charge que ceux qui tiennent dans la mémoire du serveur. Pour les choisir vous-même, ajoutez dans `C:\DocuFlow\config\docuflow.env` :

```
IA_LOCALE=oui                    # les trois
IA_LOCALE=recherche,entites      # seulement ceux-là
IA_LOCALE=non                    # aucun
```

Redémarrez ensuite le serveur avec `scripts\redemarrer.ps1`. Pour voir l'état des modèles, allez dans **Réglages**, carte « Aide automatique ». Sans ces modèles, l'application fonctionne comme avant.

## 8 ter. M-Files (recherche et DocuBot)

L'application peut chercher dans M-Files (API REST de M-Files, « M-Files Web
Service ») : menu **Les fonds → Recherche M-Files**, et DocuBot pour l'archive
(« que dit le contrat de … », « cherche … dans M-Files »).

1. Dans M-Files Admin, créez un **compte de service** (ex. `svc-docuflow`),
   en lecture seule sur le coffre, et notez le **GUID du coffre**
   (Propriétés du coffre).
2. Vérifiez depuis ce serveur que l'API répond : ouvrez
   `https://<serveur-mfiles>/REST/server/vaults` dans un navigateur.
3. En administrateur :

   ```powershell
   C:\DocuFlow\scripts\raccorder-mfiles.ps1 -Adresse https://<serveur-mfiles>/REST -Coffre '{GUID}' -Utilisateur svc-docuflow
   ```

   Ajoutez `-Domaine AFGC` si le compte est un compte Windows. Le mot de passe
   est demandé au clavier ; la connexion est testée **avant** d'écrire quoi
   que ce soit dans `docuflow.env`.
4. Pour que DocuBot réponde sur le **contenu** des documents, indexez-les :
   depuis « Recherche M-Files » (bouton « Indexer ces résultats pour DocuBot »),
   ou chaque nuit avec le réglage « Recherches M-Files à indexer pour DocuBot »
   (ex. `2025; 2026`). Les scans sans texte sont lus par l'OCR.

Le compte de service voit tout le coffre : la recherche M-Files et les
réponses sur le contenu sont réservées à l'archive dans l'application.

## 9. Dépannage

| Symptôme | Que faire |
|---|---|
| Le site ne s'ouvre pas depuis un poste | `https://localhost/api/health` sur le serveur : s'il répond, vérifier le DNS (`nslookup archives.afgcsa.com`) et le pare-feu (profil réseau Domaine). Sinon, voir le journal du jour. |
| Le navigateur signale un certificat non valide | Le nom tapé doit être celui du certificat (champ SAN) ; le certificat doit venir de l'autorité interne approuvée par les postes. |
| `"base"` différent de `"ok"` dans `/api/health` | Service « postgresql-x64-17 » arrêté ? Le redémarrer (services.msc), puis la tâche DocuFlow. |
| `"migration_en_echec"` dans `/api/health` | Une mise à jour de la base a échoué : envoyer le journal du jour à l'équipe DocuFlow ; restaurer la sauvegarde de la veille si l'application est inutilisable. |
| Port 443 déjà utilisé (IIS…) | Installer avec `-Port 8443`, ou retirer la liaison 443 du site IIS. |
| Aucun courriel ne part | `tester-courriel.ps1` donne la cause : serveur injoignable (port 25/587 fermé), authentification refusée (SMTP authentifié désactivé dans Microsoft 365), relais refusé (adresse IP non autorisée sur Exchange). Voir aussi le journal du jour (lignes `[mail]`). |
| Échec de la sauvegarde | Voir `sauvegardes.log` dans le dossier de sauvegarde (disque plein, droits). |

---

## 10. Désinstaller

En PowerShell administrateur :

```powershell
Unregister-ScheduledTask "DocuFlow AFGC" -Confirm:$false
Unregister-ScheduledTask "DocuFlow AFGC - Sauvegarde" -Confirm:$false
Get-NetFirewallRule -DisplayName "DocuFlow AFGC*" | Remove-NetFirewallRule
```

Puis, **après une dernière sauvegarde conservée**, supprimer `C:\DocuFlow` et
la base (`DROP DATABASE docuflow;` dans pgAdmin).
