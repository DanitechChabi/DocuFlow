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

// Derrière un proxy (Render…) : req.protocol reflète le X-Forwarded-Proto (https).
// Sur le serveur interne (sans proxy), faire confiance à X-Forwarded-For
// permettrait à n'importe qui de choisir son adresse et de contourner la
// limite des tentatives de connexion : seul le proxy local est cru.
app.set('trust proxy', process.env.TRUST_PROXY || (process.env.RENDER ? 1 : 'loopback'));
app.disable('x-powered-by');

// En-têtes de sécurité : pas d'interprétation de type, pas d'affichage dans
// un cadre d'un autre site, adresse d'origine réduite, HTTPS imposé.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// Middlewares — CORS (ouvert en dev, restreint en prod)
const isDev = process.env.NODE_ENV !== 'production';
const ALLOWED_ORIGINS = isDev
  ? true // En dev local, accepter toutes les origines
  : [
      process.env.CORS_ORIGIN,
      process.env.APP_URL,
      // Adresse actuelle de la plateforme ; les deux suivantes restent
      // acceptées tant que l'ancienne version y est en ligne.
      'https://docuflow-plateforme.vercel.app',
      'https://docuflow.vercel.app',
      'https://docuflow-afgc.vercel.app',
      // Site dédié de l'AFGC (édition AFGC de la plateforme, espace « afgc »).
      'https://afgc.vercel.app',
      // Site vitrine : c'est LUI qui porte la page de tarifs et appelle
      // /api/billing. Sans ces entrées, le bouton de paiement échouerait sur un
      // refus CORS — et le navigateur n'en dirait rien d'exploitable au client.
      // LANDING_URL permet d'ajouter les URL de prévisualisation Vercel sans
      // toucher au code ; le domaine ci-dessous est celui des balises canonical
      // du site vitrine (cf. useSEO.js), donc l'adresse réelle des acheteurs.
      process.env.LANDING_URL,
      'https://getdocuflow-bj.vercel.app',
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
// Entrée des dossiers aux archives (049) : points journaliers, semaines de production, recherche.
app.use('/api/entrees', require('./routes/entreeRoutes'));
app.use('/api/ia', require('./routes/iaRoutes'));
app.use('/api/cartons', require('./routes/cartonsRoutes'));
app.use('/api/push', require('./routes/pushRoutes'));
app.use('/api/mfiles', require('./routes/mfilesRoutes'));
// Plan de classement et calendrier de conservation (AFGC) : consultables par tous les comptes.
app.get('/api/plan-classement', require('./middlewares/authMiddleware'), (req, res) => res.json(require('./services/planService').lister()));
app.use('/api/comptes', require('./routes/comptesRoutes'));
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
// Conformité : alertes d'incohérence entre documents, fournisseurs (migration 030).
app.use('/api', require('./routes/conformiteRoutes'));
app.use('/api', require('./routes/archivesRoutes'));
// Collaboration (migration 033) : favoris, suivi, commentaires, liens de
// partage (gestion), restauration de version — authentifiées route par route.
app.use('/api', require('./routes/collaborationRoutes'));
// Liens de partage PUBLICS (/api/partage/:jeton) — sans authentification.
app.use('/api', require('./routes/partageRoutes'));
// Circuits de validation (migration 034) : modèles, tâches, visas.
app.use('/api', require('./routes/circuitRoutes'));
// Recherche avancée, échéancier, paquet d'archive (migration 035).
app.use('/api', require('./routes/rechercheRoutes'));
// Archivage réglementaire (migration 032) : DUA, sort final, éliminations.
app.use('/api', require('./routes/archivageRoutes'));
app.use('/api', require('./routes/physiqueRoutes'));
app.use('/api', require('./routes/serviceArchivesRoutes'));
app.use('/api', require('./routes/outilsRoutes'));
app.use('/api', require('./routes/archivothequeRoutes'));
// Portail citoyen et vérification publique des copies (040) : routes publiques
// (débit limité) et volet du personnel.
app.use('/api', require('./routes/portailRoutes'));
// Courrier — bureau d'ordre (041).
app.use('/api/courriers', require('./routes/courrierRoutes'));
// Absence et suppléance (042).
app.use('/api/absence', require('./routes/absenceRoutes'));
// Activation des licences de bureau — PUBLIC (le poste n'a pas encore de compte
// au moment de s'activer). Voir l'en-tête de licenseRoutes.js. L'administration
// des licences est montée sous /api/superadmin, derrière ses trois middlewares.
app.use('/api/licenses', licenseRoutes);

// --- Interface servie par le serveur lui-même (même origine) ---
// - Bureau (Electron) : SERVE_FRONTEND=true (défini par desktop/main.js).
// - Serveur de l'organisation (Windows Server, réseau interne) : FRONTEND_DIST
//   = dossier de l'interface compilée (deploiement/windows-server). Une seule
//   adresse pour tout : https://archives…/ (interface) et …/api (API).
// Sans impact sur Render/Vercel (variables absentes) : routes /api, /uploads
// et health check conservent leur comportement actuel.
const fs = require('fs');
const frontendDist = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : path.join(__dirname, '../../frontend/dist');
if ((process.env.SERVE_FRONTEND === 'true' || process.env.FRONTEND_DIST) && fs.existsSync(frontendDist)) {
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
    etat.base_erreur = err.code || 'erreur';
  }
  res.status(etat.base === 'ok' ? 200 : 503).json(etat);
});

// Adresse d'API inconnue : une réponse claire plutôt que la page d'accueil.
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Cette adresse n\'existe pas dans l\'application.', code: 'ADRESSE_INCONNUE' });
});

// Global error handler — prevents unhandled errors from crashing the process
app.use((err, req, res, _next) => {
  // Une référence courte, dans la réponse et dans le journal : l'administrateur
  // retrouve l'erreur exacte à partir de ce que l'agent lui lit à l'écran.
  const ref = require('crypto').randomBytes(3).toString('hex').toUpperCase();
  console.error(`[global] Erreur ${ref} sur ${req.method} ${req.originalUrl} :`, err);
  // Erreurs de la base, dites simplement.
  const PG = {
    '23505': [409, 'Cet élément existe déjà.'],
    '23503': [409, 'Cet élément est lié à d\'autres données : il ne peut pas être supprimé ou modifié ainsi.'],
    '23502': [400, 'Une information obligatoire manque.'],
    '22P02': [400, 'Une valeur saisie n\'a pas le bon format.'],
    '22001': [400, 'Un texte saisi est trop long.'],
    '22007': [400, 'Une date saisie est invalide.'],
    '22008': [400, 'Une date saisie est invalide.'],
    '57014': [503, 'L\'opération a pris trop de temps. Réessayez dans un instant.'],
    '53300': [503, 'Le serveur est très sollicité. Réessayez dans un instant.'],
  };
  if (err && PG[err.code]) return res.status(PG[err.code][0]).json({ message: PG[err.code][1], ref });
  if (err && ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code)) {
    return res.status(503).json({ message: 'La base de données ne répond pas. Réessayez dans un instant ; si cela dure, prévenez l\'administrateur.', ref });
  }
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
  if (err && Number.isInteger(err.statut) && err.statut < 500) return res.status(err.statut).json({ message: err.message, ref });
  res.status(500).json({ message: `Une erreur inattendue s'est produite. Si elle se répète, donnez cette référence à l'administrateur : ${ref}.`, ref });
});

const PORT = process.env.PORT || 3000;
// 0.0.0.0 : indispensable en déploiement cloud (Render, Railway…) pour écouter sur toutes les interfaces.
// Mode bureau (Electron) : desktop/main.js pose HOST=127.0.0.1 (loopback uniquement) et PORT=0
// (port libre attribué par l'OS — lu via server.address().port).
const HOST = process.env.HOST || '0.0.0.0';

// HTTPS direct (serveur de l'organisation) : certificat PFX délivré par
// l'autorité interne (AD CS) ou acheté. HTTPS_PFX_PATH absent : HTTP simple,
// comme sur Render (qui chiffre en amont) et en bureau (boucle locale).
// HTTP_REDIRECT_PORT : un second port (80) qui renvoie vers l'adresse HTTPS.
function ecouter(application, demarre) {
  if (!process.env.HTTPS_PFX_PATH) return application.listen(PORT, HOST, demarre);
  const https = require('https');
  const srv = https.createServer({
    pfx: fs.readFileSync(path.resolve(process.env.HTTPS_PFX_PATH)),
    passphrase: process.env.HTTPS_PFX_PASSPHRASE || undefined,
  }, application).listen(PORT, HOST, demarre);
  const portRedirection = Number(process.env.HTTP_REDIRECT_PORT);
  if (portRedirection) {
    require('http').createServer((req, res) => {
      const hote = String(req.headers.host || '').replace(/:\d+$/, '');
      const suffixe = Number(PORT) === 443 ? '' : `:${PORT}`;
      res.writeHead(301, { Location: `https://${hote}${suffixe}${req.url}` });
      res.end();
    }).listen(portRedirection, HOST);
  }
  return srv;
}

const server = ecouter(app, () => {
  console.log(`-------------------------------------------------`);
  console.log(`🚀 Server is running!`);
  console.log(`📍 Local: ${process.env.HTTPS_PFX_PATH ? 'https' : 'http'}://127.0.0.1:${PORT}`);
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
    // Analyse des documents (migration 030) : lecture des montants, dates et
    // identifiants, puis contrôle de conformité entre documents.
    require('./services/analyseService').demarrerAnalyse();
    // Preuve et intégrité (migration 031) : empreintes des anciens fichiers,
    // contrôle périodique des fichiers stockés, sceau quotidien du journal.
    require('./services/integriteService').demarrerIntegrite();
    require('./services/horodatageService').demarrerHorodatage();
    require('./services/courrierService').demarrerCourrier();
    // Campagnes d'archivage périodiques (044) : le rendez-vous de chaque période.
    require('./services/campagneService').demarrer();
    // Formats de conservation (037) : identification des fichiers existants.
    require('./services/formatService').demarrerFormats();
    // Sauvegarde quotidienne de l'application de bureau (si activée).
    require('./services/sauvegardeService').demarrerSauvegarde();
    // Rappels des tâches de validation en retard (migration 034).
    require('./services/circuitService').demarrerRelances();
    // Alertes des recherches enregistrées et rappels d'échéances (035).
    require('./services/rechercheService').demarrerAlertes();
    require('./services/echeanceService').demarrerEcheances();
    // Aide automatique (055) : les modèles tenus en mémoire, puis l'index des
    // noms d'entreprise. Un peu après le démarrage, pour ne pas le ralentir.
    // DocuBot : le modèle des intentions apprend sur son jeu d'exemples (≈ 0,1 s).
    try { require('./services/intentionService').pret(); } catch (err) { console.error('[docubot] apprentissage :', err.message); }
    // Puis ce qu'il a appris de l'usage de chaque organisation (056), et chaque nuit.
    require('./services/apprentissageService').demarrer();
    // La veille du matin, par courriel à l'archive (056).
    require('./services/veilleService').demarrer();
    // Les notifications importantes, poussées sur les appareils abonnés (058).
    require('./services/pushService').demarrer();
    // Rappels la veille du retour prévu, relances de retard : toutes les heures (061).
    require('./services/loanService').demarrerRappels();
    // Le texte des documents, découpé pour DocuBot (RAG, 060) : GED, recherches M-Files réglées.
    require('./services/ragService').demarrer();
    // Le modèle de langue (Ollama), s'il est réglé : chargé maintenant et
    // gardé chargé, pour que la première question n'attende pas.
    const prechauffer = async () => {
      try {
        const r = await require('./config/db').query("SELECT DISTINCT tenant_id FROM settings WHERE key = 'ollama_url' AND COALESCE(value::text, '') NOT IN ('', 'null', '\"\"')");
        for (const { tenant_id: t } of r.rows) await require('./services/ollamaService').prechauffer(t);
      } catch { /* sans Ollama : rien à charger */ }
    };
    setTimeout(prechauffer, 20000).unref();
    setInterval(prechauffer, 6 * 60 * 60 * 1000).unref();
    setTimeout(() => {
      const ia = require('./services/iaService');
      const actifs = ia.modelesActifs();
      console.log(`[ia] modèles retenus : ${actifs.length ? actifs.join(', ') : 'aucun'} (mémoire ${ia.memoireMo()} Mo)`);
      ia.prechauffer().then(() => require('./services/nomsProchesService').demarrer());
    }, 15000).unref();
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

