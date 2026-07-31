const db = require('../config/db');

exports.uploadRequestFiles = async (req, res) => {
  const { requestId } = req.params;
  const userId = req.user.id;

  try {
    // Vérifier que la demande existe
    const request = await db.query('SELECT id FROM requests WHERE id = $1', [requestId]);
    if (request.rows.length === 0) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'Aucun fichier fourni' });
    }

    const files = [];
    for (const file of req.files) {
      const result = await db.query(
        `INSERT INTO request_files (request_id, original_name, stored_name, mime_type, file_size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [requestId, file.originalname, file.filename, file.mimetype, file.size, userId]
      );
      files.push(result.rows[0]);
    }

    res.status(201).json({ files });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de l'upload des fichiers" });
  }
};

exports.getRequestFiles = async (req, res) => {
  const { requestId } = req.params;

  try {
    const result = await db.query(
      `SELECT rf.*, u.full_name as uploaded_by_name
       FROM request_files rf
       LEFT JOIN users u ON rf.uploaded_by = u.id
       WHERE rf.request_id = $1
       ORDER BY rf.created_at DESC`,
      [requestId]
    );

    // Ajouter l'URL de téléchargement
    const files = result.rows.map(f => ({
      ...f,
      url: `${req.protocol}://${req.get('host')}/uploads/files/${f.stored_name}`
    }));

    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des fichiers' });
  }
};

exports.deleteRequestFile = async (req, res) => {
  const { fileId } = req.params;

  try {
    const result = await db.query('SELECT * FROM request_files WHERE id = $1', [fileId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Fichier non trouvé' });
    }

    const file = result.rows[0];
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../../uploads/files', file.stored_name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

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

    const file = req.file;
    res.status(201).json({
      id: null, // sera lié au message après envoi
      original_name: file.originalname,
      stored_name: file.filename,
      mime_type: file.mimetype,
      file_size: file.size,
      url: `${req.protocol}://${req.get('host')}/uploads/files/${file.filename}`
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
        `INSERT INTO message_attachments (message_id, original_name, stored_name, mime_type, file_size)
         SELECT $1, original_name, stored_name, mime_type, file_size
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
      url: `${req.protocol}://${req.get('host')}/uploads/files/${f.stored_name}`
    }));

    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des fichiers' });
  }
};
