const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config({ path: './.env' });

const authRoutes = require('./routes/authRoutes');
const requestRoutes = require('./routes/requestRoutes');
const userRoutes = require('./routes/userRoutes');
const sectionRoutes = require('./routes/sectionRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const requestDetailsRoutes = require('./routes/requestDetailsRoutes');
const messageRoutes = require('./routes/messageRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const tenantRoutes = require('./routes/tenantRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const documentRoutes = require('./routes/documentRoutes');
const metadataRoutes = require('./routes/metadataRoutes');
const superadminRoutes = require('./routes/superadminRoutes');
const groupRoutes = require('./routes/groupRoutes');
const auditRoutes = require('./routes/auditRoutes');
const licenseRoutes = require('./routes/licenseRoutes');

const path = require('path');

// Dossier des uploads (surchargeable via UPLOADS_DIR — bureau Electron)
const { UPLOADS_DIR } = require('./config/paths');

const app = express();

// Derrière un proxy (Render…) : req.protocol reflète le X-Forwarded-Proto (https)
app.set('trust proxy', true);

// Middlewares — CORS (ouvert en dev, restreint en prod)
const isDev = process.env.NODE_ENV !== 'production';
const ALLOWED_ORIGINS = isDev
  ? true // En dev local, accepter toutes les origines
  : [
      process.env.CORS_ORIGIN,
      process.env.APP_URL,
      'https://docuflow.vercel.app',
      'https://docuflow-afgc.vercel.app',
      // Site vitrine : c'est LUI qui porte la page de tarifs et appelle
      // /api/billing. Sans ces entrées, le bouton de paiement échouerait sur un
      // refus CORS — et le navigateur n'en dirait rien d'exploitable au client.
      // LANDING_URL permet d'ajouter les URL de prévisualisation Vercel sans
      // toucher au code ; le domaine ci-dessous est celui des balises canonical
      // du site vitrine (cf. useSEO.js), donc l'adresse réelle des acheteurs.
      process.env.LANDING_URL,
      'https://getdocuflow.vercel.app',
      'https://docuflow-afgc.com',
      'https://www.docuflow-afgc.com',
    ].filter(Boolean).flatMap((o) => o.includes(',') ? o.split(',').map((s) => s.trim()) : [o]);

// Délégué CORS (cors > 2.8) : la fonction reçoit la REQUÊTE, contrairement au
// simple callback `origin` qui ne voit que la valeur d'en-tête. C'est ce qui
// permet le contrôle de même-origine ci-dessous.
const corsOrigines = (req, cb) => {
  const origin = req.headers.origin;
  // Une origine refusée n'est PAS une erreur du serveur : rendre la main avec
  // `false` laisse la requête continuer sans l'en-tête d'autorisation, et c'est
  // le navigateur qui bloque la lecture de la réponse — le comportement attendu.
  //
  // Passer un Error ici, en revanche, le propulse jusqu'au gestionnaire global :
  // 500 et pile d'appels dans les journaux, à chaque visiteur d'une origine
  // inconnue. Le vrai incident (un déploiement dont l'URL n'est pas dans la
  // liste) devient alors indiscernable d'une panne, et les journaux de Render se
  // remplissent de bruit.
  const accepter = () => cb(null, { origin: true, credentials: true });
  const refuser = () => {
    console.warn(`[cors] Origine refusée : ${origin}`);
    cb(null, { origin: false });
  };

  if (!origin || ALLOWED_ORIGINS.includes(origin)) return accepter();

  // MÊME ORIGINE — le mode bureau (NODE_ENV production depuis que l'application
  // packagée n'est plus en « development ») serviait SA PROPRE origine : le
  // port y est attribué par l'OS à chaque lancement, donc invérifiable par
  // liste. Les requêtes same-origin passent sans en-tête CORS, mais chaque
  // chargement de page écrivait une ligne « Origine refusée » dans les journaux
  // du client. Réfléchir l'origine quand elle DÉSIGNE CE SERVEUR
  // (origin == protocole://hôte de la requête) n'ouvre rien : c'est la
  // définition même du same-origin.
  const protocole = req.headers['x-forwarded-proto'] || 'http';
  if (req.headers.host && origin === `${protocole}://${req.headers.host}`) {
    return accepter();
  }
  return refuser();
};

app.use(cors(
  isDev
    ? { origin: true, credentials: true }
    : corsOrigines
));
// --- Facturation ----------------------------------------------------------
// Monté AVANT express.json, et cet ordre est OBLIGATOIRE : les webhooks de
// paiement vérifient une signature calculée sur les octets bruts du corps, et
// body-parser ignore tout corps déjà consommé. Analyser le JSON en premier
// remplirait req.body d'un objet et ferait échouer la vérification de TOUS les
// paiements — sans erreur visible, juste des licences jamais émises.
// Chaque route de billingRoutes déclare donc l'analyseur qui lui convient.
//
// Également avant licenseMiddleware : l'achat doit rester possible depuis un
// poste dont la licence est précisément expirée.
app.use('/api/billing', require('./routes/billingRoutes'));

app.use(express.json({ limit: '10mb' }));

// Garde avant le statique ci-dessous : UPLOADS_DIR contient FILES_DIR
// (uploads/files/) en sous-dossier, donc express.static(UPLOADS_DIR) servait
// aussi /uploads/files/* — tout document, pièce jointe de demande ou de
// message stocké en local — SANS authentification, RBAC, ACL de dossier ni
// trace d'audit, à quiconque devinait ou obtenait un nom de fichier stocké.
// Les fichiers privés transitent désormais uniquement par les routes
// protégées (/api/documents/:id/files/:fileId/download et équivalents pour
// les demandes/messages, voir storageService.secureFileUrl). Les logos
// d'organisation, à la racine de UPLOADS_DIR (pas sous files/), restent
// servis tels quels : aucune migration d'URL nécessaire.
app.use('/uploads/files', (req, res) => res.status(404).end());

// Dossier uploads en statique (logo)
app.use('/uploads', express.static(UPLOADS_DIR));

// Diagnostic Middleware: Logs every single request attempt
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] Request received: ${req.method} ${req.url}`);
  next();
});

const auditMiddleware = require('./middlewares/auditMiddleware');
app.use(auditMiddleware);

// --- Licence de bureau ---------------------------------------------------
// Monté AVANT les routes métier : sans licence valide, aucune donnée ne sort.
// Sans effet hors mode bureau (le middleware rend la main immédiatement si
// SERVE_FRONTEND n'est pas 'true') — le SaaS Render n'est donc pas concerné.
//
// Les routes de l'écran de licence sont montées juste avant, pour qu'elles
// restent joignables même quand la licence est refusée : c'est par elles que le
// client saisit sa clé.
if (process.env.SERVE_FRONTEND === 'true') {
  app.use('/api/license', require('./routes/desktopLicenseRoutes'));
}
app.use(require('./middlewares/licenseMiddleware'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sections', sectionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/request-details', requestDetailsRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/metadata', metadataRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/roles', require('./routes/roleRoutes'));
app.use('/api/audit', auditRoutes);
// Activation des licences de bureau — PUBLIC (le poste n'a pas encore de compte
// au moment de s'activer). Voir l'en-tête de licenseRoutes.js. L'administration
// des licences est montée sous /api/superadmin, derrière ses trois middlewares.
app.use('/api/licenses', licenseRoutes);

// --- Mode bureau (Electron) : sert le frontend compilé, même-origine ---
// Opt-in via SERVE_FRONTEND=true (défini par desktop/main.js).
// Sans impact sur Render/Vercel (variable absente) : routes /api, /uploads
// et health check conservent leur comportement actuel.
const fs = require('fs');
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (process.env.SERVE_FRONTEND === 'true' && fs.existsSync(frontendDist)) {
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
      return express.static(frontendDist)(req, res, () => {
        res.sendFile(path.join(frontendDist, 'index.html')); // SPA fallback (React Router)
      });
    }
    next();
  });
}

// Basic health check
app.get('/', (req, res) => {
  res.send('DocuFlow API is running...');
});

// État de la plateforme — public, sans donnée d'organisation : il sert à
// vérifier un déploiement (« la nouvelle version est-elle en ligne ? ») et à
// diagnostiquer une liste vide (base injoignable, migration en échec,
// stockage des fichiers non persistant).
//   version  — commit déployé (Render fournit RENDER_GIT_COMMIT)
//   stockage — 'cloudinary' (persistant) ou 'local' : sur Render sans disque,
//              les fichiers locaux sont EFFACÉS à chaque redéploiement.
let etatMigrations = { echec: null };
const DEMARRE_LE = new Date().toISOString();
app.get('/api/health', async (req, res) => {
  const etat = {
    api: 'ok',
    version: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 7) || null,
    demarre_le: DEMARRE_LE,
    base: 'ok',
    derniere_migration: null,
    migration_en_echec: etatMigrations.echec,
    stockage: require('./services/storageService').USE_CLOUDINARY ? 'cloudinary' : 'local',
  };
  try {
    const db = require('./config/db');
    const m = await db.query('SELECT filename FROM migrations ORDER BY filename DESC LIMIT 1').catch(() => ({ rows: [] }));
    etat.derniere_migration = m.rows[0]?.filename || null;
    await db.query('SELECT 1');
  } catch (err) {
    etat.base = 'injoignable';
    etat.base_erreur = err.message;
  }
  res.status(etat.base === 'ok' ? 200 : 503).json(etat);
});

// Global error handler — prevents unhandled errors from crashing the process
app.use((err, req, res, _next) => {
  console.error('[global] Unhandled error:', err);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'JSON invalide dans le corps de la requête' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    // Plafond absolu du serveur. La limite propre à chaque organisation est
    // appliquée en amont par uploadPolicyMiddleware, avec son propre message.
    const { MAX_UPLOAD_BYTES } = require('./helpers/upload');
    return res.status(413).json({
      message: `Fichier trop volumineux (${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} Mo max)`,
    });
  }
  // Erreurs multer (upload) → message réel au lieu d'un 500 générique
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      // 100 = plafond de uploadMultiple (upload.array('files', 100)) ; le
      // message doit suivre la limite réelle, pas un souvenir de l'ancienne.
      return res.status(400).json({ message: 'Trop de fichiers (100 max par versement) ou champ inattendu' });
    }
    return res.status(400).json({ message: `Erreur lors de l'upload : ${err.message}` });
  }
  // Erreurs busboy (multipart malformé / boundary absent) → 400
  if (err && err.message && /multipart|boundary/i.test(err.message)) {
    return res.status(400).json({ message: `Requête multipart invalide : ${err.message}` });
  }
  // Rejet du fileFilter (type de fichier non autorisé)
  if (err.message && err.message.startsWith('Type de fichier non supporté')) {
    return res.status(400).json({ message: err.message });
  }
  res.status(500).json({ message: 'Erreur interne du serveur' });
});

const PORT = process.env.PORT || 3000;
// 0.0.0.0 : indispensable en déploiement cloud (Render, Railway…) pour écouter sur toutes les interfaces.
// Mode bureau (Electron) : desktop/main.js pose HOST=127.0.0.1 (loopback uniquement) et PORT=0
// (port libre attribué par l'OS — lu via server.address().port).
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`-------------------------------------------------`);
  console.log(`🚀 Server is running!`);
  console.log(`📍 Local: http://127.0.0.1:${PORT}`);
  console.log(`-------------------------------------------------`);

  // Synchronise le catalogue de configuration (config/settingsCatalog.js) vers
  // `setting_definitions`. La base reflète ainsi toujours le code : la console
  // de configuration et la fonction SQL provision_tenant_defaults() disposent du
  // même référentiel. Échec sans conséquence : le catalogue reste servi depuis
  // le code, seule la copie en base est différée.
  //
  // Précédée de l'application des migrations manquantes (services/
  // migrationRunner) : à chaque déploiement, la base rattrape le code sans
  // intervention manuelle sur Neon. Après l'écoute, et non avant : l'app de
  // bureau lit `server` dès le require de ce module, et le code tolère un
  // schéma en retard pendant ces quelques secondes. L'app de bureau migre
  // déjà dans son propre amorçage (desktop/bootstrap.js) : pas de second
  // passage ici.
  const tenantProvisioningService = require('./services/tenantProvisioningService');
  const migrer = process.env.SERVE_FRONTEND === 'true'
    ? Promise.resolve()
    : require('./services/migrationRunner').appliquerMigrations()
      .then((r) => {
        etatMigrations = r.echec ? { echec: r.echec.fichier, message: r.echec.message } : { echec: null };
        if (r.ignore) console.log(`[migrations] non exécutées : ${r.ignore}`);
        else if (!r.echec) console.log(`[migrations] base à jour${r.appliquees.length ? ` (${r.appliquees.length} appliquée(s))` : ''}`);
      })
      .catch((err) => console.error('[migrations] impossible de vérifier les migrations :', err.message));
  // Contenu des fichiers versés avant 027 : indexé en arrière-plan, après
  // les migrations (les colonnes doivent exister).
  migrer.then(() => {
    const contenu = require('./services/contentIndexService');
    contenu.demarrerRattrapage();
    // Scans (PDF sans texte, photos) : OCR en arrière-plan (migration 028).
    contenu.demarrerOcr();
  });
  migrer
    .then(() => tenantProvisioningService.syncSettingDefinitions())
    .then((result) => {
      if (result.synced) console.log(`[config] ${result.synced} définitions de paramètres synchronisées`);
    })
    .catch((err) => console.warn('[config] Synchronisation du catalogue différée :', err.message));
});

// Exporté pour l'app de bureau (Electron) : desktop/main.js lit server.address().port
// quand PORT=0 et garde la main sur le cycle de vie du serveur.
module.exports = { app, server };

