/**
 * documentIndexService — helpers du GED partagés entre documentController
 * et requestController (indexation à la livraison).
 */
const db = require('../config/db');
const storage = require('../services/storageService');
const path = require('path');
const fs = require('fs');

const FILES_DIR = path.join(__dirname, '../../uploads/files');

// Insère une ligne d'historique du cycle de vie documentaire.
// client : optionnel — si fourni (transaction), les requêtes s'exécutent dessus.
async function logHistory(tenantId, documentId, userId, action, previousStatus, newStatus, comment, client) {
  const run = client || db;
  await run.query(
    `INSERT INTO document_history (document_id, user_id, action, previous_status, new_status, comment)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [documentId, userId, action, previousStatus || null, newStatus || null, comment || null]
  );
}

// Ajoute un fichier à un document (nouvelle version) et met à jour le document.
// client : optionnel — si fourni (transaction), les requêtes s'exécutent dessus
// et le scope tenant est explicite (WHERE tenant_id = $N).
async function addFileToDocument(tenantId, documentId, userId, file, { keepLocal = false, client } = {}) {
  const info = await storage.saveFile(file, { keepLocal });
  const run = client || db;
  const ver = await run.query(
    'SELECT COALESCE(MAX(version), 0) + 1 AS v FROM document_files WHERE document_id = $1',
    [documentId]
  );
  const version = ver.rows[0].v;
  const result = await run.query(
    `INSERT INTO document_files (document_id, version, original_name, stored_name, cloudinary_public_id, mime_type, file_size, uploaded_by, secure_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [documentId, version, file.originalname, info.storedName, info.cloudinaryPublicId, file.mimetype, file.size, userId, info.secureUrl || null]
  );
  await run.query(
    'UPDATE documents SET est_numerise = true, version = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3',
    [version, documentId, tenantId]
  );
  return result.rows[0];
}

// Génère la référence mfile canonique : DOC-<tenant>-<id>
async function setCanonicalReference(tenantId, documentId, client) {
  const ref = `DOC-${tenantId}-${documentId}`;
  const run = client || db;
  await run.query(
    'UPDATE documents SET reference_mfile = $1 WHERE id = $2 AND tenant_id = $3',
    [ref, documentId, tenantId]
  );
  return ref;
}

/**
 * Indexe les fichiers d'une demande dans le référentiel documentaire.
 * Crée le document à partir des métadonnées de la demande (si pas déjà liée)
 * et copie request_files → document_files. Retourne null si demande absente.
 *
 * Transactionnel : toute la séquence (verrou de la demande, création du document,
 * copie des fichiers, liaison request.document_id, historique) est atomique.
 * Le verrou SELECT ... FOR UPDATE sur la demande sérialise deux indexations
 * concurrentes de la même demande (évite doublons et course sur MAX(version)).
 */
async function indexRequestToDocuments(tenantId, requestId, userId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lire la demande en la verrouillant (FOR UPDATE) pour sérialiser l'indexation
    const reqRes = await client.query(
      'SELECT * FROM requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [requestId, tenantId]
    );
    const request = reqRes.rows[0];
    if (!request) {
      await client.query('ROLLBACK');
      return null;
    }

    // 2. Déjà liée à un document ?
    if (request.document_id) {
      const existing = await client.query(
        'SELECT * FROM documents WHERE id = $1 AND tenant_id = $2',
        [request.document_id, tenantId]
      );
      await client.query('COMMIT');
      if (existing.rows[0]) {
        return { document: existing.rows[0], alreadyLinked: true, filesCount: 0 };
      }
    }

    // 3. Créer le document (référence temporaire puis canonique après l'INSERT)
    const tempRef = `DOC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const insertRes = await client.query(
      `INSERT INTO documents (reference_mfile, num_dossier, num_acte, nom_entreprise, annee, type_document, statut, version, created_by, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'disponible', 1, $7, $8)
       RETURNING *`,
      [tempRef, request.num_dossier, request.num_acte, request.nom_entreprise, request.annee, request.type_document || null, userId, tenantId]
    );
    const doc = insertRes.rows[0];
    const reference_mfile = await setCanonicalReference(tenantId, doc.id, client);

    // 4. Copier les fichiers de la demande dans le référentiel
    const filesRes = await client.query('SELECT * FROM request_files WHERE request_id = $1', [requestId]);
    let filesCount = 0;
    for (const rf of filesRes.rows) {
      // Fichier stocké sur Cloudinary → réutiliser la référence telle quelle (pas de copie physique)
      if (rf.cloudinary_public_id) {
        await client.query(
          `INSERT INTO document_files (document_id, version, original_name, stored_name, cloudinary_public_id, mime_type, file_size, uploaded_by, secure_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [doc.id, 1, rf.original_name, rf.stored_name, rf.cloudinary_public_id, rf.mime_type, rf.file_size, rf.uploaded_by || userId, rf.secure_url || null]
        );
        filesCount++;
        continue;
      }

      // Fichier présent sur le disque local → copier (avec version + upload Cloudinary éventuel)
      const localPath = path.join(FILES_DIR, rf.stored_name);
      if (rf.stored_name && fs.existsSync(localPath)) {
        const fileObj = { path: localPath, filename: rf.stored_name, originalname: rf.original_name, mimetype: rf.mime_type, size: rf.file_size };
        // keepLocal : ne pas supprimer la pièce jointe d'origine de la demande
        await addFileToDocument(tenantId, doc.id, rf.uploaded_by || userId, fileObj, { keepLocal: true, client });
        filesCount++;
      } else if (rf.stored_name) {
        // Fichier perdu (disque éphémère) → on conserve la référence
        await client.query(
          `INSERT INTO document_files (document_id, version, original_name, stored_name, cloudinary_public_id, mime_type, file_size, uploaded_by, secure_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [doc.id, 1, rf.original_name, rf.stored_name, rf.cloudinary_public_id || null, rf.mime_type, rf.file_size, rf.uploaded_by || userId, rf.secure_url || null]
        );
        filesCount++;
      }
    }

    // 5. Lier la demande au document + historique
    await client.query(
      'UPDATE requests SET document_id = $1 WHERE id = $2 AND tenant_id = $3',
      [doc.id, requestId, tenantId]
    );
    await logHistory(tenantId, doc.id, userId, 'Indexation depuis une demande', null, 'disponible', null, client);

    await client.query('COMMIT');
    return { document: { ...doc, reference_mfile }, filesCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { logHistory, addFileToDocument, setCanonicalReference, indexRequestToDocuments };
