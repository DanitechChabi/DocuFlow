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
const superadminRoutes = require('./routes/superadminRoutes');

const path = require('path');

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
    ].filter(Boolean).flatMap((o) => o.includes(',') ? o.split(',').map((s) => s.trim()) : [o]);

app.use(cors(
  isDev
    ? { origin: true, credentials: true }
    : {
        origin: (origin, cb) => {
          if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            cb(null, true);
          } else {
            cb(new Error('Non autorisé par CORS'));
          }
        },
        credentials: true,
      }
));
app.use(express.json({ limit: '10mb' }));

// Dossier uploads en statique (logo)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Diagnostic Middleware: Logs every single request attempt
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] Request received: ${req.method} ${req.url}`);
  next();
});

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
app.use('/api/superadmin', superadminRoutes);

// Dossier des fichiers uploadés
app.use('/uploads/files', express.static(path.join(__dirname, '../uploads/files')));

// Basic health check
app.get('/', (req, res) => {
  res.send('DocuFlow-AFGC API is running...');
});

// Global error handler — prevents unhandled errors from crashing the process
app.use((err, req, res, _next) => {
  console.error('[global] Unhandled error:', err);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'JSON invalide dans le corps de la requête' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'Fichier trop volumineux (10 Mo max)' });
  }
  // Erreurs multer (upload) → message réel au lieu d'un 500 générique
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ message: 'Trop de fichiers (5 max par demande) ou champ inattendu' });
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
// 0.0.0.0 : indispensable en déploiement cloud (Render, Railway…) pour écouter sur toutes les interfaces
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`-------------------------------------------------`);
  console.log(`🚀 Server is running!`);
  console.log(`📍 Local: http://127.0.0.1:${PORT}`);
  console.log(`-------------------------------------------------`);
});

