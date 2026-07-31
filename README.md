# DocuFlow

**DocuFlow** est une plateforme de gestion documentaire conçue pour suivre les demandes de documents au sein d'une organisation. Elle permet aux demandeurs de créer et suivre leurs demandes, et aux archivistes de traiter, vérifier et livrer les documents demandés.

## ✨ Fonctionnalités

- 📋 **Demandes documentaires** — création et suivi avec statuts (en attente, à traiter, transmis, livré, rejeté)
- 💬 **Messagerie interne** — échanges entre utilisateurs avec pièces jointes
- 📎 **Transmission de fichiers** — pièces jointes aux demandes et aux messages
- 🔔 **Notifications** — alertes à la création et au changement de statut
- 👥 **Gestion des rôles** — demandeur, archiviste, admin, superadmin
- 🏢 **Multi-entreprises** — espaces isolés par organisation
- 🏷️ **Branding personnalisable** — logo, nom, description du site
- 📊 **Statistiques et historique** — suivi des flux et journal d'audit

## 🛠️ Stack technique

### Backend
- Node.js / Express
- PostgreSQL
- JWT pour l'authentification
- Multer pour l'upload de fichiers

### Frontend
- React 19
- Vite 8
- Tailwind CSS v4
- lucide-react (icônes)

## 🚀 Installation

### Prérequis
- Node.js ≥ 18
- PostgreSQL ≥ 12

### 1. Backend
```bash
cd backend
npm install
# Configurer le fichier .env (voir .env.example)
node src/app.js
```

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

L'application est accessible sur `http://localhost:5173` (frontend) et l'API sur `http://127.0.0.1:30001` (backend).

### 3. Base de données
Le schéma SQL est disponible dans `docs/setup_db.sql`.

## 👨‍💻 Auteur

**CHABI BOUKO Daniel** — Archiviste & Développeur Web
- Portfolio : [danielchabi.netlify.app](https://danielchabi.netlify.app)
- Email : chabidaniel093@gmail.com

## 📄 Licence

© 2026 CHABI BOUKO Daniel — Tous droits réservés.
