const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const storage = require('../services/storageService');
const { logHistory, addFileToDocument, setCanonicalReference, indexRequestToDocuments } = require('../services/documentIndexService');

const ADMIN_ROLES = ['superadmin', 'admin', 'archiviste'];

function parseTags(tags) {
  if (Array.isArray(tags)) return tags.filter((t) => typeof t === 'string' && t.trim());
  if (typeof tags === 'string' && tags.trim()) {
    const trimmed = tags.trim();
    // Multipart : le frontend envoie les tags en chaîne JSON (ex. ["a","b"])
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) return arr.filter((t) => typeof t === 'string' && t.trim());
      } catch { /* tombe sur le découpage par virgules ci-dessous */ }
    }
    return trimmed.split(',').map((t) => t.trim()).filter(Boolean);
  }
  return null;
}

/* ===== Documents ===== */

exports.createDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;
  const {
    nom_entreprise, num_dossier, num_acte, annee, type_document, description,
    tags, auteur, date_document, dossier_id, statut,
  } = req.body;

  if (!nom_entreprise || !num_dossier || !num_acte) {
    return res.status(400).json({ message: 'Entreprise, n° dossier et n° acte sont requis' });
  }

  try {
    const tempRef = `DOC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const result = await tenantDb.insert(
      tenantId,
      'documents',
      ['reference_mfile', 'num_dossier', 'num_acte', 'nom_entreprise', 'annee', 'type_document', 'description', 'tags', 'auteur', 'date_document', 'statut', 'version', 'dossier_id', 'created_by'],
      [tempRef, num_dossier, num_acte, nom_entreprise, annee || new Date().getFullYear(), type_document || null, description || null, parseTags(tags), auteur || null, date_document || null, statut || 'disponible', 1, dossier_id || null, userId]
    );
    const doc = result.rows[0];
    const reference_mfile = await setCanonicalReference(tenantId, doc.id);

    if (req.files && req.files.length) {
      for (const file of req.files) {
        await addFileToDocument(tenantId, doc.id, userId, file);
      }
    }

    await logHistory(tenantId, doc.id, userId, 'Création du document', null, doc.statut || 'disponible');
    res.status(201).json({ ...doc, reference_mfile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la création du document' });
  }
};

exports.listDocuments = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { q, type_document, annee, statut, dossier_id, page = 1, page_size = 20 } = req.query;

  const conds = ['d.tenant_id = $1'];
  const vals = [tenantId];

  if (q) {
    vals.push(`%${q}%`);
    const i = vals.length;
    conds.push(`(d.nom_entreprise ILIKE $${i} OR d.num_dossier ILIKE $${i} OR d.num_acte ILIKE $${i} OR d.reference_mfile ILIKE $${i} OR d.description ILIKE $${i} OR d.type_document ILIKE $${i})`);
  }
  if (type_document) { vals.push(type_document); conds.push(`d.type_document = $${vals.length}`); }
  if (annee) { vals.push(Number(annee)); conds.push(`d.annee = $${vals.length}`); }
  if (statut) { vals.push(statut); conds.push(`d.statut = $${vals.length}`); }
  if (dossier_id) { vals.push(Number(dossier_id)); conds.push(`d.dossier_id = $${vals.length}`); }

  const where = conds.join(' AND ');
  const limit = Math.min(Math.max(Number(page_size) || 20, 1), 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  try {
    const countRes = await db.query(`SELECT COUNT(*) AS total FROM documents d WHERE ${where}`, vals);
    const total = parseInt(countRes.rows[0].total, 10);

    const listRes = await db.query(
      `SELECT d.*, f.name AS dossier_name,
         (SELECT COUNT(*) FROM document_files df WHERE df.document_id = d.id) AS files_count
       FROM documents d
       LEFT JOIN document_folders f ON f.id = d.dossier_id
       WHERE ${where}
       ORDER BY d.created_at DESC
       LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
      [...vals, limit, offset]
    );

    res.json({
      documents: listRes.rows,
      pagination: { page: Number(page), page_size: limit, total, total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la recherche des documents' });
  }
};

exports.getDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  try {
    // db.query direct : tenant_id est ambigu dans un JOIN (d, f, u en ont un)
    const docRes = await db.query(
      `SELECT d.*, f.name AS dossier_name, u.full_name AS created_by_name
       FROM documents d
       LEFT JOIN document_folders f ON f.id = d.dossier_id
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [id, tenantId]
    );
    const doc = docRes.rows[0];
    if (!doc) return res.status(404).json({ message: 'Document non trouvé' });

    const filesRes = await db.query(
      `SELECT df.*, u.full_name AS uploaded_by_name
       FROM document_files df
       LEFT JOIN users u ON u.id = df.uploaded_by
       WHERE df.document_id = $1
       ORDER BY df.version DESC`,
      [id]
    );
    const files = filesRes.rows.map((f) => ({ ...f, url: storage.fileUrl(req, f.stored_name, f.cloudinary_public_id) }));

    const histRes = await db.query(
      `SELECT h.*, u.full_name AS user_name
       FROM document_history h
       LEFT JOIN users u ON u.id = h.user_id
       WHERE h.document_id = $1
       ORDER BY h.created_at DESC`,
      [id]
    );

    res.json({ ...doc, files, history: histRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du chargement du document' });
  }
};

exports.updateDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const allowed = ['nom_entreprise', 'num_dossier', 'num_acte', 'annee', 'type_document', 'description', 'auteur', 'date_document', 'dossier_id'];
  const fields = [];
  const vals = [];
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) {
      vals.push(v);
      fields.push(`${k} = $${vals.length}`);
    }
  }
  if (req.body.tags !== undefined) {
    vals.push(parseTags(req.body.tags));
    fields.push(`tags = $${vals.length}`);
  }
  if (!fields.length) return res.status(400).json({ message: 'Aucun champ à modifier' });

  try {
    vals.push(id, tenantId);
    const sql = `UPDATE documents SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length}`;
    const result = await db.query(sql, vals);
    if (!result.rowCount) return res.status(404).json({ message: 'Document non trouvé' });
    await logHistory(tenantId, id, req.user.id, 'Modification du document', null, null);
    res.json({ message: 'Document mis à jour' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de la mise à jour du document" });
  }
};

exports.deleteDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  try {
    const check = await tenantDb.query(tenantId, 'SELECT id FROM documents WHERE id = $1', [id]);
    if (!check.rows[0]) return res.status(404).json({ message: 'Document non trouvé' });

    const filesRes = await db.query('SELECT * FROM document_files WHERE document_id = $1', [id]);
    for (const f of filesRes.rows) {
      await storage.deleteFile({ storedName: f.stored_name, cloudinaryPublicId: f.cloudinary_public_id });
    }
    await tenantDb.query(tenantId, 'UPDATE requests SET document_id = NULL WHERE document_id = $1', [id]);
    await tenantDb.query(tenantId, 'DELETE FROM documents WHERE id = $1', [id]);
    res.json({ message: 'Document supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la suppression du document' });
  }
};

/* ===== Fichiers & versions ===== */

exports.addFiles = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  try {
    const docRes = await tenantDb.query(tenantId, 'SELECT id FROM documents WHERE id = $1', [id]);
    if (!docRes.rows[0]) return res.status(404).json({ message: 'Document non trouvé' });
    if (!req.files || !req.files.length) return res.status(400).json({ message: 'Aucun fichier fourni' });

    const added = [];
    for (const file of req.files) {
      added.push(await addFileToDocument(tenantId, id, req.user.id, file));
    }
    await logHistory(tenantId, id, req.user.id, "Ajout d'une version", null, null);
    res.status(201).json({ files: added });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de l\'ajout des fichiers' });
  }
};

exports.deleteFile = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id, fileId } = req.params;
  try {
    const docRes = await tenantDb.query(tenantId, 'SELECT id FROM documents WHERE id = $1', [id]);
    if (!docRes.rows[0]) return res.status(404).json({ message: 'Document non trouvé' });

    const fileRes = await db.query('SELECT * FROM document_files WHERE id = $1 AND document_id = $2', [fileId, id]);
    const fileRow = fileRes.rows[0];
    if (!fileRow) return res.status(404).json({ message: 'Fichier non trouvé' });

    await storage.deleteFile({ storedName: fileRow.stored_name, cloudinaryPublicId: fileRow.cloudinary_public_id });
    await db.query('DELETE FROM document_files WHERE id = $1', [fileId]);

    const maxRes = await db.query('SELECT COALESCE(MAX(version), 1) AS v FROM document_files WHERE document_id = $1', [id]);
    await tenantDb.query(tenantId, 'UPDATE documents SET version = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [maxRes.rows[0].v, id]);
    await logHistory(tenantId, id, req.user.id, 'Suppression d\'un fichier', null, null);
    res.json({ message: 'Fichier supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la suppression du fichier' });
  }
};

/* ===== Cycle de vie ===== */

exports.setStatus = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { statut, comment } = req.body;
  const ALLOWED = ['disponible', 'prêt', 'archivé'];
  if (!ALLOWED.includes(statut)) return res.status(400).json({ message: 'Statut invalide' });

  try {
    const docRes = await tenantDb.query(tenantId, 'SELECT * FROM documents WHERE id = $1', [id]);
    const doc = docRes.rows[0];
    if (!doc) return res.status(404).json({ message: 'Document non trouvé' });

    await tenantDb.query(tenantId, 'UPDATE documents SET statut = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [statut, id]);
    await logHistory(tenantId, id, req.user.id, 'Changement de statut', doc.statut, statut, comment);
    res.json({ message: 'Statut mis à jour', statut });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du changement de statut' });
  }
};

/* ===== Indexation depuis une demande ===== */

exports.indexFromRequest = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { requestId } = req.params;
  try {
    const result = await indexRequestToDocuments(tenantId, requestId, req.user.id);
    if (!result) return res.status(404).json({ message: 'Demande non trouvée' });
    if (result.alreadyLinked) {
      return res.json({ document: result.document, alreadyLinked: true });
    }
    res.status(201).json({ document: result.document, filesCount: result.filesCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de l\'indexation' });
  }
};

/* ===== Dossiers ===== */

exports.listFolders = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    const result = await tenantDb.query(
      tenantId,
      `SELECT f.*, (SELECT COUNT(*) FROM documents d WHERE d.dossier_id = f.id) AS doc_count
       FROM document_folders f
       ORDER BY f.name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du chargement des dossiers' });
  }
};

exports.createFolder = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { name, parent_id } = req.body;
  if (!name) return res.status(400).json({ message: 'Nom du dossier requis' });
  try {
    const result = await tenantDb.insert(
      tenantId,
      'document_folders',
      ['name', 'parent_id', 'created_by'],
      [name, parent_id || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la création du dossier' });
  }
};

exports.renameFolder = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { name } = req.body;
  try {
    const result = await tenantDb.query(tenantId, 'UPDATE document_folders SET name = $1 WHERE id = $2', [name, id]);
    if (!result.rowCount) return res.status(404).json({ message: 'Dossier non trouvé' });
    res.json({ message: 'Dossier renommé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du renommage du dossier' });
  }
};

exports.deleteFolder = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  try {
    await tenantDb.query(tenantId, 'DELETE FROM document_folders WHERE id = $1', [id]);
    res.json({ message: 'Dossier supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la suppression du dossier' });
  }
};
