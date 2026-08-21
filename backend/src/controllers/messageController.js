const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const { uploadUrl } = require('../helpers/publicUrl');

exports.sendMessage = async (req, res) => {
  const senderId = req.user.id;
  const tenantId = req.user.tenant_id;
  const { receiver_id, content, files } = req.body;

  // Si des fichiers sont joints, le contenu peut être vide
  const hasFiles = Array.isArray(files) && files.length > 0;
  if (!receiver_id || (!content && !hasFiles)) {
    return res.status(400).json({ message: 'Destinataire, contenu ou fichier requis' });
  }

  if (receiver_id === senderId) {
    return res.status(400).json({ message: "Vous ne pouvez pas vous envoyer un message à vous-même" });
  }

  try {
    // Vérifier que le destinataire existe dans le même tenant
    try {
      const userCheck = await db.query(
        'SELECT id FROM users WHERE id = $1 AND tenant_id = $2',
        [receiver_id, tenantId]
      );
      if (userCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Destinataire introuvable' });
      }
    } catch (err) {
      if (err.code === '42703') {
        // Fallback: pas de tenant_id
        const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [receiver_id]);
        if (userCheck.rows.length === 0) {
          return res.status(404).json({ message: 'Destinataire introuvable' });
        }
      } else {
        throw err;
      }
    }

    const result = await tenantDb.insert(
      tenantId,
      'messages',
      ['sender_id', 'receiver_id', 'content'],
      [senderId, receiver_id, (content || '').trim()],
      'id, sender_id, receiver_id, content, is_read, created_at'
    );

    const message = result.rows[0];

    // Lier les fichiers uploadés au message
    let attachments = [];
    if (hasFiles) {
      for (const f of files) {
        const attResult = await db.query(
          `INSERT INTO message_attachments (message_id, original_name, stored_name, cloudinary_public_id, mime_type, file_size, secure_url, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [message.id, f.original_name, f.stored_name, f.cloudinary_public_id || null, f.mime_type, f.file_size, f.secure_url || null, tenantId]
        );
        attachments.push(attResult.rows[0]);
      }
      // URL de téléchargement : relative en mode bureau (le port change à chaque
      // lancement), absolue en mode hébergé (frontend sur une autre origine).
      // Voir helpers/publicUrl.js.
      attachments = attachments.map(a => ({
        ...a,
        url: uploadUrl(req, a.stored_name, 'files')
      }));
    }

    const users = await db.query(
      'SELECT id, username, full_name FROM users WHERE id IN ($1, $2)',
      [senderId, receiver_id]
    );
    const userMap = {};
    users.rows.forEach(u => { userMap[u.id] = u; });

    res.status(201).json({
      ...message,
      attachments,
      sender: userMap[senderId],
      receiver: userMap[receiver_id]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de l'envoi du message" });
  }
};

exports.getConversations = async (req, res) => {
  const userId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    let result;
    try {
      result = await db.query(
        `SELECT DISTINCT ON (u.id)
           u.id, u.username, u.full_name, u.role,
           last_msg.content AS last_message,
           last_msg.created_at AS last_message_at,
           last_msg.sender_id AS last_message_sender_id,
           unread.unread_count
         FROM (
           SELECT DISTINCT
             CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END AS id
           FROM messages m
           WHERE (m.sender_id = $1 OR m.receiver_id = $1)
             AND m.tenant_id = $2
         ) AS conv_users
         JOIN users u ON u.id = conv_users.id AND u.tenant_id = $2
         LEFT JOIN LATERAL (
           SELECT content, created_at, sender_id
           FROM messages
           WHERE (sender_id = $1 AND receiver_id = u.id)
              OR (sender_id = u.id AND receiver_id = $1)
           ORDER BY created_at DESC
           LIMIT 1
         ) last_msg ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS unread_count
           FROM messages
           WHERE sender_id = u.id AND receiver_id = $1 AND is_read = FALSE
         ) unread ON true
         ORDER BY u.id, last_msg.created_at DESC NULLS LAST`,
        [userId, tenantId]
      );
    } catch (err) {
      if (err.code === '42703') {
        // Fallback: pas de tenant_id
        result = await db.query(
          `SELECT DISTINCT ON (u.id)
             u.id, u.username, u.full_name, u.role,
             last_msg.content AS last_message,
             last_msg.created_at AS last_message_at,
             last_msg.sender_id AS last_message_sender_id,
             unread.unread_count
           FROM (
             SELECT DISTINCT
               CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END AS id
             FROM messages m
             WHERE m.sender_id = $1 OR m.receiver_id = $1
           ) AS conv_users
           JOIN users u ON u.id = conv_users.id
           LEFT JOIN LATERAL (
             SELECT content, created_at, sender_id
             FROM messages
             WHERE (sender_id = $1 AND receiver_id = u.id)
                OR (sender_id = u.id AND receiver_id = $1)
             ORDER BY created_at DESC
             LIMIT 1
           ) last_msg ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS unread_count
             FROM messages
             WHERE sender_id = u.id AND receiver_id = $1 AND is_read = FALSE
           ) unread ON true
           ORDER BY u.id, last_msg.created_at DESC NULLS LAST`,
          [userId]
        );
      } else {
        throw err;
      }
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du chargement des conversations' });
  }
};

exports.getConversation = async (req, res) => {
  const userId = req.user.id;
  const tenantId = req.user.tenant_id;
  const { userId: otherUserId } = req.params;

  try {
    let result;
    try {
      result = await db.query(
        `SELECT m.*, sender.full_name AS sender_name, receiver.full_name AS receiver_name
         FROM messages m
         JOIN users sender ON m.sender_id = sender.id
         JOIN users receiver ON m.receiver_id = receiver.id
         WHERE ((m.sender_id = $1 AND m.receiver_id = $2)
             OR (m.sender_id = $2 AND m.receiver_id = $1))
           AND m.tenant_id = $3
         ORDER BY m.created_at ASC`,
        [userId, otherUserId, tenantId]
      );
    } catch (err) {
      if (err.code === '42703') {
        result = await db.query(
          `SELECT m.*, sender.full_name AS sender_name, receiver.full_name AS receiver_name
           FROM messages m
           JOIN users sender ON m.sender_id = sender.id
           JOIN users receiver ON m.receiver_id = receiver.id
           WHERE (m.sender_id = $1 AND m.receiver_id = $2)
              OR (m.sender_id = $2 AND m.receiver_id = $1)
           ORDER BY m.created_at ASC`,
          [userId, otherUserId]
        );
      } else {
        throw err;
      }
    }

    const messages = result.rows;

    // Charger les pièces jointes de tous les messages en une requête
    if (messages.length > 0) {
      try {
        const attResult = await db.query(
          'SELECT * FROM message_attachments WHERE message_id = ANY($1::int[]) ORDER BY id ASC',
          [messages.map(m => m.id)]
        );
        const attachmentsByMessage = {};
        attResult.rows.forEach(a => {
          if (!attachmentsByMessage[a.message_id]) attachmentsByMessage[a.message_id] = [];
          attachmentsByMessage[a.message_id].push({
            ...a,
            // Voir le commentaire de sendMessage plus haut.
            url: uploadUrl(req, a.stored_name, 'files')
          });
        });
        messages.forEach(m => {
          m.attachments = attachmentsByMessage[m.id] || [];
        });
      } catch (err) {
        // Table message_attachments absente → pas de pièces jointes
        console.warn('Attachments non chargés:', err.message);
        messages.forEach(m => { m.attachments = []; });
      }
    }

    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du chargement de la conversation' });
  }
};

exports.markConversationAsRead = async (req, res) => {
  const userId = req.user.id;
  const { userId: otherUserId } = req.params;

  try {
    await db.query(
      `UPDATE messages SET is_read = TRUE
       WHERE sender_id = $1 AND receiver_id = $2 AND is_read = FALSE`,
      [otherUserId, userId]
    );
    res.json({ message: 'Messages marqués comme lus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du marquage' });
  }
};

exports.getUnreadCount = async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await db.query(
      'SELECT COUNT(*)::int AS count FROM messages WHERE receiver_id = $1 AND is_read = FALSE',
      [userId]
    );
    res.json({ count: result.rows[0].count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du comptage' });
  }
};

exports.getUsers = async (req, res) => {
  const userId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    let result;
    try {
      result = await db.query(
        'SELECT id, username, full_name, role, section FROM users WHERE id != $1 AND tenant_id = $2 ORDER BY full_name ASC',
        [userId, tenantId]
      );
    } catch (err) {
      if (err.code === '42703') {
        result = await db.query(
          'SELECT id, username, full_name, role, section FROM users WHERE id != $1 ORDER BY full_name ASC',
          [userId]
        );
      } else {
        throw err;
      }
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du chargement des utilisateurs' });
  }
};
