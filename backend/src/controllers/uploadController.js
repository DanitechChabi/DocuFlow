const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const storage = require('../services/storageService');
const path = require('path');
const fs = require('fs');

const { FILES_DIR } = require('../config/paths');

// Rôles autorisés à agir sur les demandes d'autrui : le personnel de traitement.
// Un demandeur ne touche que SES demandes — sinon, dans la même organisation,
// n'importe quel compte pouvait lire, verser ou supprimer les pièces jointes
// d'une demande qui ne lui appartient pas.
const STAFF_ROLES = ['archiviste', 'admin', 'superadmin'];

/**
 * La demande appartient-elle au tenant ET l'appelant a-t-il le droit d'y
 * toucher (propriétaire ou personnel) ?
 *
 * @returns {Promise<{ok: boolean, statut: number, message?: string}>}
 */
async function verifierAccesDemande(tenantId, requestId, user) {
  const { rows } = await tenantDb.query(
    tenantId,
    'SELECT id, id_user FROM requests WHERE id = $1',
    [requestId]
  );
  if (rows.length === 0) {
    return { ok: false, statut: 404, message: 'Demande non trouvée' };
  }
  if (rows[0].id_user !== user.id && !STAFF_ROLES.includes(user.role)) {
    return { ok: false, statut: 403, message: 'Accès refusé' };
  }
  return { ok: true };
}

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
    // Vérifier que la demande appartient au tenant ET que l'appelant peut y
    // verser des fichiers (propriétaire ou personnel).
    const acces = await verifierAccesDemande(tenantId, requestId, req.user);
    if (!acces.ok) {
      return res.status(acces.statut).json({ message: acces.message });
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
    // Vérifier que la demande appartient au tenant ET que l'appelant peut la
    // consulter (propriétaire ou personnel). Auparavant, tout utilisateur du
    // tenant listait les pièces jointes de n'importe quelle demande — y compris
    // un simple demandeur sur les demandes de ses collègues.
    const acces = await verifierAccesDemande(tenantId, requestId, req.user);
    if (!acces.ok) {
      return res.status(acces.statut).json({ message: acces.message });
    }

    const result = await db.query(
      `SELECT rf.*, u.full_name as uploaded_by_name
       FROM request_files rf
       LEFT JOIN users u ON rf.uploaded_by = u.id
       WHERE rf.request_id = $1
         AND rf.tenant_id = $2
       ORDER BY rf.created_at DESC`,
      [requestId, tenantId]
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
    // Le contrôle d'accès (tenant + propriétaire-ou-personnel) porte sur la
    // DEMANDE parente : c'est elle qui définit le droit, le fichier n'est que
    // sa pièce jointe.
    const result = await db.query(
      `SELECT rf.*, r.id_user
         FROM request_files rf
         JOIN requests r ON r.id = rf.request_id
        WHERE rf.id = $1 AND rf.tenant_id = $2`,
      [fileId, tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Fichier non trouvé' });
    }

    const file = result.rows[0];
    if (file.id_user !== req.user.id && !STAFF_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès refusé' });
    }

    // LA LIGNE EN BASE D'ABORD, LE BINAIRE APRÈS — l'ordre inverse de la
    // convention du reste du code (voir deleteDocument dans
    // documentController). L'ancienne version détruisait le binaire PUIS la
    // ligne : si le DELETE échouait (base indisponible), la ligne survivait en
    // pointant vers un fichier physiquement détruit — téléchargement cassé à
    // jamais. Ici, un échec du DELETE laisse le fichier intact et l'opération
    // rejouable.
    await db.query('DELETE FROM request_files WHERE id = $1', [fileId]);

    // Garde de référence croisée : à la livraison d'une demande, les pièces
    // jointes sont indexées dans la GED en RÉUTILISANT le même binaire
    // (documentIndexService) — document_files peut donc pointer LE MÊME
    // stored_name. Détruire l'asset ici priverait le document archivé de son
    // fichier. Le binaire ne disparaît que si plus aucune des deux tables ne le
    // référence.
    const encoreReference = await db.query(
      'SELECT 1 FROM document_files WHERE stored_name = $1 LIMIT 1',
      [file.stored_name]
    );
    if (encoreReference.rows.length === 0) {
      await storage.deleteFile({
        storedName: file.stored_name,
        cloudinaryPublicId: file.cloudinary_public_id,
        resourceType: file.mime_type
      });
    } else {
      console.warn(
        `[upload] Binaire ${file.stored_name} conservé : encore référencé par un document GED.`
      );
    }

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
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;

  try {
    // LE MESSAGE DOIT ÊTRE À L'APPELANT. L'ancienne version insérait sans
    // aucune vérification : n'importe quel utilisateur authentifié pouvait
    // lier des pièces à N'IMPORTE QUEL message — du sien comme de la
    // conversation privée de deux autres personnes, de n'importe quel tenant.
    // On exige l'expéditeur du message (on attache des pièces à ce que L'ON
    // envoie) dans le tenant de l'appelant.
    const message = await db.query(
      'SELECT id FROM messages WHERE id = $1 AND tenant_id = $2 AND sender_id = $3',
      [messageId, tenantId, userId]
    );
    if (message.rows.length === 0) {
      return res.status(403).json({ message: 'Accès refusé' });
    }

    const files = [];
    for (const storedName of stored_names) {
      // La pièce source vient de request_files : elle doit appartenir au même
      // tenant, sinon l'appelant rattache à son message le fichier d'une autre
      // organisation (IDOR cross-tenant).
      const result = await db.query(
        `INSERT INTO message_attachments (message_id, original_name, stored_name, cloudinary_public_id, mime_type, file_size, secure_url, tenant_id)
         SELECT $1, rf.original_name, rf.stored_name, rf.cloudinary_public_id, rf.mime_type, rf.file_size, rf.secure_url, rf.tenant_id
         FROM request_files rf
         WHERE rf.stored_name = $2 AND rf.tenant_id = $3
         RETURNING *`,
        [messageId, storedName, tenantId]
      );
      if (result.rows.length > 0) files.push(result.rows[0]);
    }
    res.json({ files });
  } catch (err) {
    // 42703 : message_attachments sans colonne tenant_id (schéma antérieur à
    // la migration 002 étendue) — repli sans le filtre, l'accès au message
    // reste vérifié ci-dessus, qui est l'essentiel.
    if (err.code === '42703') {
      try {
        const files = [];
        for (const storedName of stored_names) {
          const result = await db.query(
            `INSERT INTO message_attachments (message_id, original_name, stored_name, cloudinary_public_id, mime_type, file_size, secure_url)
             SELECT $1, rf.original_name, rf.stored_name, rf.cloudinary_public_id, rf.mime_type, rf.file_size, rf.secure_url
             FROM request_files rf
             WHERE rf.stored_name = $2 AND rf.tenant_id = $3
             RETURNING *`,
            [messageId, storedName, tenantId]
          );
          if (result.rows.length > 0) files.push(result.rows[0]);
        }
        return res.json({ files });
      } catch (err2) {
        console.error(err2);
        return res.status(500).json({ message: 'Erreur lors du lien des fichiers' });
      }
    }
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du lien des fichiers' });
  }
};

exports.getMessageFiles = async (req, res) => {
  const { messageId } = req.params;
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;

  try {
    // L'appelant doit PARTICIPER à la conversation et dans son tenant. C'est le
    // contrôle qu'applique déjà getConversation (messageController) ; cette
    // route — qui livre les mêmes pièces jointes, secure_url comprise — ne
    // devait pas en être exempte : un utilisateur authentifié pouvait énumérer
    // les pièces jointes de n'importe quel message, de n'importe quel tenant.
    const message = await db.query(
      'SELECT id FROM messages WHERE id = $1 AND tenant_id = $2 AND (sender_id = $3 OR receiver_id = $3)',
      [messageId, tenantId, userId]
    );
    if (message.rows.length === 0) {
      return res.status(403).json({ message: 'Accès refusé' });
    }

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
