const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const storage = require('../services/storageService');
const path = require('path');
const fs = require('fs');

const { FILES_DIR } = require('../config/paths');

exports.uploadRequestFiles = async (req, res) => {
  const { requestId } = req.params;
  const userId = req.user.id;
  const tenantId = req.user.tenant_id;

  // ---------- VALIDATION SÉCURITÉ (AVANT TOUTE SAUVEGARDE) ----------
  const MAX_SIZE_MB = 10; // 10 Mo par fichier
  const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/msword', // .doc
    'application/vnd.ms-excel', // .xls
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/json',
    'text/plain',
    'application/vnd.ms-outlook'
  ];

  try {
    // Vérifier que la demande existe et appartient au tenant
    const request = await tenantDb.query(tenantId, 'SELECT id FROM requests WHERE id = $1', [requestId]);
    if (request.rows.length === 0) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'Aucun fichier fourni' });
    }

    // Valider TOUS les fichiers AVANT de sauvegarder un seul
    for (const file of req.files) {
      // --- Validation taille ---
      const sizeInMb = file.size / (1024 * 1024);
      if (sizeInMb > MAX_SIZE_MB) {
        return res.status(400).json({
          message: `Fichier trop volumineux (max ${MAX_SIZE_MB} Mo) : ${file.originalname}`
        });
      }

      // --- Validation type MIME ---
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return res.status(400).json({
          message: `Type de fichier non autorisé : ${file.mimetype} (${file.originalname})`
        });
      }
    }

    // Tous les fichiers valides → procéder à la sauvegarde (dans une transaction)
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const files = [];
      for (const file of req.files) {
        // Utiliser le storage service (Cloudinary ou local)
        const info = await storage.saveFile(file, { folder: 'request_files' });

        const result = await client.query(
          `INSERT INTO request_files (request_id, original_name, stored_name, cloudinary_public_id, mime_type, file_size, uploaded_by, secure_url, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [requestId, file.originalname, info.storedName, info.cloudinaryPublicId, file.mimetype, file.size, userId, info.secureUrl || null, tenantId]
        );
        files.push({
          ...result.rows[0],
          url: storage.fileUrl(req, { ...result.rows[0], stored_name: info.storedName, cloudinary_public_id: info.cloudinaryPublicId, mime_type: file.mimetype, secure_url: info.secureUrl })
        });
      }

      await client.query('COMMIT');
      res.status(201).json({ files });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[upload] Erreur transaction:', err.message);
      res.status(500).json({ message: "Erreur lors de l'upload des fichiers" });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de l'upload des fichiers" });
  }
};

exports.getRequestFiles = async (req, res) => {
  const { requestId } = req.params;
  const tenantId = req.user.tenant_id;

  try {
    // Vérifier que la demande appartient au tenant
    const request = await tenantDb.query(tenantId, 'SELECT id FROM requests WHERE id = $1', [requestId]);
    if (request.rows.length === 0) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    const result = await db.query(
      `SELECT rf.*, u.full_name as uploaded_by_name
       FROM request_files rf
       LEFT JOIN users u ON rf.uploaded_by = u.id
       WHERE rf.request_id = $1
       ORDER BY rf.created_at DESC`,
      [requestId]
    );

    // Ajouter l'URL de téléchargement via storageService
    const files = result.rows.map(f => ({
      ...f,
      url: storage.fileUrl(req, f)
    }));

    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des fichiers' });
  }
};

exports.deleteRequestFile = async (req, res) => {
  const { fileId } = req.params;
  const tenantId = req.user.tenant_id;

  try {
    const result = await db.query('SELECT * FROM request_files WHERE id = $1', [fileId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Fichier non trouvé' });
    }

    const file = result.rows[0];

    // Vérifier que le fichier appartient à une demande du tenant
    const requestCheck = await tenantDb.query(tenantId, 'SELECT id FROM requests WHERE id = $1', [file.request_id]);
    if (requestCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Accès refusé' });
    }

    // Supprimer le fichier (Cloudinary ou local)
    await storage.deleteFile({
      storedName: file.stored_name,
      cloudinaryPublicId: file.cloudinary_public_id,
      resourceType: file.mime_type
    });

    await db.query('DELETE FROM request_files WHERE id = $1', [fileId]);
    res.json({ message: 'Fichier supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la suppression' });
  }
};

exports.uploadMessageFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier fourni' });
    }

    const tenantId = req.user.tenant_id;
    const info = await storage.saveFile(req.file, { folder: 'message_attachments' });

    res.status(201).json({
      id: null, // sera lié au message après envoi
      original_name: req.file.originalname,
      stored_name: info.storedName,
      cloudinary_public_id: info.cloudinaryPublicId,
      mime_type: req.file.mimetype,
      file_size: req.file.size,
      secure_url: info.secureUrl,
      tenant_id: tenantId,
      url: storage.fileUrl(req, { stored_name: info.storedName, cloudinary_public_id: info.cloudinaryPublicId, mime_type: req.file.mimetype, secure_url: info.secureUrl })
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de l'upload" });
  }
};

exports.linkMessageFiles = async (req, res) => {
  const { messageId } = req.params;
  const { stored_names } = req.body; // tableau de noms stockés

  try {
    const files = [];
    for (const storedName of stored_names) {
      const result = await db.query(
        `INSERT INTO message_attachments (message_id, original_name, stored_name, cloudinary_public_id, mime_type, file_size, secure_url)
         SELECT $1, original_name, stored_name, cloudinary_public_id, mime_type, file_size, secure_url
         FROM request_files WHERE stored_name = $2
         RETURNING *`,
        [messageId, storedName]
      );
      if (result.rows.length > 0) files.push(result.rows[0]);
    }
    res.json({ files });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du lien des fichiers' });
  }
};

exports.getMessageFiles = async (req, res) => {
  const { messageId } = req.params;

  try {
    const result = await db.query(
      'SELECT * FROM message_attachments WHERE message_id = $1 ORDER BY created_at ASC',
      [messageId]
    );

    const files = result.rows.map(f => ({
      ...f,
      url: storage.fileUrl(req, f)
    }));

    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des fichiers' });
  }
};
