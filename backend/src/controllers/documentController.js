const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const storage = require('../services/storageService');
const { logHistory, addFileToDocument, setCanonicalReference, indexRequestToDocuments } = require('../services/documentIndexService');
const { extractText, extractAutoTags } = require('../services/textExtractionService');
const metadataService = require('../services/metadataService');
const documentAuditService = require('../services/documentAuditService');
const relationService = require('../services/relationService');
const retentionService = require('../services/retentionService');

const ADMIN_ROLES = ['superadmin', 'admin', 'archiviste'];

// Libellé du groupe rassemblant les documents dont la métadonnée de
// regroupement est NULL, dans les vues dynamiques. Ce n'est PAS une valeur
// stockable : c'est une étiquette d'affichage produite par un COALESCE. Elle est
// exportée pour que `updateDocument` puisse refuser de l'écrire en base — sans
// quoi un glisser-déposer vers ce groupe transformerait « absence de valeur » en
// la chaîne littérale « Non classé », que plus aucun COALESCE ne rattraperait.
const UNCLASSIFIED_GROUP = 'Non classé';

// Listes blanches des vues dynamiques, partagées par `createDynamicView` (qui
// refuse d'enregistrer hors liste) et `getDynamicViewData` (qui calcule). Deux
// copies divergentes laisseraient enregistrer une vue dont le regroupement
// serait ensuite silencieusement ramené à `type_document`, ou dont les filtres
// seraient ignorés au calcul : la vue mentirait sur son propre contenu.
//
// Le nom du champ de regroupement est concaténé dans le SQL : il ne peut donc
// venir que de cette liste, jamais de la requête telle quelle. Les valeurs de
// filtre, elles, sont toujours passées en paramètres liés.
const ALLOWED_GROUP = ['type_document', 'annee', 'statut', 'nom_entreprise', 'auteur'];

// Filtres reconnus dans `filter_json`, avec leur mode de comparaison.
const ALLOWED_FILTERS = {
  statut: 'exact',
  type_document: 'exact',
  annee: 'int',
  dossier_id: 'int',
  nom_entreprise: 'ilike',
  auteur: 'ilike',
};

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

/* ---------- TAG SANITISATION SÉCURISÉE ---------- */
// Échappe les entités HTML avant insertion dans un gabarit d'e-mail.
// L'implémentation vit dans helpers/htmlEscape : mailService en a besoin aussi,
// et deux copies divergent tôt ou tard — celle-ci était déjà correcte, mais
// les gabarits de mailService n'échappaient rien du tout.
const { escapeHtml } = require('../helpers/htmlEscape');

function sanitizeTags(rawTags) {
  let tags;

  try {
    if (typeof rawTags === 'string') {
      if (rawTags.trim().startsWith('[')) {
        tags = JSON.parse(rawTags);
      } else {
        tags = rawTags.split(',').map(t => t.trim()).filter(t => t);
      }
    } else if (Array.isArray(rawTags)) {
      tags = rawTags;
    }
  } catch (_) {
    tags = rawTags ? rawTags.split(',').map(t => t.trim()).filter(t => t) : [];
  }

  // Regex permissive pour tags français : lettres (y compris accents), chiffres, espaces, _ - . '
  // Rejette uniquement les caractères dangereux pour XSS/injection : < > " ' & { } [ ] ( ) ;
  const safeTagRegex = /^[^<>"'&{}()\[\];]*$/;
  const sanitized = [];

  for (const t of tags) {
    if (typeof t !== 'string' || !t || !safeTagRegex.test(t)) {
      return null; // whole set rejected on first invalid entry
    }
    // Escape HTML entities to prevent XSS
    const safe = escapeHtml(t);
    sanitized.push(safe);
  }
  return sanitized;
}

/* ===== Documents ===== */

exports.createDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;
  const {
    nom_entreprise, num_dossier, num_acte, annee, type_document, description,
    tags, auteur, date_document, dossier_id, statut,
  } = req.body;

  // Sanitize tags early
  const safeTags = sanitizeTags(tags);
  if (tags && safeTags === null) {
    return res.status(400).json({ message: 'Format de tags invalide (caractères interdits détectés)' });
  }
  // Use sanitized tags for DB operations
  const dbTags = safeTags || [];

  if (!nom_entreprise || !num_dossier || !num_acte) {
    return res.status(400).json({ message: 'Entreprise, n° dossier et n° acte sont requis' });
  }

  try {
    const tempRef = `DOC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const result = await tenantDb.insert(
      tenantId,
      'documents',
      ['reference_mfile', 'num_dossier', 'num_acte', 'nom_entreprise', 'annee', 'type_document', 'description', 'tags', 'auteur', 'date_document', 'statut', 'version', 'dossier_id', 'created_by'],
      [tempRef, num_dossier, num_acte, nom_entreprise, annee || new Date().getFullYear(), type_document || null, description || null, dbTags, auteur || null, date_document || null, statut || 'disponible', 1, dossier_id || null, userId]
    );
    const doc = result.rows[0];
    const reference_mfile = await setCanonicalReference(tenantId, doc.id);

    // Extraction de texte + auto-tagging
    let allText = '';
    if (req.files && req.files.length) {
      for (const file of req.files) {
        await addFileToDocument(tenantId, doc.id, userId, file);
        const text = await extractText(file.path, file.mimetype);
        if (text) allText += ' ' + text;
      }
    }

    // Auto-tagging basé sur le contenu extrait
    if (allText.trim()) {
      const existingTags = dbTags; // Use already sanitized tags to avoid divergence
      const autoTags = extractAutoTags(allText, existingTags);
      // Sanitize auto-tags too (they might contain special chars from content)
      const sanitizedAutoTags = autoTags.map(t => sanitizeTags(t)).filter(Boolean).flat();
      if (sanitizedAutoTags.length > existingTags.length) {
        await tenantDb.update(
          tenantId, 'documents',
          ['tags'], [sanitizedAutoTags],
          'id', doc.id
        );
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
  const { q, type_document, annee, statut, dossier_id, tag, auteur, page = 1, page_size = 20 } = req.query;

  const conds = ['d.tenant_id = $1'];
  const vals = [tenantId];

  if (q) {
    vals.push(`%${q}%`);
    const i = vals.length;
    conds.push(`(d.nom_entreprise ILIKE $${i} OR d.num_dossier ILIKE $${i} OR d.num_acte ILIKE $${i} OR d.reference_mfile ILIKE $${i} OR d.description ILIKE $${i} OR d.type_document ILIKE $${i} OR d.auteur ILIKE $${i} OR EXISTS (SELECT 1 FROM unnest(d.tags) t(tag) WHERE t.tag ILIKE $${i}))`);
  }
  if (type_document) { vals.push(type_document); conds.push(`d.type_document = $${vals.length}`); }
  if (annee) { vals.push(Number(annee)); conds.push(`d.annee = $${vals.length}`); }
  if (statut) { vals.push(statut); conds.push(`d.statut = $${vals.length}`); }
  if (dossier_id) { vals.push(Number(dossier_id)); conds.push(`d.dossier_id = $${vals.length}`); }
  if (tag) {
    vals.push(tag);
    conds.push(`$${vals.length} = ANY(d.tags)`);
  }
  if (auteur) {
    vals.push(`%${auteur}%`);
    conds.push(`d.auteur ILIKE $${vals.length}`);
  }

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
       LEFT JOIN document_folders f ON f.id = d.dossier_id AND f.tenant_id = d.tenant_id
       WHERE ${where}
       ORDER BY d.created_at DESC
       LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
      [...vals, limit, offset]
    );

    // Facettes pour les filtres latéraux
    let facets = {};
    try {
      const facRes = await db.query(
        `SELECT type_document, statut, tags, annee FROM documents d WHERE d.tenant_id = $1`,
        [tenantId]
      );
      const types = new Set();
      const stats = new Set();
      const allTags = new Set();
      const years = new Set();
      facRes.rows.forEach(r => {
        if (r.type_document) types.add(r.type_document);
        if (r.statut) stats.add(r.statut);
        if (r.tags) r.tags.forEach(t => allTags.add(t));
        if (r.annee) years.add(r.annee);
      });
      facets = {
        type_document: Array.from(types),
        statut: Array.from(stats),
        tags: Array.from(allTags),
        annees: Array.from(years).sort((a, b) => b - a),
      };
    } catch { /* silencieux */ }

    res.json({
      documents: listRes.rows,
      pagination: { page: Number(page), page_size: limit, total, total_pages: Math.ceil(total / limit) },
      facets,
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
    // Utiliser des JOINs qualifiés pour éviter l'ambiguïté tenant_id
    const docRes = await db.query(
      `SELECT d.*, f.name AS dossier_name, u.full_name AS created_by_name
       FROM documents d
       LEFT JOIN document_folders f ON f.id = d.dossier_id AND f.tenant_id = d.tenant_id
       LEFT JOIN users u ON u.id = d.created_by AND u.tenant_id = d.tenant_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [id, tenantId]
    );
    const doc = docRes.rows[0];
    if (!doc) return res.status(404).json({ message: 'Document non trouvé' });

    // document_files / document_history n'ont pas de colonne tenant_id :
    // le périmètre multi-tenant passe par le document parent (documents.tenant_id)
    const filesRes = await db.query(
      `SELECT df.*, u.full_name AS uploaded_by_name
       FROM document_files df
       LEFT JOIN documents doc ON doc.id = df.document_id AND doc.tenant_id = $2
       LEFT JOIN users u ON u.id = df.uploaded_by AND u.tenant_id = doc.tenant_id
       WHERE df.document_id = $1
       ORDER BY df.version DESC`,
      [id, tenantId]
    );
    const files = filesRes.rows.map((f) => ({ ...f, url: storage.fileUrl(req, f) }));

    const histRes = await db.query(
      `SELECT h.*, u.full_name AS user_name
       FROM document_history h
       LEFT JOIN documents doc ON doc.id = h.document_id AND doc.tenant_id = $2
       LEFT JOIN users u ON u.id = h.user_id AND u.tenant_id = doc.tenant_id
       WHERE h.document_id = $1
       ORDER BY h.created_at DESC`,
      [id, tenantId]
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
  // Colonnes numériques : une chaîne vide y provoquerait une erreur 22P02
  // (invalid input syntax for type integer) et donc un 500 opaque.
  const numericFields = new Set(['annee', 'dossier_id']);
  const fields = [];
  const vals = [];
  for (const [k, v] of Object.entries(req.body)) {
    if (!allowed.includes(k)) continue;
    let value = v;
    // « Non classé » est une étiquette d'affichage des vues dynamiques, pas une
    // valeur : la recevoir signifie « retirer la valeur ». De même pour une
    // chaîne vide sur une colonne numérique.
    if (typeof value === 'string' && value.trim() === UNCLASSIFIED_GROUP) {
      value = null;
    } else if (numericFields.has(k)) {
      if (value === '' || value === null || value === undefined) {
        value = null;
      } else if (Number.isFinite(Number(value))) {
        value = Number(value);
      } else {
        return res.status(400).json({ message: `Valeur numérique invalide pour ${k}` });
      }
    }
    vals.push(value);
    fields.push(`${k} = $${vals.length}`);
  }
  if (req.body.tags !== undefined) {
    const safeTags = sanitizeTags(req.body.tags);
    if (safeTags === null) {
      return res.status(400).json({ message: 'Format de tags invalide (caractères interdits détectés)' });
    }
    vals.push(safeTags);
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
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Vérifier que le document existe et appartient au tenant
    const check = await client.query('SELECT id FROM documents WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (!check.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Document non trouvé' });
    }

    // Récupérer les fichiers pour suppression ultérieure
    const filesRes = await client.query('SELECT * FROM document_files WHERE document_id = $1', [id]);

    // --- APPROCHE ORIGINALE : DB d'abord, stockage après ---
    // 1. Supprimer les références dans requests
    await client.query('UPDATE requests SET document_id = NULL WHERE document_id = $1 AND tenant_id = $2', [id, tenantId]);

    // 2. Supprimer les fichiers de la base
    await client.query('DELETE FROM document_files WHERE document_id = $1', [id]);

    // 3. Supprimer l'historique
    await client.query('DELETE FROM document_history WHERE document_id = $1', [id]);

    // 4. Supprimer le document
    await client.query('DELETE FROM documents WHERE id = $1 AND tenant_id = $2', [id, tenantId]);

    // 5. Commit seulement après toutes les opérations DB réussies
    await client.query('COMMIT');

    // 6. Supprimer les fichiers du stockage APRÈS le commit (en cas d'échec, rollback = pas de suppression)
    // Si le stockage échoue ici, la DB est déjà supprimée → pas d'orphelins
    const deleteErrors = [];
    for (const f of filesRes.rows) {
      try {
        await storage.deleteFile({ storedName: f.stored_name, cloudinaryPublicId: f.cloudinary_public_id, resourceType: f.mime_type });
      } catch (storageErr) {
        deleteErrors.push({ file: f.stored_name, error: storageErr.message });
      }
    }

    if (deleteErrors.length > 0) {
      // Storage failures are non-fatal for DB deletion but should be logged
      console.warn('[document] Certains fichiers n\'ont pas pu être supprimés du stockage:', deleteErrors);
    }

    res.json({ message: 'Document supprimé' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la suppression du document' });
  } finally {
    client.release();
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
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const docRes = await client.query('SELECT id FROM documents WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    if (!docRes.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Document non trouvé' });
    }

    const fileRes = await client.query('SELECT * FROM document_files WHERE id = $1 AND document_id = $2', [fileId, id]);
    const fileRow = fileRes.rows[0];
    if (!fileRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Fichier non trouvé' });
    }

    // --- APPROCHE ORIGINALE : DB d'abord, stockage après ---
    // 1. Supprimer le fichier de la base
    await client.query('DELETE FROM document_files WHERE id = $1', [fileId]);

    // 2. Mettre à jour la version du document
    const maxRes = await client.query('SELECT COALESCE(MAX(version), 1) AS v FROM document_files WHERE document_id = $1', [id]);
    await client.query('UPDATE documents SET version = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3', [maxRes.rows[0].v, id, tenantId]);

    // 3. Logger l'historique (dans la transaction)
    await logHistory(tenantId, id, req.user.id, 'Suppression d\'un fichier', null, null);

    // 4. Commit après toutes les opérations DB réussies
    await client.query('COMMIT');

    // 5. Supprimer le fichier du stockage APRÈS commit (pas d'orphelins si échec)
    try {
      await storage.deleteFile({ storedName: fileRow.stored_name, cloudinaryPublicId: fileRow.cloudinary_public_id, resourceType: fileRow.mime_type });
    } catch (storageErr) {
      console.warn('[document] Échec suppression stockage (DB déjà supprimée):', storageErr.message);
    }

    res.json({ message: 'Fichier supprimé' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la suppression du fichier' });
  } finally {
    client.release();
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
    // Utiliser db.query avec jointure explicite pour éviter les problèmes de multi-tenant
    // Filtrer documents par tenant_id dans la sous-requête
    const result = await db.query(
      `SELECT f.*,
              (SELECT COUNT(*) FROM documents d WHERE d.dossier_id = f.id AND d.tenant_id = $1) AS doc_count
       FROM document_folders f
       WHERE f.tenant_id = $1
       ORDER BY f.name ASC`,
      [tenantId]
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
  // Sans cette validation, un nom vide était accepté : le dossier restait dans
  // la base mais devenait invisible dans toute liste triée par nom.
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: 'Nom du dossier requis' });
  }
  try {
    const result = await tenantDb.query(
      tenantId,
      'UPDATE document_folders SET name = $1 WHERE id = $2',
      [String(name).trim(), id]
    );
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
    // `documents.dossier_id` est en ON DELETE SET NULL : la suppression déclasse
    // les documents au lieu de les détruire. On renvoie leur nombre pour que
    // l'interface puisse le dire, et un 404 franc si le dossier n'existe pas —
    // auparavant une suppression sans effet répondait « Dossier supprimé ».
    const countRes = await db.query(
      'SELECT COUNT(*)::int AS n FROM documents WHERE dossier_id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    const result = await tenantDb.query(tenantId, 'DELETE FROM document_folders WHERE id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ message: 'Dossier non trouvé' });
    res.json({ message: 'Dossier supprimé', documents_declasses: countRes.rows[0]?.n || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la suppression du dossier' });
  }
};

/* ===== Partage de document par email ===== */

// Plafond de destinataires par partage. Sans lui, `emails` étant un tableau
// libre venant de req.body, l'endpoint devient un relais de diffusion : un
// compte quelconque y pousse des milliers d'adresses avec un texte libre,
// expédiées depuis le domaine vérifié de l'organisation.
const MAX_SHARE_RECIPIENTS = 20;

// `includes('@')` acceptait « @ », « a@b », ou une adresse suivie d'un CRLF.
// On ne cherche pas la conformité RFC 5322 intégrale (impossible en une regex
// utile) mais à rejeter ce qui n'est pas expédiable, y compris les retours
// chariot qui feraient un candidat à l'injection d'en-tête.
const EMAIL_RE = /^[^\s@<>",;:\\]+@[^\s@<>",;:\\.]+(\.[^\s@<>",;:\\.]+)+$/;

exports.shareDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { emails, message } = req.body;

  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ message: 'Au moins une adresse email est requise' });
  }

  if (emails.length > MAX_SHARE_RECIPIENTS) {
    return res.status(400).json({
      message: `Trop de destinataires (${emails.length}) — ${MAX_SHARE_RECIPIENTS} au maximum par partage`,
    });
  }

  // On valide avant d'envoyer quoi que ce soit : une adresse invalide au milieu
  // du lot signalait auparavant un succès après avoir sauté silencieusement le
  // destinataire, laissant croire à l'utilisateur que le partage avait abouti.
  const cleaned = emails.map((e) => (typeof e === 'string' ? e.trim() : ''));
  const invalid = cleaned.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length) {
    return res.status(400).json({
      message: `Adresse email invalide : ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''}`,
    });
  }

  try {
    const docRes = await tenantDb.query(
      tenantId,
      'SELECT id, reference_mfile, nom_entreprise, num_dossier, num_acte, type_document, annee FROM documents WHERE id = $1',
      [id]
    );
    const doc = docRes.rows[0];
    if (!doc) return res.status(404).json({ message: 'Document non trouvé' });

    const { sendMail } = require('../services/mailService');
    // escapeHtml is already defined at module scope above (see TAG SANITISATION section)
    const senderName = escapeHtml(req.user.full_name || req.user.username);

    for (const email of emails) {
      if (!email || !email.includes('@')) continue;
      try {
        await sendMail({
          to: email,
          subject: `📄 ${senderName} vous partage un document — ${escapeHtml(doc.reference_mfile)}`,
          html: `
            <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
              <div style="text-align:center;margin-bottom:24px;">
                <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#0f172a,#1e293b);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:18px;">📄</div>
              </div>
              <h2 style="color:#0f172a;font-size:18px;font-weight:700;text-align:center;margin:0 0 16px;">Document partagé</h2>
              <p style="color:#475569;font-size:14px;line-height:1.6;text-align:center;">${senderName} vous a partagé le document suivant :</p>
              <div style="background:#f8fafc;border-radius:12px;padding:20px;margin:20px 0;border:1px solid #e2e8f0;">
                <p style="margin:0 0 8px;"><strong style="color:#0f172a;">Référence :</strong> <span style="color:#3b82f6;font-weight:600;">${escapeHtml(doc.reference_mfile)}</span></p>
                <p style="margin:0 0 8px;"><strong style="color:#0f172a;">Entreprise :</strong> ${escapeHtml(doc.nom_entreprise || '—')}</p>
                <p style="margin:0 0 8px;"><strong style="color:#0f172a;">Dossier / Acte :</strong> ${escapeHtml(doc.num_dossier)} / ${escapeHtml(doc.num_acte)}</p>
                ${doc.type_document ? `<p style="margin:0 0 8px;"><strong style="color:#0f172a;">Type :</strong> ${escapeHtml(doc.type_document)}</p>` : ''}
                <p style="margin:0;"><strong style="color:#0f172a;">Année :</strong> ${escapeHtml(doc.annee || '—')}</p>
              </div>
              ${message ? `<p style="color:#64748b;font-size:13px;font-style:italic;margin:16px 0;">"${escapeHtml(message)}"</p>` : ''}
              <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:24px;">Connectez-vous à DocuFlow pour consulter et télécharger ce document.</p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
              <p style="color:#cbd5e1;font-size:11px;text-align:center;margin:0;">© ${new Date().getFullYear()} DocuFlow — Plateforme de gestion documentaire</p>
            </div>`
        });
      } catch (mailErr) {
        console.error(`[share] Erreur envoi à ${email}:`, mailErr.message);
      }
    }

    await logHistory(tenantId, doc.id, req.user.id, `Document partagé avec ${emails.length} personne(s)`, null, null);

    res.json({ message: `Document partagé avec ${emails.length} personne(s)` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du partage du document' });
  }
};

/* ===== M-Files Feature: Check-in / Check-out (Verrouillage) ===== */

exports.checkoutDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;
  const { id } = req.params;

  try {
    const docRes = await tenantDb.query(
      tenantId,
      'SELECT id, is_checked_out, checked_out_by FROM documents WHERE id = $1',
      [id]
    );
    const doc = docRes.rows[0];
    if (!doc) return res.status(404).json({ message: 'Document non trouvé' });

    if (doc.is_checked_out) {
      if (doc.checked_out_by === userId) {
        return res.status(400).json({ message: 'Vous avez déjà verrouillé ce document (check-out)' });
      }
      return res.status(409).json({ message: 'Ce document est actuellement verrouillé par un autre utilisateur' });
    }

    await tenantDb.query(
      tenantId,
      'UPDATE documents SET is_checked_out = TRUE, checked_out_by = $1, checked_out_at = NOW() WHERE id = $2',
      [userId, id]
    );

    await logHistory(tenantId, id, userId, 'Verrouillage du document (Check-out)', null, null);
    res.json({ message: 'Document verrouillé pour édition (Check-out effectué)', is_checked_out: true, checked_out_by: userId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du verrouillage du document' });
  }
};

exports.checkinDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;
  const { id } = req.params;

  try {
    const docRes = await tenantDb.query(
      tenantId,
      'SELECT id, is_checked_out, checked_out_by FROM documents WHERE id = $1',
      [id]
    );
    const doc = docRes.rows[0];
    if (!doc) return res.status(404).json({ message: 'Document non trouvé' });

    if (!doc.is_checked_out) {
      return res.status(400).json({ message: 'Ce document n\'est pas verrouillé' });
    }

    const isAdmin = ADMIN_ROLES.includes(req.user.role);
    if (doc.checked_out_by !== userId && !isAdmin) {
      return res.status(403).json({ message: 'Seul l\'utilisateur ayant effectué le check-out (ou un administrateur) peut libérer le document' });
    }

    await tenantDb.query(
      tenantId,
      'UPDATE documents SET is_checked_out = FALSE, checked_out_by = NULL, checked_out_at = NULL WHERE id = $1',
      [id]
    );

    await logHistory(tenantId, id, userId, 'Déverrouillage du document (Check-in)', null, null);
    res.json({ message: 'Document déverrouillé (Check-in effectué)', is_checked_out: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du déverrouillage du document' });
  }
};

/* ===== M-Files Feature: Vues Dynamiques (Dynamic Views) ===== */

exports.getDynamicViews = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    const result = await tenantDb.query(
      tenantId,
      `SELECT dv.*, u.username as creator_name
       FROM dynamic_views dv
       LEFT JOIN users u ON dv.created_by = u.id
       WHERE dv.tenant_id = $1
       ORDER BY dv.created_at DESC`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    // Si la table n'existe pas encore
    if (err.code === '42P01') return res.json([]);
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des vues dynamiques' });
  }
};

exports.createDynamicView = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;
  const { name, description, group_by_field, filter_json } = req.body;

  if (!name || !group_by_field) {
    return res.status(400).json({ message: 'Le nom et le champ de regroupement sont requis' });
  }

  // Sans cette validation, une vue pouvait être enregistrée avec un champ de
  // regroupement hors liste blanche : le calcul le ramenait silencieusement à
  // `type_document` et la vue affichait autre chose que ce que son nom annonçait.
  if (!ALLOWED_GROUP.includes(group_by_field)) {
    return res.status(400).json({
      message: `Champ de regroupement non autorisé : ${group_by_field}`,
      allowed: ALLOWED_GROUP,
    });
  }

  // Même raisonnement pour les filtres : un filtre inconnu était accepté à
  // l'enregistrement puis ignoré au calcul, la vue montrant alors plus de
  // documents que son résumé ne le prétend. On refuse tôt et explicitement.
  let filters = {};
  if (filter_json !== undefined && filter_json !== null && filter_json !== '') {
    if (typeof filter_json !== 'object' || Array.isArray(filter_json)) {
      return res.status(400).json({ message: 'filter_json doit être un objet' });
    }
    const unknown = Object.keys(filter_json).filter((k) => !(k in ALLOWED_FILTERS));
    if (unknown.length) {
      return res.status(400).json({
        message: `Filtre non reconnu : ${unknown.join(', ')}`,
        allowed: Object.keys(ALLOWED_FILTERS),
      });
    }
    // `annee` et `dossier_id` sont comparés en entier : une valeur illisible
    // serait ignorée au calcul, donc autant la refuser à l'enregistrement.
    for (const [key, kind] of Object.entries(ALLOWED_FILTERS)) {
      const raw = filter_json[key];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;
      if (kind === 'int' && !Number.isFinite(Number(raw))) {
        return res.status(400).json({ message: `Le filtre « ${key} » attend un nombre` });
      }
      filters[key] = raw;
    }
  }

  try {
    const result = await tenantDb.insert(
      tenantId,
      'dynamic_views',
      ['name', 'description', 'group_by_field', 'filter_json', 'created_by'],
      [name, description || null, group_by_field, filters, userId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la création de la vue dynamique' });
  }
};

/**
 * Regroupement dynamique des documents (paradigme M-Files).
 *
 * Deux modes :
 *   - `groupBy` : regroupement ad hoc sur un champ de la liste blanche ;
 *   - `view_id` : rejoue une vue enregistrée (dynamic_views), c'est-à-dire son
 *     champ de regroupement ET ses filtres. Sans ce mode, `filter_json` était
 *     stocké à la création puis jamais relu : une vue enregistrée donnait
 *     exactement le même résultat qu'un regroupement brut, ses filtres étaient
 *     lettre morte.
 *
 * Le nom du champ de regroupement est concaténé dans le SQL : il ne peut donc
 * venir que de la liste blanche, jamais de la requête telle quelle. Les valeurs
 * de filtre, elles, sont toujours passées en paramètres liés.
 */
exports.getDynamicViewData = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { groupBy, view_id } = req.query;

  try {
    let requestedGroup = groupBy;
    let filters = {};

    if (view_id) {
      const viewRes = await db.query(
        'SELECT group_by_field, filter_json FROM dynamic_views WHERE id = $1 AND tenant_id = $2',
        [Number(view_id), tenantId]
      );
      const view = viewRes.rows[0];
      if (!view) return res.status(404).json({ message: 'Vue dynamique non trouvée' });
      requestedGroup = view.group_by_field;
      // `filter_json` peut valoir NULL, {} ou une chaîne selon l'historique
      // d'écriture : on ne fait confiance qu'à un véritable objet.
      if (view.filter_json && typeof view.filter_json === 'object' && !Array.isArray(view.filter_json)) {
        filters = view.filter_json;
      }
    }

    const groupField = ALLOWED_GROUP.includes(requestedGroup) ? requestedGroup : 'type_document';

    const vals = [tenantId];
    const conds = ['tenant_id = $1'];
    for (const [key, kind] of Object.entries(ALLOWED_FILTERS)) {
      const raw = filters[key];
      if (raw === undefined || raw === null || raw === '') continue;
      if (kind === 'int') {
        const n = Number(raw);
        if (!Number.isFinite(n)) continue; // filtre illisible : ignoré, pas d'erreur 500
        vals.push(n);
        conds.push(`${key} = $${vals.length}`);
      } else if (kind === 'ilike') {
        vals.push(`%${String(raw)}%`);
        conds.push(`${key} ILIKE $${vals.length}`);
      } else {
        vals.push(String(raw));
        conds.push(`${key} = $${vals.length}`);
      }
    }

    const query = `
      SELECT COALESCE(${groupField}::text, '${UNCLASSIFIED_GROUP}') as group_name,
             COUNT(*)::int as count,
             JSON_AGG(JSON_BUILD_OBJECT(
               'id', id,
               'reference_mfile', reference_mfile,
               'num_dossier', num_dossier,
               'num_acte', num_acte,
               'nom_entreprise', nom_entreprise,
               'type_document', type_document,
               'annee', annee,
               'statut', statut,
               'auteur', auteur,
               'is_checked_out', is_checked_out,
               'checked_out_by', checked_out_by
             ) ORDER BY created_at DESC) as documents
      FROM documents
      WHERE ${conds.join(' AND ')}
      GROUP BY ${groupField}
      ORDER BY count DESC
    `;
    const result = await db.query(query, vals);
    // Le champ de regroupement est renvoyé avec les groupes : en mode `view_id`,
    // c'est la seule façon pour l'interface de savoir sur quelle métadonnée un
    // glisser-déposer doit agir.
    res.json({ group_by_field: groupField, groups: result.rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ group_by_field: 'type_document', groups: [] });
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du calcul de la vue dynamique' });
  }
};

/* ===== M-Files Feature: Document Assembly & Relations ===== */

exports.getAssemblyTemplates = async (req, res) => {
  const { DEFAULT_TEMPLATES } = require('../services/documentAssemblyService');
  res.json(DEFAULT_TEMPLATES);
};

exports.generateAssembledDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;
  const { template_id, nom_entreprise, num_dossier, num_acte, annee, description, lieu } = req.body;
  const { DEFAULT_TEMPLATES, assembleDocumentTemplate } = require('../services/documentAssemblyService');

  const template = DEFAULT_TEMPLATES.find(t => t.id === template_id) || DEFAULT_TEMPLATES[0];
  const metadata = {
    nom_entreprise: nom_entreprise || 'Entreprise exemple',
    num_dossier: num_dossier || 'DOS-2026-001',
    num_acte: num_acte || 'ACTE-100',
    annee: annee || new Date().getFullYear(),
    description: description || '',
    date_document: new Date().toLocaleDateString('fr-FR'),
    lieu: lieu || 'Cotonou'
  };

  const assembledText = assembleDocumentTemplate(template.content, metadata);

  try {
    const tempRef = `DOC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const result = await tenantDb.insert(
      tenantId,
      'documents',
      ['reference_mfile', 'num_dossier', 'num_acte', 'nom_entreprise', 'annee', 'type_document', 'description', 'tags', 'auteur', 'date_document', 'statut', 'version', 'created_by'],
      [tempRef, metadata.num_dossier, metadata.num_acte, metadata.nom_entreprise, metadata.annee, 'Acte Assemblé', assembledText, ['mfiles-assembled'], req.user.username, new Date(), 'disponible', 1, userId]
    );
    const doc = result.rows[0];
    const reference_mfile = await setCanonicalReference(tenantId, doc.id);
    await logHistory(tenantId, doc.id, userId, `Document assemblé automatiquement (Modèle: ${template.name})`, null, 'disponible');

    res.status(201).json({ ...doc, reference_mfile, assembled_text: assembledText });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de l\'assemblage du document' });
  }
};

exports.getDocumentMetadata = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  try {
    const values = await metadataService.getDocumentMetadata(tenantId, parseInt(id, 10));
    res.json(values);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des métadonnées' });
  }
};

exports.setDocumentMetadata = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { metadata } = req.body; // Array of { fieldId, value }
  if (!Array.isArray(metadata)) return res.status(400).json({ message: 'Le corps de la requête doit contenir un tableau de métadonnées' });

  try {
    // Tolère `definitionId` (ancien nom côté client) en plus de `fieldId`.
    const values = metadata.map((m) => ({
      fieldId: Number(m.fieldId ?? m.definitionId ?? m.field_id),
      value: m.value,
    }));
    if (values.some((v) => !Number.isInteger(v.fieldId))) {
      return res.status(400).json({ message: 'Chaque entrée doit référencer un fieldId valide' });
    }

    await metadataService.setDocumentMetadata(tenantId, parseInt(id, 10), values);
    await documentAuditService.logAction({
      tenantId,
      documentId: parseInt(id, 10),
      userId: req.user.id,
      username: req.user.username,
      action: 'METADATA_UPDATE',
      details: { fields: values.map((v) => v.fieldId) },
      ipAddress: req.ip,
    });
    res.json({ message: 'Métadonnées mises à jour avec succès' });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message || 'Erreur lors de la mise à jour des métadonnées' });
  }
};

exports.getDocumentAudit = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  try {
    const audit = await documentAuditService.getAuditForDocument(tenantId, parseInt(id, 10));
    res.json(audit);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération de l\'audit' });
  }
};

exports.getDocumentRelations = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  try {
    const relations = await relationService.getRelationsForDocument(tenantId, parseInt(id, 10));
    res.json(relations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des relations' });
  }
};

exports.createDocumentRelation = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { target_document_id, relation_type } = req.body;

  if (!target_document_id) {
    return res.status(400).json({ message: 'Le document cible est requis' });
  }

  try {
    const relation = await relationService.createRelation({
      tenantId,
      fromDocId: parseInt(id, 10),
      toDocId: target_document_id,
      relationType: relation_type || 'related',
      userId: req.user.id,
    });

    if (!relation) {
      return res.status(200).json({ message: 'Cette relation existe déjà', alreadyExists: true });
    }

    await documentAuditService.logAction({
      tenantId,
      documentId: parseInt(id, 10),
      userId: req.user.id,
      username: req.user.username,
      action: 'RELATION_CREATED',
      details: { targetDocId: target_document_id, type: relation.relation_type },
      ipAddress: req.ip,
    });
    res.status(201).json(relation);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message || 'Erreur lors de la création de la relation' });
  }
};

