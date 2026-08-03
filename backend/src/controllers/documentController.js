const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const storage = require('../services/storageService');
const { logHistory, addFileToDocument, setCanonicalReference, indexRequestToDocuments } = require('../services/documentIndexService');
const { extractText, extractAutoTags } = require('../services/textExtractionService');

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
      const existingTags = parseTags(tags) || [];
      const autoTags = extractAutoTags(allText, existingTags);
      if (autoTags.length > existingTags.length) {
        await tenantDb.update(
          tenantId, 'documents',
          ['tags'], [autoTags],
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
    conds.push(`(d.nom_entreprise ILIKE $${i} OR d.num_dossier ILIKE $${i} OR d.num_acte ILIKE $${i} OR d.reference_mfile ILIKE $${i} OR d.description ILIKE $${i} OR d.type_document ILIKE $${i} OR d.auteur ILIKE $${i} OR EXISTS (SELECT 1 FROM unnest(d.tags) t WHERE t ILIKE $${i}))`);
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

    // Supprimer les références dans requests
    await client.query('UPDATE requests SET document_id = NULL WHERE document_id = $1 AND tenant_id = $2', [id, tenantId]);

    // Supprimer les fichiers de la base
    await client.query('DELETE FROM document_files WHERE document_id = $1', [id]);

    // Supprimer l'historique
    await client.query('DELETE FROM document_history WHERE document_id = $1', [id]);

    // Supprimer le document
    await client.query('DELETE FROM documents WHERE id = $1 AND tenant_id = $2', [id, tenantId]);

    await client.query('COMMIT');

    // Supprimer les fichiers du stockage après validation de la transaction
    for (const f of filesRes.rows) {
      try {
        await storage.deleteFile({ storedName: f.stored_name, cloudinaryPublicId: f.cloudinary_public_id, resourceType: f.mime_type });
      } catch (storageErr) {
        console.warn('[document] Erreur suppression fichier stockage:', storageErr.message);
      }
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
  try {
    const docRes = await tenantDb.query(tenantId, 'SELECT id FROM documents WHERE id = $1', [id]);
    if (!docRes.rows[0]) return res.status(404).json({ message: 'Document non trouvé' });

    const fileRes = await db.query('SELECT * FROM document_files WHERE id = $1 AND document_id = $2', [fileId, id]);
    const fileRow = fileRes.rows[0];
    if (!fileRow) return res.status(404).json({ message: 'Fichier non trouvé' });

    await storage.deleteFile({ storedName: fileRow.stored_name, cloudinaryPublicId: fileRow.cloudinary_public_id, resourceType: fileRow.mime_type });
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

/* ===== Partage de document par email ===== */

exports.shareDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { emails, message } = req.body;

  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ message: 'Au moins une adresse email est requise' });
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
    const senderName = req.user.full_name || req.user.username;

    for (const email of emails) {
      if (!email || !email.includes('@')) continue;
      try {
        await sendMail({
          to: email,
          subject: `📄 ${senderName} vous partage un document — ${doc.reference_mfile}`,
          html: `
            <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
              <div style="text-align:center;margin-bottom:24px;">
                <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#0f172a,#1e293b);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:18px;">📄</div>
              </div>
              <h2 style="color:#0f172a;font-size:18px;font-weight:700;text-align:center;margin:0 0 16px;">Document partagé</h2>
              <p style="color:#475569;font-size:14px;line-height:1.6;text-align:center;">${senderName} vous a partagé le document suivant :</p>
              <div style="background:#f8fafc;border-radius:12px;padding:20px;margin:20px 0;border:1px solid #e2e8f0;">
                <p style="margin:0 0 8px;"><strong style="color:#0f172a;">Référence :</strong> <span style="color:#3b82f6;font-weight:600;">${doc.reference_mfile}</span></p>
                <p style="margin:0 0 8px;"><strong style="color:#0f172a;">Entreprise :</strong> ${doc.nom_entreprise || '—'}</p>
                <p style="margin:0 0 8px;"><strong style="color:#0f172a;">Dossier / Acte :</strong> ${doc.num_dossier} / ${doc.num_acte}</p>
                ${doc.type_document ? `<p style="margin:0 0 8px;"><strong style="color:#0f172a;">Type :</strong> ${doc.type_document}</p>` : ''}
                <p style="margin:0;"><strong style="color:#0f172a;">Année :</strong> ${doc.annee || '—'}</p>
              </div>
              ${message ? `<p style="color:#64748b;font-size:13px;font-style:italic;margin:16px 0;">"${message}"</p>` : ''}
              <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:24px;">Connectez-vous à DocuFlow pour consulter et télécharger ce document.</p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
              <p style="color:#cbd5e1;font-size:11px;text-align:center;margin:0;">© ${new Date().getFullYear()} DocuFlow AFGC — Plateforme de gestion documentaire</p>
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
