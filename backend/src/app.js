const express = require('express');
const cors = require('cors');
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

const path = require('path');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

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

// Dossier des fichiers uploadés
app.use('/uploads/files', express.static(path.join(__dirname, '../uploads/files')));

// Basic health check
app.get('/', (req, res) => {
  res.send('DocuFlow-AFGC API is running...');
});

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';

app.listen(PORT, HOST, () => {
  console.log(`-------------------------------------------------`);
  console.log(`🚀 Server is running!`);
  console.log(`📍 Local: http://127.0.0.1:${PORT}`);
  console.log(`-------------------------------------------------`);
});

