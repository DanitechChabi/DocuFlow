/**
 * documentIndexService — helpers du GED partagés entre documentController
 * et requestController (indexation à la livraison).
 */
const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const storage = require('../services/storageService');
const path = require('path');
const fs = require('fs');

const FILES_DIR = path.join(__dirname, '../../uploads/files');

// Insère une ligne d'historique du cycle de vie documentaire
async function logHistory(tenantId, documentId, userId, action, previousStatus, newStatus, comment) {
  await db.query(
    `INSERT INTO document_history (document_id, user_id, action, previous_status, new_status, comment)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [documentId, userId, action, previousStatus || null, newStatus || null, comment || null]
  );
}

// Ajoute un fichier à un document (nouvelle version) et met à jour le document
async function addFileToDocument(tenantId, documentId, userId, file, { keepLocal = false } = {}) {
  const info = await storage.saveFile(file, { keepLocal });
  const ver = await db.query(
    'SELECT COALESCE(MAX(version), 0) + 1 AS v FROM document_files WHERE document_id = $1',
    [documentId]
  );
  const version = ver.rows[0].v;
  const result = await db.query(
    `INSERT INTO document_files (document_id, version, original_name, stored_name, cloudinary_public_id, mime_type, file_size, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [documentId, version, file.originalname, info.storedName, info.cloudinaryPublicId, file.mimetype, file.size, userId]
  );
  await tenantDb.query(
    tenantId,
    'UPDATE documents SET est_numerise = true, version = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [version, documentId]
  );
  return result.rows[0];
}

// Génère la référence mfile canonique : DOC-<tenant>-<id>
async function setCanonicalReference(tenantId, documentId) {
  const ref = `DOC-${tenantId}-${documentId}`;
  await tenantDb.query(tenantId, 'UPDATE documents SET reference_mfile = $1 WHERE id = $2', [ref, documentId]);
  return ref;
}

/**
 * Indexe les fichiers d'une demande dans le référentiel documentaire.
 * Crée le document à partir des métadonnées de la demande (si pas déjà liée)
 * et copie request_files → document_files. Retourne null si demande absente.
 */
async function indexRequestToDocuments(tenantId, requestId, userId) {
  const reqRes = await tenantDb.query(tenantId, 'SELECT * FROM requests WHERE id = $1', [requestId]);
  const request = reqRes.rows[0];
  if (!request) return null;

  // Déjà liée à un document ?
  if (request.document_id) {
    const existing = await tenantDb.query(tenantId, 'SELECT * FROM documents WHERE id = $1', [request.document_id]);
    if (existing.rows[0]) {
      return { document: existing.rows[0], alreadyLinked: true, filesCount: 0 };
    }
  }

  const tempRef = `DOC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const insertRes = await tenantDb.insert(
    tenantId,
    'documents',
    ['reference_mfile', 'num_dossier', 'num_acte', 'nom_entreprise', 'annee', 'type_document', 'statut', 'version', 'created_by'],
    [tempRef, request.num_dossier, request.num_acte, request.nom_entreprise, request.annee, request.type_document || null, 'disponible', 1, userId]
  );
  const doc = insertRes.rows[0];
  const reference_mfile = await setCanonicalReference(tenantId, doc.id);

  // Copier les fichiers de la demande dans le référentiel
  const filesRes = await db.query('SELECT * FROM request_files WHERE request_id = $1', [requestId]);
  let filesCount = 0;
  for (const rf of filesRes.rows) {
    const localPath = path.join(FILES_DIR, rf.stored_name);
    if (rf.stored_name && fs.existsSync(localPath)) {
      const fileObj = { path: localPath, filename: rf.stored_name, originalname: rf.original_name, mimetype: rf.mime_type, size: rf.file_size };
      // keepLocal : ne pas supprimer la pièce jointe d'origine de la demande
      await addFileToDocument(tenantId, doc.id, rf.uploaded_by || userId, fileObj, { keepLocal: true });
      filesCount++;
    } else if (rf.stored_name) {
      // Fichier perdu (disque éphémère) → on conserve la référence
      await db.query(
        `INSERT INTO document_files (document_id, version, original_name, stored_name, cloudinary_public_id, mime_type, file_size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [doc.id, 1, rf.original_name, rf.stored_name, null, rf.mime_type, rf.file_size, rf.uploaded_by || userId]
      );
      filesCount++;
    }
  }

  await tenantDb.query(tenantId, 'UPDATE requests SET document_id = $1 WHERE id = $2', [doc.id, requestId]);
  await logHistory(tenantId, doc.id, userId, 'Indexation depuis une demande', null, 'disponible');
  return { document: { ...doc, reference_mfile }, filesCount };
}

module.exports = { logHistory, addFileToDocument, setCanonicalReference, indexRequestToDocuments };
