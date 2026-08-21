# Déploiement de DocuFlow-AFGC

Stratégie : **hybride** — frontend sur **Vercel** (gratuit), backend Express sur **Render** (web service, démarrage gratuit), base de données **Neon** (PostgreSQL, tier gratuit permanent).

> Pourquoi pas tout sur Vercel ? Vercel héberge très bien le frontend statique, mais ses fonctions serverless ont un système de fichiers **éphémère et en lecture seule** : les pièces jointes (upload Multer) seraient perdues. Render/Railway exécute un vrai serveur Node persistant, adapté à cette app.

---

## Étape 1 — Base de données : Neon (gratuit)

1. Compte sur [neon.tech](https://neon.tech) → **Create a project** (région la plus proche, ex. `eu-central-1`).
2. Copier la **connection string** : `postgres://USER:PASSWORD@HOST/DBNAME?sslmode=require`
3. La décomposer en variables (à réutiliser à l'étape 2) :
   - `DB_USER` = USER
   - `DB_PASSWORD` = PASSWORD
   - `DB_HOST` = HOST
   - `DB_PORT` = `5432`
   - `DB_NAME` = DBNAME (par défaut `neondb`)
4. **Appliquer le schéma** : `docs/setup_db.sql`, puis TOUTES les migrations de
   `docs/migrations/` dans l'ordre numérique (001 → 014). Elles sont idempotentes :
   les réexécuter est sans effet.

   Via l'éditeur **SQL Editor** de Neon (coller le contenu de chaque fichier), ou
   en ligne de commande :
   ```bash
   psql "postgres://USER:PASSWORD@HOST/DBNAME?sslmode=require" -f docs/setup_db.sql
   for f in docs/migrations/*.sql; do
     psql "postgres://USER:PASSWORD@HOST/DBNAME?sslmode=require" -f "$f"
   done
   ```

   Depuis `backend/`, avec `DATABASE_URL` déjà configurée dans `.env`, `run_sql.js`
   cible la même base que l'application (SSL et Neon compris) :
   ```bash
   node run_sql.js ../docs/migrations/014_admin_deletion_rules.sql
   ```

   > N'utilisez PAS `backend/migrate.js` sur Neon : il ne lit que les variables
   > `DB_*` et ignore `DATABASE_URL`, donc il viserait `localhost`.

   Les migrations ne sont pas facultatives. Sans **014**, la suppression d'un
   utilisateur ou d'une entreprise échoue en erreur de clé étrangère, et la purge
   du journal d'audit est refusée par le trigger append-only.

---

## Étape 2 — Backend sur Render

1. Compte sur [render.com](https://render.com) (via GitHub de préférence).
2. **New → Web Service** → connecter le repo `DanitechChabi/DocuFlow`.
3. Réglages :
   - **Root Directory** : `backend`
   - **Build Command** : `npm install`
   - **Start Command** : `node src/app.js`
   - **Plan** : Free (ou Starter selon besoin)
4. Dans **Environment / Advanced** (ou à la création) définir :
   ```
   DB_HOST=…
   DB_PORT=5432
   DB_USER=…
   DB_PASSWORD=…
   DB_NAME=…
   JWT_SECRET=<longue valeur aléatoire — ne pas réutiliser celle du .env local>
   ```
   Ne **pas** définir `PORT` : Render l'injecte automatiquement.
5. (Recommandé en production) **Disks → Attach disk**, monté sur `/opt/render/project/src/uploads`, sinon les fichiers uploadés sont effacés à chaque redeploy.
6. **Deploy**. L'URL ressemble à `https://docuflow-backend.onrender.com`.

Vérification : ouvrir `https://docuflow-backend.onrender.com/` → « DocuFlow-AFGC API is running... »

---

## Étape 3 — Frontend sur Vercel

1. Compte sur [vercel.com](https://vercel.com) (via GitHub).
2. **Add New… → Project** → importer `DanitechChabi/DocuFlow`.
3. Réglages :
   - **Root Directory** : `frontend`
   - **Framework Preset** : Vite (auto-détecté)
   - **Build Command** : `npm run build`
   - **Output Directory** : `dist`
   - (`frontend/vercel.json` gère déjà les routes du `BrowserRouter`.)
4. **Environment Variables** :
   ```
   VITE_API_URL=https://docuflow-backend.onrender.com/api
   ```
5. **Deploy**. L'URL ressemble à `https://docuflow-afgc.vercel.app`.

---

## Étape 4 — Mises à jour

Chaque `git push` sur `master` redéploie automatiquement Vercel et Render (lien GitHub). Rien à faire d'autre.

---

## Points d'attention

- **Uploads sur le plan free de Render** : les fichiers sont perdus au redémarrage/redeploy. Pour une production réelle, attacher le disque persistant (cf. étape 2.5) ou migrer vers S3/Cloudinary.
- **Neon free** : 0,5 Go de stockage, 100 CU-h/mois — le compute se met en pause si la limite est dépassée (reprise au mois suivant, ou passage en plan Launch).
- **CORS** : le backend utilise `cors()` ouvert, le frontend Vercel peut donc appeler l'API Render sans réglage.
- **URLs de téléchargement** : construites dynamiquement (`req.get('host')`) → fonctionnent en production.
- Ne jamais commiter `backend/.env` (déjà dans `.gitignore`).

## Vérification end-to-end

1. API : `https://<backend>.onrender.com/` répond.
2. Frontend : connexion avec un compte existant (créer un superadmin au besoin, cf. `backend/promote_admin.js`).
3. Créer une demande → joindre une pièce jointe → vérifier le téléchargement.
4. Recharger directement `https://<frontend>.vercel.app/dashboard` (le rewrite SPA doit ramener l'app).
