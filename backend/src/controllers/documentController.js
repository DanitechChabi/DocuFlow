const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const storage = require('../services/storageService');
const { logHistory, addFileToDocument, setCanonicalReference, indexRequestToDocuments } = require('../services/documentIndexService');
const { extractText, extractAutoTags } = require('../services/textExtractionService');
const metadataService = require('../services/metadataService');
const documentAuditService = require('../services/documentAuditService');
const relationService = require('../services/relationService');
const retentionService = require('../services/retentionService');
const stateMachine = require('../services/documentStateMachine');
const aclService = require('../services/aclService');
const { ROLES_SYSTEME } = require('../config/permissions');

const ADMIN_ROLES = ['superadmin', 'admin', 'archiviste'];

// Libellé du groupe rassemblant les documents dont la métadonnée de
// regroupement est NULL, dans les vues dynamiques. Ce n'est PAS une valeur
// stockable : c'est une étiquette d'affichage produite par un COALESCE. Elle est
// exportée pour que `updateDocument` puisse refuser de l'écrire en base — sans
// quoi un glisser-déposer vers ce groupe transformerait « absence de valeur » en
// la chaîne littérale « Non classé », que plus aucun COALESCE ne rattraperait.
const UNCLASSIFIED_GROUP = 'Non classé';

// Profondeur maximale de l'arborescence des dossiers : la racine est au niveau 0,
// donc dix niveaux de sous-dossiers. Au-delà, le chemin affiché ne tient plus
// dans une colonne, et la borne protège les CTE récursives d'une descente
// pathologique. Déclarée ici, en tête : `listDocuments` s'en sert bien avant la
// section Dossiers, et un `const` n'est pas hissé — le placer plus bas
// provoquerait un ReferenceError au premier filtrage par dossier.
const MAX_FOLDER_DEPTH = 10;

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

// Valeurs de remplacement du téléversement en masse, pour les trois colonnes que
// le formulaire masque dans ce mode alors que la base les déclare NOT NULL
// (`num_dossier`, `num_acte`, `nom_entreprise` — voir docs/setup_db.sql).
//
// C'est la correction d'une panne totale du mode en masse : le contrôleur y
// insérait `num_dossier || null`, et PostgreSQL refusait chaque ligne avec
// « null value in column "num_dossier" violates not-null constraint » (23502).
// Comme l'insertion est enveloppée dans un try par fichier, l'échec ne remontait
// pas en erreur HTTP : la réponse était un 201 « 0 créés, N échecs » — un succès
// apparent pour un travail qui n'avait pas eu lieu.
//
// Un texte plutôt qu'une chaîne vide : ces trois valeurs sont AFFICHÉES sans
// repli (`DocumentsPage` les met en colonne, `DraggableDocumentCard` les compose
// en « dossier / acte — année »). Une chaîne vide laisserait des cellules et une
// ligne « / — 2026 » que rien n'explique, alors que l'archiviste doit
// précisément repérer ces fiches pour les compléter — c'est le sens du statut
// « à indexer ». Le mot dit ce qui reste à faire, et reste modifiable ensuite
// par la fiche du document (`updateDocument` accepte les trois colonnes).
const BULK_PLACEHOLDER = 'À indexer';

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
const { escapeHtml, sanitizeHeader } = require('../helpers/htmlEscape');

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

  // Dernier filet : après tout ce qui précède, `tags` peut encore n'être NI un
  // tableau NI undefined — un JSON.parse (« 5 » → 5), un nombre, un objet
  // quelconque du corps multipart. L'ancien code itérait alors `tags` tel quel
  // et l'exception « tags is not iterable » TUAIT LE PROCESSUS ENTIER (vérifié
  // en production : trois redémarrage Render pour trois requêtes mal formées) —
  // un crash serveur sur une donnée d'entrée, au lieu d'un 400 propre. Tout ce
  // qui n'est pas un tableau est un format invalide : rejet avec message.
  if (tags !== undefined && !Array.isArray(tags)) {
    return null;
  }

  // Regex permissive pour tags français : lettres (y compris accents), chiffres, espaces, _ - . '
  // Rejette uniquement les caractères dangereux pour XSS/injection : < > " ' & { } [ ] ( ) ;
  const safeTagRegex = /^[^<>"'&{}()\[\];]*$/;
  const sanitized = [];

  for (const t of tags || []) {
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
    tags, auteur, date_document, dossier_id, statut, bulkUpload,
  } = req.body;

  // Sanitize tags early
  const safeTags = sanitizeTags(tags);
  if (tags && safeTags === null) {
    return res.status(400).json({ message: 'Format de tags invalide (caractères interdits détectés)' });
  }
  const dbTags = safeTags || [];

  const isBulk = String(bulkUpload) === 'true';

  if (!isBulk && (!nom_entreprise || !num_dossier || !num_acte)) {
    return res.status(400).json({ message: 'Entreprise, n° dossier et n° acte sont requis' });
  }

  // PÉRIMÈTRE (ACL) : verser dans un dossier exige 'write' sur CE dossier —
  // la permission documents.upload dit qu'on peut verser, l'ACL dit où.
  // Sans dossier, pas de restriction (les non classés suivent le RBAC seul).
  if (dossier_id && !(await aclService.peutEcrire(tenantId, userId, dossier_id))) {
    return res.status(403).json({
      message: "Ce dossier est hors de votre périmètre d'écriture.",
      code: 'HORS_PERIMETRE',
    });
  }

  try {
    if (isBulk) {
      if (!req.files || !req.files.length) {
        return res.status(400).json({ message: 'Aucun fichier fourni pour le téléversement en masse' });
      }

      const results = { created: [], failed: [] };
      const rejectedFiles = req.rejectedFiles || [];

      for (const file of req.files) {
        try {
          const tempRef = `DOC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          const docRes = await tenantDb.insert(
            tenantId,
            'documents',
            ['reference_mfile', 'num_dossier', 'num_acte', 'nom_entreprise', 'annee', 'type_document', 'description', 'tags', 'auteur', 'date_document', 'statut', 'version', 'dossier_id', 'created_by'],
            // Les trois colonnes NOT NULL reçoivent la saisie si elle existe (le
            // formulaire peut être rempli même en masse), sinon le repli. Jamais
            // NULL : la base refuserait la ligne — voir BULK_PLACEHOLDER.
            [tempRef, num_dossier || BULK_PLACEHOLDER, num_acte || BULK_PLACEHOLDER, nom_entreprise || BULK_PLACEHOLDER, annee || new Date().getFullYear(), type_document || null, description || null, dbTags, auteur || null, date_document || null, 'à indexer', 1, dossier_id || null, userId]
          );
          const doc = docRes.rows[0];
          const reference_mfile = await setCanonicalReference(tenantId, doc.id);

          await addFileToDocument(tenantId, doc.id, userId, file);
          const text = await extractText(file.path, file.mimetype);
          if (text) {
            const autoTags = extractAutoTags(text, dbTags);
            const sanitizedAutoTags = autoTags.map(t => sanitizeTags(t)).filter(Boolean).flat();
            if (sanitizedAutoTags.length > dbTags.length) {
              await tenantDb.update(tenantId, 'documents', ['tags'], [sanitizedAutoTags], 'id', doc.id);
            }
          }

          await logHistory(tenantId, doc.id, userId, 'Téléversement en masse', null, 'à indexer');
          results.created.push({ id: doc.id, reference: reference_mfile, fileName: file.originalname });
        } catch (err) {
          console.error(`[bulk] Erreur fichier ${file.originalname}:`, err);
          results.failed.push({ fileName: file.originalname, error: err.message });
        }
      }

      // 201 UNIQUEMENT si quelque chose a été créé. Un lot entièrement en échec
      // renvoyait auparavant « 201 Created » avec « 0 créés, N échecs » : le
      // frontend traitait la réponse en succès, fermait sur un message vert, et
      // l'utilisateur croyait ses fichiers versés. C'est exactement ce qui a
      // masqué la panne des colonnes NOT NULL. 500 dit ce qui s'est passé — la
      // cause est côté serveur, pas dans les fichiers envoyés.
      if (results.created.length === 0 && results.failed.length > 0) {
        return res.status(500).json({
          message: `Aucun document n'a pu être créé (${results.failed.length} échec(s)).`,
          ...results,
          rejected: rejectedFiles,
        });
      }

      return res.status(201).json({
        message: `Téléversement terminé. ${results.created.length} créés, ${results.failed.length} échecs.`,
        ...results,
        rejected: rejectedFiles
      });
    }

    // --- Mode standard (1 document, N fichiers) ---
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
      const existingTags = dbTags;
      const autoTags = extractAutoTags(allText, existingTags);
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

  // La corbeille n'apparaît pas dans le référentiel : sa page dédiée la liste.
  // (listCorbeille, plus bas)
  const conds = ['d.tenant_id = $1', 'd.deleted_at IS NULL'];
  const vals = [tenantId];

  // PÉRIMÈTRES (ACL) : la liste ne montre que les documents des dossiers
  // accessibles à CET utilisateur — et les documents non classés, qu'aucune
  // ACL ne peut viser. L'ensemble est résolu en une passe (cache 60 s) puis
  // borné ici : l'« agent RH » voit RH, pas Finance, pas Direction.
  try {
    const { visibles } = await aclService.dossiersAccessibles(tenantId, req.user.id);
    if (visibles.size === 0 && !dossier_id) {
      // Aucun dossier accessible (échec fermé) : rien à montrer — mais les
      // documents non classés restent visibles (périmètre GED, pas dossier).
      conds.push('d.dossier_id IS NULL');
    } else if (visibles.size > 0) {
      const ids = [...visibles];
      const bornes = ids.map((_, idx) => `$${vals.length + 1 + idx}`);
      vals.push(...ids);
      conds.push(`(d.dossier_id IS NULL OR d.dossier_id IN (${bornes.join(', ')}))`);
    }
  } catch (err) {
    // Échec de résolution : liste vide plutôt qu'une liste qui montre tout —
    // l'échec fermé du service couvre déjà ce cas, ce filet protège contre
    // une exception imprévue dans la construction de la clause.
    console.error('[documents] Périmètres non résolus — liste vide :', err.message);
    return res.json({
      documents: [],
      pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 },
      facets: {},
      storage_used: null,
    });
  }

  if (q) {
    vals.push(`%${q}%`);
    const i = vals.length;
    conds.push(`(d.nom_entreprise ILIKE $${i} OR d.num_dossier ILIKE $${i} OR d.num_acte ILIKE $${i} OR d.reference_mfile ILIKE $${i} OR d.description ILIKE $${i} OR d.type_document ILIKE $${i} OR d.auteur ILIKE $${i} OR EXISTS (SELECT 1 FROM unnest(d.tags) t(tag) WHERE t.tag ILIKE $${i}))`);
  }
  if (type_document) { vals.push(type_document); conds.push(`d.type_document = $${vals.length}`); }
  if (annee) { vals.push(Number(annee)); conds.push(`d.annee = $${vals.length}`); }
  if (statut) { vals.push(statut); conds.push(`d.statut = $${vals.length}`); }
  if (dossier_id) {
    vals.push(Number(dossier_id));
    // Un dossier INCLUT ses sous-dossiers. Sans cette descente récursive,
    // sélectionner « Archives » n'affiche rien dès lors que les documents sont
    // rangés dans « Archives / 2025 » : l'arborescence rendrait alors la
    // consultation plus difficile qu'une liste plate, ce qui serait absurde.
    //
    // La récursion est bornée en profondeur et exclut les identifiants déjà
    // visités : une donnée héritée formant un cycle boucherait sinon la requête.
    //
    // Attention : ici `depth` compte à partir du dossier SÉLECTIONNÉ, pas depuis
    // la racine. La borne n'est donc pas la limite d'arborescence — c'est un
    // simple garde-fou d'arrêt, et il est volontairement large. Un filtre qui
    // s'arrête trop tôt omettrait des documents en silence, ce qui est bien pire
    // qu'une itération de trop : on ne resserre pas cette borne pour l'aligner
    // sur celle de chargerArborescence().
    conds.push(`d.dossier_id IN (
      WITH RECURSIVE descendance AS (
        SELECT id, 0 AS depth, ARRAY[id] AS vus
        FROM document_folders WHERE id = $${vals.length} AND tenant_id = $1
        UNION ALL
        SELECT e.id, dsc.depth + 1, dsc.vus || e.id
        FROM document_folders e
        JOIN descendance dsc ON e.parent_id = dsc.id
        WHERE e.tenant_id = $1 AND dsc.depth < ${MAX_FOLDER_DEPTH} AND NOT (e.id = ANY(dsc.vus))
      )
      SELECT id FROM descendance
    )`);
  }
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
    // Rétention : premier passage de la journée pour ce tenant (le scheduler
    // en mémoire retient les 23 heures suivantes). La consultation du
    // référentiel est le moment naturel — les documents à échéance sont
    // précisément ceux qu'on est en train de regarder, et aucun cron externe
    // n'est nécessaire ni sur Render free ni sur le poste bureau.
    retentionService.retentionScheduler
      .passageRetenu(tenantId, req.user.id, logHistory)
      .catch(() => { /* déjà journalisé par le scheduler */ });

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

    // Espace documentaire utilisé (somme des fichiers) : une seule requête
    // agrégée, servie avec la liste — l'accueil et la vue d'ensemble GED
    // l'affichent sans route dédiée. Échec non bloquant : la valeur manque,
    // jamais la liste.
    let storageUsed = null;
    try {
      const stRes = await db.query(
        `SELECT COALESCE(SUM(df.file_size), 0)::bigint AS total
           FROM document_files df
           JOIN documents d ON d.id = df.document_id
          WHERE d.tenant_id = $1`,
        [tenantId]
      );
      storageUsed = Number(stRes.rows[0]?.total) || 0;
    } catch { /* silencieux */ }

    res.json({
      documents: listRes.rows,
      pagination: { page: Number(page), page_size: limit, total, total_pages: Math.ceil(total / limit) },
      facets,
      storage_used: storageUsed,
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
    // La corbeille n'est pas consultable par la fiche standard : sa page dédiée
    // liste les documents supprimés et propose la restauration. Une fiche
    // supprimée ouverte par un lien périmé doit le DIRE, pas se lire comme
    // active.
    if (doc.deleted_at) return res.status(404).json({ message: 'Ce document est en corbeille', code: 'EN_CORBEILLE' });

    // PÉRIMÈTRE (ACL) : la fiche d'un dossier non lisible ne se consulte pas —
    // la liste ne le montre pas, l'ouvrir par un identifiant deviné ne doit
    // pas contourner la restriction.
    const niveauLecture = await aclService.peutLire(tenantId, req.user.id, doc.dossier_id);
    if (!niveauLecture) {
      return res.status(403).json({ message: "Ce document appartient à un dossier hors de votre périmètre.", code: 'HORS_PERIMETRE' });
    }

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

  // CYCLE DE VIE : deux refus avant toute écriture.
  try {
    const verrou = await chargerPourEcriture(tenantId, id, req.user);
    if (verrou) return res.status(verrou.statut).json({ message: verrou.message, code: verrou.code });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur' });
  }

  // PÉRIMÈTRE (ACL) : dossier_id est modifiable ici — déplacer un document
  // est une écriture sur le dossier CIBLE aussi. Sans ce garde, restreindre
  // « Finance » ne servirait à rien : il suffirait d'y glisser un document
  // depuis un dossier ouvert. La déclassification (dossier_id null) reste
  // libre : les non classés suivent le RBAC seul.
  if (req.body.dossier_id !== undefined && req.body.dossier_id !== null
    && !(await aclService.peutEcrire(tenantId, req.user.id, req.body.dossier_id))) {
    return res.status(403).json({
      message: "Le dossier de destination est hors de votre périmètre d'écriture.",
      code: 'HORS_PERIMETRE',
    });
  }

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


// ============================================================================
// SUPPRESSION — trois gestes distincts, trois niveaux de gravité.
//
//   DELETE  /:id            corbeille (réversible) — deleted_at/deleted_by
//   POST    /:id/restore    restauration depuis la corbeille
//   DELETE  /:id/purge      destruction physique (permission documents.purge)
//
// L'ancien DELETE était un hard delete intégral (fichiers, historique,
// métadonnées, relations) sans filet — irréversible pour une GED, et la fiche
// survivait aux demandes qui l'avaient produite sans trace. La destruction
// physique reste possible, mais elle est un geste EXPRES, pas le bouton par
// défaut — et elle ne vise que la corbeille : détruire physiquement un
// document actif exige d'abord de le mettre en corbeille.
// ============================================================================

exports.deleteDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;

  try {
    // PÉRIMÈTRE (ACL) : mettre à la corbeille est une écriture — le périmètre
    // du dossier du document décide (garde silencieuse si document introuvable :
    // le UPDATE ci-dessous répond déjà 404 pour ce cas).
    const refus = await gardePerimetreDocument(tenantId, req.user.id, id, 'write');
    if (refus) return res.status(refus.statut).json({ message: refus.message, code: refus.code });

    // Corbeille : marquer, ne rien détruire. Le document reste complet
    // (fichiers, historique, métadonnées) et restaurable à l'identique.
    const result = await db.query(
      `UPDATE documents
          SET deleted_at = now(), deleted_by = $3
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id, reference_mfile`,
      [id, tenantId, req.user.id]
    );
    if (!result.rowCount) {
      return res.status(404).json({ message: 'Document non trouvé (ou déjà en corbeille)' });
    }

    await logHistory(tenantId, id, req.user.id, 'Mis à la corbeille', null, null);
    res.json({ message: 'Document mis à la corbeille — restaurable depuis la corbeille.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à la corbeille' });
  }
};

/** POST /:id/restore — sortir de la corbeille. */
exports.restoreDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;

  try {
    // PÉRIMÈTRE (ACL) : restaurer réintroduit le document dans la GED — le
    // périmètre d'écriture du dossier décide (l'agent RH ne ressuscite pas
    // un document Finance mis à la corbeille par un autre).
    const refus = await gardePerimetreDocument(tenantId, req.user.id, id, 'write');
    if (refus) return res.status(refus.statut).json({ message: refus.message, code: refus.code });

    const result = await db.query(
      `UPDATE documents
          SET deleted_at = NULL, deleted_by = NULL
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NOT NULL
        RETURNING id, reference_mfile, statut`,
      [id, tenantId]
    );
    if (!result.rowCount) {
      return res.status(404).json({ message: 'Document introuvable dans la corbeille' });
    }
    await logHistory(tenantId, id, req.user.id, 'Restauré depuis la corbeille', null, null);
    res.json({ message: 'Document restauré.', document: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la restauration' });
  }
};

/** GET /corbeille — contenu de la corbeille du tenant. */
exports.listCorbeille = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    // PÉRIMÈTRE (ACL) : la corbeille est une liste de documents — même
    // bornage que la liste principale : les dossiers lisibles, et les non
    // classés (métadonnées comprises : la restriction n'annonce pas ce
    // qu'elle protège).
    const { lisibles } = await aclService.dossiersAccessibles(tenantId, req.user.id);

    const { rows } = await db.query(
      `SELECT d.id, d.reference_mfile, d.nom_entreprise, d.num_dossier, d.num_acte,
               d.statut, d.dossier_id, d.deleted_at, u.full_name AS deleted_by_name,
               (SELECT COUNT(*) FROM document_files df WHERE df.document_id = d.id)::int AS files_count
          FROM documents d
          LEFT JOIN users u ON u.id = d.deleted_by
         WHERE d.tenant_id = $1 AND d.deleted_at IS NOT NULL
           AND (d.dossier_id IS NULL OR d.dossier_id = ANY($2::int[]))
         ORDER BY d.deleted_at DESC`,
      [tenantId, [...lisibles]]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du chargement de la corbeille' });
  }
};

/** DELETE /:id/purge — destruction physique, permission dédiée. */
exports.purgeDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // La purge ne vise QUE la corbeille (voir l'en-tête du bloc).
    const check = await client.query(
      'SELECT id FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NOT NULL',
      [id, tenantId]
    );
    if (!check.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Document introuvable en corbeille (la purge ne vise que la corbeille)' });
    }

    // Fichiers pour suppression du stockage après commit.
    const filesRes = await client.query('SELECT * FROM document_files WHERE document_id = $1', [id]);

    // DB d'abord, stockage après — en cas d'échec du DELETE, les binaires
    // restent intacts et l'opération est rejouable.
    await client.query('UPDATE requests SET document_id = NULL WHERE document_id = $1 AND tenant_id = $2', [id, tenantId]);
    await client.query('DELETE FROM document_files WHERE document_id = $1', [id]);
    await client.query('DELETE FROM document_history WHERE document_id = $1', [id]);
    await client.query('DELETE FROM documents WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    await client.query('COMMIT');

    const deleteErrors = [];
    for (const f of filesRes.rows) {
      try {
        await storage.deleteFile({ storedName: f.stored_name, cloudinaryPublicId: f.cloudinary_public_id, resourceType: f.mime_type });
      } catch (storageErr) {
        deleteErrors.push({ file: f.stored_name, error: storageErr.message });
      }
    }
    if (deleteErrors.length > 0) {
      console.warn('[document] Certains fichiers n\'ont pas pu être supprimés du stockage:', deleteErrors);
    }

    res.json({ message: 'Document définitivement détruit.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la purge' });
  } finally {
    client.release();
  }
};


/* ===== Fichiers & versions ===== */

exports.addFiles = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  try {
    // Cycle de vie : corbeille, archivé, verrou d'autrui (voir la garde).
    const verrou = await chargerPourEcriture(tenantId, id, req.user);
    if (verrou) return res.status(verrou.statut).json({ message: verrou.message, code: verrou.code });
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
    // Cycle de vie : corbeille, archivé, verrou d'autrui (voir la garde).
    // AVANT la transaction : un refus ne doit pas ouvrir de transaction pour rien.
    const verrou = await chargerPourEcriture(tenantId, id, req.user);
    if (verrou) {
      client.release();
      return res.status(verrou.statut).json({ message: verrou.message, code: verrou.code });
    }

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

/**
 * Garde partagée des écritures documentaires.
 *
 * Toute modification (fiche, fichiers, statut, verrou) passe par ici :
 *   • un document EN CORBEILLE ne se modifie pas — il se restaure ;
 *   • un document ARCHIVÉ est figé — le désarchiver est le geste qui rouvre
 *     l'édition (permission documents.archive, transition archivé → prêt) ;
 *   • un document VERROUILLÉ (check-out) ne se modifie que par son détenteur —
 *     c'était le sens du verrou, aucune écriture ne le respectait.
 *
 * @returns {Promise<{statut: number, message: string, code: string}|null>}
 *           null = écrire ; sinon la réponse 4xx à rendre telle quelle.
 */
async function chargerPourEcriture(tenantId, id, user) {
  const { rows } = await tenantDb.query(
    tenantId,
    'SELECT id, statut, deleted_at, is_checked_out, checked_out_by, dossier_id FROM documents WHERE id = $1',
    [id]
  );
  const doc = rows[0];
  if (!doc) return { statut: 404, message: 'Document non trouvé', code: 'INTROUVABLE' };
  if (doc.deleted_at) {
    return { statut: 404, message: 'Ce document est en corbeille — restaurez-le pour le modifier.', code: 'EN_CORBEILLE' };
  }
  if (doc.statut === 'archivé') {
    return {
      statut: 409,
      message: 'Ce document est archivé (lecture seule). Désarchivez-le pour le modifier.',
      code: 'ARCHIVE_LECTURE_SEULE',
    };
  }
  if (doc.is_checked_out && Number(doc.checked_out_by) !== Number(user.id)) {
    return {
      statut: 409,
      message: 'Ce document est verrouillé par un autre utilisateur (check-out).',
      code: 'VERROUILLE',
    };
  }
  // PÉRIMÈTRE (ACL) : écrire exige 'write' sur le dossier du document.
  // Le niveau admin/manage passe — un archiviste sans périmètre sur « Finance »
  // ne peut pas y modifier une fiche, même si sa permission GED le permettait.
  if (!(await aclService.peutEcrire(tenantId, user.id, doc.dossier_id))) {
    return {
      statut: 403,
      message: "Ce document appartient à un dossier hors de votre périmètre d'écriture.",
      code: 'HORS_PERIMETRE',
    };
  }
  return null;
}

/**
 * PÉRIMÈTRE (ACL) — garde pour les routes ciblant un document par id sans
 * charger sa fiche au préalable (métadonnées, audit, relations, partage,
 * corbeille…). Résout le dossier du document puis arbitre le niveau demandé.
 *
 * @param {'read'|'write'} mode lecture : tout niveau d'accès vaut sauf
 *        'none' ; écriture : 'write' ou 'manage' (ou dossier libre).
 * @returns {Promise<{statut:number, message:string, code:string}|null>}
 *          La réponse de refus à renvoyer, ou null — document introuvable
 *          (la route a déjà la sienne pour ce cas) ou accès accordé.
 */
async function gardePerimetreDocument(tenantId, userId, docId, mode) {
  const { rows } = await db.query(
    'SELECT dossier_id FROM documents WHERE id = $1 AND tenant_id = $2',
    [docId, tenantId]
  );
  if (!rows[0]) return null;
  const accorde = mode === 'read'
    ? await aclService.peutLire(tenantId, userId, rows[0].dossier_id)
    : await aclService.peutEcrire(tenantId, userId, rows[0].dossier_id);
  if (!accorde) {
    return {
      statut: 403,
      message: mode === 'read'
        ? 'Ce document appartient à un dossier hors de votre périmètre.'
        : "Ce document appartient à un dossier hors de votre périmètre d'écriture.",
      code: 'HORS_PERIMETRE',
    };
  }
  return null;
}

exports.setStatus = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { statut, comment } = req.body;
  // LA MACHINE À ÉTATS DÉCIDE. L'ancien code acceptait n'importe quelle
  // transition entre les statuts : un document archivé redevenait « actif »
  // sans geste explicite, et « à indexer → archivé » (sauter toute l'indexation)
  // passait aussi. Les transitions autorisées vivent dans documentStateMachine
  // — miroir de la table document_transitions (migration 020) — avec le sens
  // métier qui va avec : archivé = figé, en validation = intermédiaire
  // refusable, à indexer = entrée du cycle.
  try {
    const docRes = await tenantDb.query(tenantId, 'SELECT * FROM documents WHERE id = $1', [id]);
    const doc = docRes.rows[0];
    if (!doc) return res.status(404).json({ message: 'Document non trouvé' });
    if (doc.deleted_at) return res.status(404).json({ message: 'Document en corbeille' });

    // PÉRIMÈTRE (ACL) : changer le statut est une écriture — même garde que
    // la correction de fiche.
    if (!(await aclService.peutEcrire(tenantId, req.user.id, doc.dossier_id))) {
      return res.status(403).json({ message: "Ce document appartient à un dossier hors de votre périmètre d'écriture.", code: 'HORS_PERIMETRE' });
    }

    const transition = stateMachine.canTransition(doc.statut, statut);
    if (!transition.ok) {
      return res.status(400).json({ message: transition.reason, code: 'TRANSITION_REFUSEE' });
    }

    await tenantDb.query(tenantId, 'UPDATE documents SET statut = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [statut, id]);
    await logHistory(tenantId, id, req.user.id, stateMachine.TRANSITIONS_LABELS[`${doc.statut}>${statut}`] || 'Changement de statut', doc.statut, statut, comment);
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

/**
 * L'arborescence des dossiers.
 *
 * `document_folders.parent_id` existe depuis la migration 004 — la colonne y est
 * même commentée « arborescence ». Seule la LECTURE était plate : l'interface
 * n'avait donc aucun moyen de montrer une hiérarchie pourtant stockable. Aucune
 * migration n'est nécessaire ici.
 *
 * Trois règles gouvernent cette section.
 *
 * 1. TOUT parent_id VENANT DU CLIENT EST VÉRIFIÉ. `req.body.parent_id` est un
 *    entier arbitraire : sans contrôle d'appartenance, une organisation
 *    rattachait son dossier sous celui d'une autre. Le dossier devenait alors
 *    invisible pour les deux (son parent n'apparaît pas dans leur arbre) et le
 *    nom du parent d'autrui fuitait dans le chemin.
 *
 * 2. AUCUN CYCLE. Déplacer un dossier sous l'un de ses propres descendants
 *    détache la branche entière de la racine : les dossiers existent toujours en
 *    base mais aucune requête récursive partant de la racine ne les atteint. Ils
 *    disparaissent de l'interface sans qu'aucune erreur ne le signale.
 *
 * 3. LA PROFONDEUR EST BORNÉE. Une arborescence sans limite produit des chemins
 *    illisibles et une interface impraticable ; la borne protège aussi la CTE
 *    récursive d'une profondeur pathologique. Voir MAX_FOLDER_DEPTH en tête de
 *    fichier.
 */

/**
 * Charge l'arborescence complète d'une organisation, avec chemin et profondeur.
 *
 * La CTE récursive descend depuis les racines. `path_ids` sert aux garde-fous
 * anti-cycle et au filtrage par descendance ; `path` est le libellé affiché.
 *
 * Le tri par `path_labels` (et non par nom) est ce qui produit l'ordre naturel
 * d'un explorateur de fichiers : chaque dossier apparaît immédiatement après son
 * parent, et non regroupé avec les autres dossiers de même niveau.
 */
async function chargerArborescence(tenantId) {
  const { rows } = await db.query(
    `WITH RECURSIVE arbre AS (
       SELECT f.id, f.parent_id, f.name, f.created_by, f.created_at,
              0 AS depth,
              ARRAY[f.id] AS path_ids,
              ARRAY[f.name]::text[] AS path_labels
       FROM document_folders f
       WHERE f.tenant_id = $1 AND f.parent_id IS NULL
       UNION ALL
       SELECT e.id, e.parent_id, e.name, e.created_by, e.created_at,
              a.depth + 1,
              a.path_ids || e.id,
              a.path_labels || e.name
       FROM document_folders e
       JOIN arbre a ON e.parent_id = a.id
       -- Deux rôles pour cette clause, et une borne à ne pas décaler.
       --
       -- La comparaison porte sur a.depth + 1, c'est-à-dire la profondeur DE
       -- L'ENFANT, celle que le SELECT ci-dessus calcule. Bornée sur a.depth
       -- seul, la lecture remonterait un niveau de plus que validerParent()
       -- n'autorise à en créer : la limite annoncée à l'utilisateur
       -- (« 10 niveaux ») serait fausse en lecture et vraie en écriture.
       --
       -- Le second rôle est l'arrêt : même en présence d'un cycle en base
       -- (donnée héritée), la récursion se termine.
       WHERE e.tenant_id = $1 AND a.depth + 1 < $2 AND NOT (e.id = ANY(a.path_ids))
     )
     SELECT a.*,
            array_to_string(a.path_labels, ' / ') AS path,
            (SELECT COUNT(*) FROM documents d
              WHERE d.dossier_id = a.id AND d.tenant_id = $1)::int AS doc_count,
            (SELECT COUNT(*) FROM document_folders c
              WHERE c.parent_id = a.id AND c.tenant_id = $1)::int AS child_count
     FROM arbre a
     ORDER BY a.path_labels`,
    [tenantId, MAX_FOLDER_DEPTH]
  );
  return rows;
}

/**
 * Dossiers rattachés à un parent hors arborescence atteignable.
 *
 * Un `parent_id` pointant vers un dossier supprimé passe en NULL (ON DELETE SET
 * NULL) et remonte donc à la racine — c'est traité. Restent les données héritées
 * d'avant ces garde-fous : parent d'une autre organisation, ou cycle. La CTE ne
 * les atteint jamais, et ils resteraient invisibles indéfiniment. On les
 * rattache visuellement à la racine plutôt que de les taire.
 */
function rattacherOrphelins(arbre, toutes, tenantId) {
  const atteints = new Set(arbre.map((f) => f.id));
  return toutes
    .filter((f) => !atteints.has(f.id))
    .map((f) => ({
      ...f,
      // parent_id remis à null pour l'affichage seulement : la base n'est pas
      // modifiée à la lecture. Le drapeau permet à l'interface de le signaler.
      parent_id: null,
      depth: 0,
      path_ids: [f.id],
      path: f.name,
      orphelin: true,
      doc_count: 0,
      child_count: 0,
    }));
}

exports.listFolders = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    // PÉRIMÈTRE (ACL) : l'arborescence ne montre que les dossiers accessibles
    // — un dossier restreint invisible n'apparaît ni dans l'arbre ni dans les
    // filtres. La restriction protège, elle n'annonce pas. Le filtrage est
    // post-arbre (chargerArborescence reste la référence de forme) : on retire
    // les nœuds invisibles en conservant leurs parents visibles.
    const { visibles, restreints } = await aclService.dossiersAccessibles(tenantId, req.user.id);

    const arbre = await chargerArborescence(tenantId);

    // Un dossier présent en base mais absent de l'arbre signale une donnée
    // héritée incohérente. Le comparatif coûte une requête simple et évite un
    // dossier définitivement introuvable dans l'interface.
    const toutes = await db.query(
      `SELECT f.id, f.parent_id, f.name, f.created_by, f.created_at
       FROM document_folders f WHERE f.tenant_id = $1`,
      [tenantId]
    );
    const orphelins = rattacherOrphelins(arbre, toutes.rows, tenantId);
    if (orphelins.length) {
      console.warn(`[dossiers] ${orphelins.length} dossier(s) hors arborescence pour l'organisation ${tenantId}`);
    }

    // Marquer puis retirer : `restricted` couvre l'héritage (le sous-dossier
    // d'un dossier restreint l'est aussi), l'indicateur s'adresse à
    // l'interface ; les invisibles disparaissent, parents visibles conservés.
    // Un échec de résolution (échec fermé) vide `visibles` : plus rien ne
    // passe, y compris les racines ouvertes — préférable à tout montrer.
    const marquer = (noeud) => {
      const enfantsFiltres = (noeud.children || []).map(marquer).filter(Boolean);
      if (!visibles.has(noeud.id)) return null;
      return { ...noeud, restricted: restreints.has(noeud.id) || undefined, children: enfantsFiltres };
    };

    const arbreFiltre = [...arbre, ...orphelins].map(marquer).filter(Boolean);
    res.json(arbreFiltre);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du chargement des dossiers' });
  }
};

/**
 * Valide un parent proposé : appartenance à l'organisation et profondeur.
 * @returns {Promise<{erreur?: string, parentId: number|null}>}
 */
async function validerParent(tenantId, parentIdBrut) {
  if (parentIdBrut === undefined || parentIdBrut === null || parentIdBrut === '') {
    return { parentId: null };
  }
  const parentId = Number(parentIdBrut);
  if (!Number.isInteger(parentId) || parentId <= 0) {
    return { erreur: 'Dossier parent invalide' };
  }
  // Le filtre tenant_id est le cœur du contrôle : sans lui, l'appelant
  // rattacherait son dossier sous celui d'une autre organisation.
  const { rows } = await db.query(
    'SELECT id FROM document_folders WHERE id = $1 AND tenant_id = $2',
    [parentId, tenantId]
  );
  if (!rows.length) return { erreur: 'Dossier parent introuvable' };

  const arbre = await chargerArborescence(tenantId);
  const parent = arbre.find((f) => f.id === parentId);
  if (parent && parent.depth + 1 >= MAX_FOLDER_DEPTH) {
    return { erreur: `Profondeur maximale atteinte (${MAX_FOLDER_DEPTH} niveaux)` };
  }
  return { parentId };
}

exports.createFolder = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { name, parent_id } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: 'Nom du dossier requis' });
  }
  try {
    const { erreur, parentId } = await validerParent(tenantId, parent_id);
    if (erreur) return res.status(400).json({ message: erreur });

    // PÉRIMÈTRE (ACL) : créer un sous-dossier exige 'write' sur le parent —
    // sinon n'importe qui pourrait ouvrir une branche dans un espace restreint
    // et y verser des documents. À la racine, la permission folders.create
    // (RBAC, déjà passée) suffit : la racine n'est le sous-arbre de personne.
    if (parentId != null && !(await aclService.peutEcrire(tenantId, req.user.id, parentId))) {
      return res.status(403).json({
        message: "Ce dossier parent est hors de votre périmètre d'écriture.",
        code: 'HORS_PERIMETRE',
      });
    }

    const result = await tenantDb.insert(
      tenantId,
      'document_folders',
      ['name', 'parent_id', 'created_by'],
      [String(name).trim(), parentId, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la création du dossier' });
  }
};

/**
 * Renomme et/ou déplace un dossier.
 *
 * Le déplacement passe par la même route que le renommage : côté client, glisser
 * un dossier sur un autre et le renommer sont deux modifications du même objet.
 * `parent_id` n'est traité que s'il est explicitement présent dans le corps —
 * sinon un simple renommage remonterait le dossier à la racine.
 */
exports.renameFolder = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { name, parent_id } = req.body;
  const deplacement = Object.prototype.hasOwnProperty.call(req.body, 'parent_id');

  // Sans cette validation, un nom vide était accepté : le dossier restait dans
  // la base mais devenait invisible dans toute liste triée par nom.
  if (name !== undefined && !String(name || '').trim()) {
    return res.status(400).json({ message: 'Nom du dossier requis' });
  }
  if (name === undefined && !deplacement) {
    return res.status(400).json({ message: 'Aucune modification demandée' });
  }

  try {
    const dossierId = Number(id);
    const champs = [];
    const vals = [];

    // PÉRIMÈTRE (ACL) : renommer ou déplacer un dossier restreint exige
    // 'write' sur lui — un dossier libre suit le RBAC seul (folders.edit /
    // folders.move, déjà vérifiées par la route).
    if (!(await aclService.peutEcrire(tenantId, req.user.id, dossierId))) {
      return res.status(403).json({ message: "Ce dossier est hors de votre périmètre d'écriture.", code: 'HORS_PERIMETRE' });
    }

    if (name !== undefined) {
      vals.push(String(name).trim());
      champs.push(`name = $${vals.length}`);
    }

    if (deplacement) {
      const { erreur, parentId } = await validerParent(tenantId, parent_id);
      if (erreur) return res.status(400).json({ message: erreur });

      // PÉRIMÈTRE (ACL) : déplacer une branche sous un parent restreint
      // exige 'write' sur le parent d'accueil — mêmes règles que la création
      // d'un sous-dossier.
      if (parentId !== null && !(await aclService.peutEcrire(tenantId, req.user.id, parentId))) {
        return res.status(403).json({ message: "Le dossier de destination est hors de votre périmètre d'écriture.", code: 'HORS_PERIMETRE' });
      }

      if (parentId === dossierId) {
        return res.status(400).json({ message: 'Un dossier ne peut pas être son propre parent' });
      }
      if (parentId !== null) {
        // Le garde-fou décisif. Déplacer un dossier sous l'un de ses propres
        // descendants détache la branche entière de la racine : les dossiers
        // subsistent en base mais aucune descente récursive ne les atteint, donc
        // ils disparaissent de l'interface sans le moindre message.
        const arbre = await chargerArborescence(tenantId);
        const cible = arbre.find((f) => f.id === parentId);
        if (cible && (cible.path_ids || []).includes(dossierId)) {
          return res.status(400).json({
            message: 'Déplacement impossible : le dossier de destination est l\'un de ses sous-dossiers',
          });
        }
        // La profondeur se vérifie sur la BRANCHE déplacée, pas sur le seul
        // dossier : déplacer une branche de trois niveaux sous un dossier déjà
        // profond dépasserait la borne sans que ce contrôle la voie.
        const noeud = arbre.find((f) => f.id === dossierId);
        if (noeud && cible) {
          const hauteurBranche = arbre
            .filter((f) => (f.path_ids || []).includes(dossierId))
            .reduce((max, f) => Math.max(max, f.depth - noeud.depth), 0);
          if (cible.depth + 1 + hauteurBranche >= MAX_FOLDER_DEPTH) {
            return res.status(400).json({
              message: `Profondeur maximale atteinte (${MAX_FOLDER_DEPTH} niveaux)`,
            });
          }
        }
      }
      vals.push(parentId);
      champs.push(`parent_id = $${vals.length}`);
    }

    vals.push(dossierId);
    const result = await tenantDb.query(
      tenantId,
      `UPDATE document_folders SET ${champs.join(', ')} WHERE id = $${vals.length}`,
      vals
    );
    if (!result.rowCount) return res.status(404).json({ message: 'Dossier non trouvé' });
    res.json({ message: deplacement && name === undefined ? 'Dossier déplacé' : 'Dossier renommé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la modification du dossier' });
  }
};

exports.deleteFolder = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const recursif = req.query.recursif === 'true' || req.query.recursif === '1';
  try {
    const dossierId = Number(id);
    const arbre = await chargerArborescence(tenantId);
    const noeud = arbre.find((f) => f.id === dossierId);

    // La branche complète, dossier compris. `path_ids` la donne sans nouvelle
    // requête récursive.
    const branche = arbre.filter((f) => (f.path_ids || []).includes(dossierId));
    const descendants = branche.filter((f) => f.id !== dossierId);

    // PÉRIMÈTRE (ACL) : supprimer un dossier restreint dissout son périmètre
    // — ses documents sont déclassés à la racine (ON DELETE SET NULL), donc
    // rendus à tous. Ce geste d'administration exige 'manage' sur le dossier,
    // direct ou hérité d'un manage au-dessus. Un dossier libre suit le RBAC
    // seul (folders.delete, déjà vérifiée par la route).
    if (noeud && !(await aclService.peutGerer(tenantId, req.user.id, dossierId))) {
      return res.status(403).json({
        message: 'Supprimer ce dossier dissoudrait un périmètre restreint — seuls ses gestionnaires peuvent le faire.',
        code: 'HORS_PERIMETRE',
      });
    }

    // Un dossier qui contient des sous-dossiers n'est pas supprimé par accident.
    // `parent_id` est en ON DELETE SET NULL : les enfants remonteraient
    // silencieusement à la racine, ce qui ressemble à une perte de classement
    // alors qu'ils sont simplement déplacés. On exige donc un choix explicite.
    if (noeud && descendants.length && !recursif) {
      return res.status(409).json({
        message: `Ce dossier contient ${descendants.length} sous-dossier(s).`,
        sous_dossiers: descendants.length,
        // L'interface propose alors les deux options en toute connaissance.
        options: ['recursif', 'annuler'],
      });
    }

    const ids = recursif ? branche.map((f) => f.id) : [dossierId];

    // `documents.dossier_id` est en ON DELETE SET NULL : la suppression déclasse
    // les documents au lieu de les détruire. On renvoie leur nombre pour que
    // l'interface puisse le dire, et un 404 franc si le dossier n'existe pas —
    // auparavant une suppression sans effet répondait « Dossier supprimé ».
    const countRes = await db.query(
      'SELECT COUNT(*)::int AS n FROM documents WHERE dossier_id = ANY($1::int[]) AND tenant_id = $2',
      [ids, tenantId]
    );
    // Le filtre tenant_id porte sur le DELETE lui-même : `ids` vient de l'arbre
    // de cette organisation, mais la contrainte doit rester dans la requête et
    // ne pas dépendre de la correction du calcul en amont.
    const result = await db.query(
      'DELETE FROM document_folders WHERE id = ANY($1::int[]) AND tenant_id = $2',
      [ids, tenantId]
    );
    if (!result.rowCount) return res.status(404).json({ message: 'Dossier non trouvé' });
    res.json({
      message: result.rowCount > 1 ? `${result.rowCount} dossiers supprimés` : 'Dossier supprimé',
      dossiers_supprimes: result.rowCount,
      documents_declasses: countRes.rows[0]?.n || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la suppression du dossier' });
  }
};

/* ===== Périmètres d'accès par dossier (ACL) ===== */

// Le sujet d'une ACL doit exister dans l'organisation. Une ACL posée sur un
// identifiant étranger serait inerte (aucun utilisateur du tenant n'y
// correspond jamais) mais polluerait l'administration — et une ACL « role »
// sur une clé inconnue afficherait un sujet fantôme.
async function sujetExiste(tenantId, subject_type, subject_id) {
  if (subject_type === 'user') {
    const { rows } = await db.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [Number(subject_id), tenantId]);
    return rows.length > 0;
  }
  if (subject_type === 'group') {
    const { rows } = await db.query('SELECT 1 FROM groups WHERE id = $1 AND tenant_id = $2', [Number(subject_id), tenantId]);
    return rows.length > 0;
  }
  if (subject_type === 'role') {
    // Les rôles système vivent dans le catalogue, les personnalisés en base.
    if (ROLES_SYSTEME.some((r) => r.key === String(subject_id))) return true;
    const { rows } = await db.query('SELECT 1 FROM roles WHERE key = $1 AND tenant_id = $2', [String(subject_id), tenantId]);
    return rows.length > 0;
  }
  return false;
}

// Le dossier visé existe-t-il dans CE tenant ? — une réponse 404 franche
// plutôt qu'une erreur SQL sur la clé étrangère.
async function dossierDuTenant(tenantId, folderId) {
  const { rows } = await db.query('SELECT id FROM document_folders WHERE id = $1 AND tenant_id = $2', [folderId, tenantId]);
  return rows.length > 0;
}

/** GET /folders/:id/acls — la liste des accès posés sur un dossier. */
exports.listFolderAcls = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const folderId = Number(req.params.id);
  try {
    if (!(await dossierDuTenant(tenantId, folderId))) {
      return res.status(404).json({ message: 'Dossier non trouvé' });
    }
    // Consulter les ACL d'un dossier restreint annonce QUI y entre — cela
    // se mérite : 'manage' sur le dossier (un dossier libre suit la
    // permission folders.manage_permissions, déjà passée par la route).
    if (!(await aclService.peutGerer(tenantId, req.user.id, folderId))) {
      return res.status(403).json({ message: 'Seuls les gestionnaires du périmètre peuvent consulter ses accès.', code: 'HORS_PERIMETRE' });
    }
    const acls = await aclService.listAcls(tenantId, folderId);
    res.json({ acls, restreint: acls.length > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du chargement des accès du dossier' });
  }
};

/**
 * POST /folders/:id/acls — poser un accès { subject_type, subject_id, level }.
 * Poser la PREMIÈRE ACL d'un dossier restreint tout son sous-arbre : la
 * réponse le dit, l'interface doit l'annoncer avant le geste (pas après).
 */
exports.setFolderAcl = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const folderId = Number(req.params.id);
  const { subject_type, subject_id, level } = req.body;
  try {
    if (!(await dossierDuTenant(tenantId, folderId))) {
      return res.status(404).json({ message: 'Dossier non trouvé' });
    }
    if (!(await aclService.peutGerer(tenantId, req.user.id, folderId))) {
      return res.status(403).json({ message: 'Seuls les gestionnaires du périmètre peuvent modifier ses accès.', code: 'HORS_PERIMETRE' });
    }
    if (!(await sujetExiste(tenantId, subject_type, subject_id))) {
      return res.status(400).json({ message: 'Sujet introuvable dans votre organisation.' });
    }
    const premiere = !(await aclService.dossierRestreint(tenantId, folderId));
    await aclService.setAcl(tenantId, folderId, { subject_type, subject_id, level }, req.user.id);
    res.status(201).json({
      message: premiere
        ? 'Accès posé — le dossier et tout son sous-arbre deviennent RESTREINTS : seuls les sujets déclarés y accèdent.'
        : 'Accès mis à jour.',
      restreint: true,
      premiere_acl: premiere,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la pose de l\'accès' });
  }
};

/** DELETE /folders/:id/acls/:subjectType/:subjectId — retirer un accès. */
exports.deleteFolderAcl = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const folderId = Number(req.params.id);
  const { subjectType, subjectId } = req.params;
  try {
    if (!(await dossierDuTenant(tenantId, folderId))) {
      return res.status(404).json({ message: 'Dossier non trouvé' });
    }
    if (!(await aclService.peutGerer(tenantId, req.user.id, folderId))) {
      return res.status(403).json({ message: 'Seuls les gestionnaires du périmètre peuvent modifier ses accès.', code: 'HORS_PERIMETRE' });
    }
    const supprime = await aclService.removeAcl(tenantId, folderId, subjectType, subjectId);
    if (!supprime) return res.status(404).json({ message: 'Cet accès n\'existe pas sur ce dossier.' });
    const restreint = await aclService.dossierRestreint(tenantId, folderId);
    res.json({
      message: restreint
        ? 'Accès retiré.'
        : 'Dernier accès retiré — le dossier redevient accessible aux porteurs des permissions GED.',
      restreint,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du retrait de l\'accès' });
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
      'SELECT id, reference_mfile, nom_entreprise, num_dossier, num_acte, type_document, annee, dossier_id FROM documents WHERE id = $1',
      [id]
    );
    const doc = docRes.rows[0];
    if (!doc) return res.status(404).json({ message: 'Document non trouvé' });

    // PÉRIMÈTRE (ACL) : le partage annonce le document (référence, entreprise,
    // numéros) hors de la plateforme — la lecture du dossier doit être acquise.
    if (!(await aclService.peutLire(tenantId, req.user.id, doc.dossier_id))) {
      return res.status(403).json({ message: "Ce document appartient à un dossier hors de votre périmètre.", code: 'HORS_PERIMETRE' });
    }

    const { sendMail, loadBranding } = require('../services/mailService');
    // escapeHtml is already defined at module scope above (see TAG SANITISATION section)
    // Deux traitements distincts pour la même donnée : `escapeHtml` pour le corps
    // HTML, `sanitizeHeader` pour le sujet. Échapper le HTML dans un sujet y
    // afficherait « O&#39;Brien » au lieu de « O'Brien » — le sujet n'est pas du
    // HTML, seuls les retours chariot y sont dangereux.
    const rawSenderName = req.user.full_name || req.user.username;
    const senderName = escapeHtml(rawSenderName);

    // Habillage de l'organisation chargé une seule fois pour tout le lot.
    const branding = await loadBranding(tenantId);
    const platformName = escapeHtml(branding.siteName || 'DocuFlow');

    // On itère sur les adresses nettoyées et déjà validées, pas sur le tableau
    // brut : `emails` peut contenir des espaces de part et d'autre.
    let sent = 0;
    let skipped = 0;
    for (const email of cleaned) {
      try {
        const result = await sendMail({
          to: email,
          tenantId,
          event: 'share',
          branding,
          subject: sanitizeHeader(`📄 ${rawSenderName} vous partage un document — ${doc.reference_mfile}`),
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
              <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:24px;">Connectez-vous à ${platformName} pour consulter et télécharger ce document.</p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
              <p style="color:#cbd5e1;font-size:11px;text-align:center;margin:0;">© ${new Date().getFullYear()} ${platformName} — Plateforme de gestion documentaire</p>
            </div>`
        });
        if (result?.sent) sent++;
        else skipped++;
      } catch (mailErr) {
        skipped++;
        console.error(`[share] Erreur envoi à ${email}:`, mailErr.message);
      }
    }

    await logHistory(tenantId, doc.id, req.user.id, `Document partagé avec ${cleaned.length} personne(s)`, null, null);

    // La réponse dit ce qui s'est réellement passé. Annoncer un partage réussi
    // alors que les notifications sont désactivées, ou que Resend a refusé les
    // envois, laisserait l'utilisateur attendre un e-mail qui n'arrivera jamais.
    if (sent === 0) {
      return res.json({
        message: branding.emailsEnabled
          ? 'Aucun e-mail n\'a pu être envoyé — vérifiez la configuration de la messagerie'
          : 'Les notifications par e-mail sont désactivées dans la configuration — aucun e-mail envoyé',
        sent: 0,
        skipped,
      });
    }
    res.json({
      message: skipped > 0
        ? `Document partagé avec ${sent} personne(s) — ${skipped} envoi(s) non abouti(s)`
        : `Document partagé avec ${sent} personne(s)`,
      sent,
      skipped,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du partage du document' });
  }
};

/* ===== Verrouillage pour édition (check-out / check-in) ===== */

exports.checkoutDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;
  const { id } = req.params;

  try {
    // Cycle de vie : corbeille et archivé ne se verrouillent pas.
    const verrou = await chargerPourEcriture(tenantId, id, req.user);
    if (verrou) return res.status(verrou.statut).json({ message: verrou.message, code: verrou.code });

    // VERROU ATOMIQUE. L'ancienne séquence lisait puis écrivait sans condition :
    // deux utilisateurs cliquant à ~100 ms d'écart voyaient tous deux
    // « non verrouillé », et leurs deux UPDATE passaient — le second écrasait
    // le détenteur du premier, qui croyait tenir le verrou et modifiait « sous »
    // l'autre. Le verrou porté par la clause WHERE, c'est la BASE qui arbitre :
    // un seul gagne, l'autre reçoit 409.
    //
    // db.query DIRECT : l'auto-filtre de tenantDb colle sa condition APRÈS le
    // RETURNING (il ne connaît que ORDER BY/LIMIT/GROUP BY/HAVING), ce qui
    // détruit la requête — « l'argument de AND doit être boolean ». Le périmètre
    // est déjà porté par la clause WHERE qualifiée.
    const resultat = await db.query(
      `UPDATE documents
          SET is_checked_out = TRUE, checked_out_by = $1, checked_out_at = NOW()
        WHERE id = $2 AND tenant_id = $3 AND is_checked_out = FALSE
        RETURNING id`,
      [userId, id, tenantId]
    );
    if (!resultat.rowCount) {
      return res.status(409).json({ message: 'Ce document est actuellement verrouillé par un autre utilisateur', code: 'VERROUILLE' });
    }

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
      'SELECT id, is_checked_out, checked_out_by, dossier_id FROM documents WHERE id = $1',
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

    // PÉRIMÈTRE (ACL) : le check-in clôt une écriture — si le périmètre du
    // dossier s'est resserré pendant l'édition, le détenteur du verrou ne
    // le libère pas ; un administrateur reste le recours.
    if (!(await aclService.peutEcrire(tenantId, userId, doc.dossier_id))) {
      return res.status(403).json({ message: "Ce document appartient à un dossier hors de votre périmètre d'écriture.", code: 'HORS_PERIMETRE' });
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

/* ===== Vues dynamiques ===== */

exports.getDynamicViews = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    // db.query DIRECT, pas tenantDb : l'auto-filtre de tenantDb injecte un
    // « tenant_id = $N » NON QUALIFIÉ, ambigu dès que la requête joint deux
    // tables porteuses de cette colonne (dynamic_views et users ici) —
    // « la référence à la colonne tenant_id est ambigüe », 500 sur chaque
    // ouverture des vues dynamiques. Le périmètre est déjà porté par la clause
    // WHERE qualifiée ci-dessous.
    const result = await db.query(
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
 * Regroupement dynamique des documents par métadonnée.
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
    // Conditions préfixées « d. » : la requête joint désormais document_files,
    // et une colonne comme `tenant_id` ou `annee` non qualifiée serait ambiguë
    // ou, pire, résolue sur la mauvaise table.
    const conds = ['d.tenant_id = $1'];
    for (const [key, kind] of Object.entries(ALLOWED_FILTERS)) {
      const raw = filters[key];
      if (raw === undefined || raw === null || raw === '') continue;
      if (kind === 'int') {
        const n = Number(raw);
        if (!Number.isFinite(n)) continue; // filtre illisible : ignoré, pas d'erreur 500
        vals.push(n);
        conds.push(`d.${key} = $${vals.length}`);
      } else if (kind === 'ilike') {
        vals.push(`%${String(raw)}%`);
        conds.push(`d.${key} ILIKE $${vals.length}`);
      } else {
        vals.push(String(raw));
        conds.push(`d.${key} = $${vals.length}`);
      }
    }

    // PÉRIMÈTRE (ACL) : la vue dynamique EST une liste de documents — même
    // bornage que la liste principale : dossiers lisibles, et non classés.
    const { lisibles } = await aclService.dossiersAccessibles(tenantId, req.user.id);
    conds.push(`(d.dossier_id IS NULL OR d.dossier_id = ANY($${vals.length + 1}::int[]))`);
    vals.push([...lisibles]);

    // L'aperçu exige les données du fichier le plus récent de chaque document.
    // DISTINCT ON les récupère en une passe, sans sous-requête corrélée par
    // ligne : sur une vue qui regroupe plusieurs milliers de documents, la
    // différence se voit à l'écran.
    //
    // La jointure est LEFT : un document non numérisé (fiche saisie sans
    // fichier) doit rester présent dans son groupe. Un INNER JOIN le ferait
    // disparaître de la vue, et le total affiché ne correspondrait plus au
    // nombre réel de documents.
    const construireRequete = (avecFichiers) => `
      ${avecFichiers ? `WITH dernier_fichier AS (
        SELECT DISTINCT ON (df.document_id)
               df.document_id, df.stored_name, df.secure_url,
               df.cloudinary_public_id, df.mime_type, df.original_name, df.version
        FROM document_files df
        ORDER BY df.document_id, df.version DESC, df.id DESC
      )` : ''}
      SELECT COALESCE(d.${groupField}::text, '${UNCLASSIFIED_GROUP}') as group_name,
             COUNT(*)::int as count,
             JSON_AGG(JSON_BUILD_OBJECT(
               'id', d.id,
               'reference_mfile', d.reference_mfile,
               'num_dossier', d.num_dossier,
               'num_acte', d.num_acte,
               'nom_entreprise', d.nom_entreprise,
               'type_document', d.type_document,
               'annee', d.annee,
               'statut', d.statut,
               'auteur', d.auteur,
               'is_checked_out', d.is_checked_out,
               'checked_out_by', d.checked_out_by${avecFichiers ? `,
               'stored_name', f.stored_name,
               'secure_url', f.secure_url,
               'cloudinary_public_id', f.cloudinary_public_id,
               'mime_type', f.mime_type,
               'original_name', f.original_name,
               'file_version', f.version` : ''}
             ) ORDER BY d.created_at DESC) as documents
      FROM documents d
      ${avecFichiers ? 'LEFT JOIN dernier_fichier f ON f.document_id = d.id' : ''}
      WHERE ${conds.join(' AND ')}
      GROUP BY d.${groupField}
      ORDER BY count DESC
    `;

    let result;
    try {
      result = await db.query(construireRequete(true), vals);
    } catch (err) {
      // `document_files` absente (base antérieure à la migration 004) : la vue
      // doit perdre l'aperçu, pas les documents. Sans ce repli, le catch 42P01
      // plus bas renverrait zéro groupe et l'archiviste verrait une
      // bibliothèque vide alors que ses documents sont bien là.
      if (err.code !== '42P01') throw err;
      result = await db.query(construireRequete(false), vals);
    }
    // L'URL est calculée ici, jamais côté interface : elle est relative en mode
    // bureau (le port change à chaque lancement) et absolue en mode hébergé.
    // Voir helpers/publicUrl.js — la règle n'a qu'un seul domicile.
    //
    // Le garde-fou couvre les trois sources que fileUrl sait exploiter. Sans
    // lui, un document non numérisé (LEFT JOIN sans correspondance) produirait
    // une URL vers /uploads/files/null : la vignette tenterait un chargement
    // voué à l'échec au lieu d'afficher « Non numérisé ».
    const groups = result.rows.map((groupe) => ({
      ...groupe,
      documents: (groupe.documents || []).map((doc) => ({
        ...doc,
        apercu_url: (doc.secure_url || doc.cloudinary_public_id || doc.stored_name)
          ? storage.fileUrl(req, doc)
          : null,
      })),
    }));
    // Le champ de regroupement est renvoyé avec les groupes : en mode `view_id`,
    // c'est la seule façon pour l'interface de savoir sur quelle métadonnée un
    // glisser-déposer doit agir.
    res.json({ group_by_field: groupField, groups });
  } catch (err) {
    if (err.code === '42P01') return res.json({ group_by_field: 'type_document', groups: [] });
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du calcul de la vue dynamique' });
  }
};

/* ===== Assemblage de dossier et relations ===== */

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
    // PÉRIMÈTRE (ACL) : les métadonnées complètent la fiche — même périmètre
    // de lecture qu'elle.
    const refus = await gardePerimetreDocument(tenantId, req.user.id, id, 'read');
    if (refus) return res.status(refus.statut).json({ message: refus.message, code: refus.code });

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
    // PÉRIMÈTRE (ACL) : l'indexation écrit dans la fiche — même garde que la
    // correction de fiche, sans la sémantique de verrou (elle porte les
    // fichiers, pas les métadonnées).
    const refusMeta = await gardePerimetreDocument(tenantId, req.user.id, id, 'write');
    if (refusMeta) return res.status(refusMeta.statut).json({ message: refusMeta.message, code: refusMeta.code });

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
    // PÉRIMÈTRE (ACL) : le journal détaille les gestes sur le document —
    // même périmètre de lecture que la fiche.
    const refus = await gardePerimetreDocument(tenantId, req.user.id, id, 'read');
    if (refus) return res.status(refus.statut).json({ message: refus.message, code: refus.code });

    const audit = await documentAuditService.getAuditForDocument(tenantId, parseInt(id, 10));
    res.json(audit);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération de l\'audit' });
  }
};

// Réciproque du lien demandes ↔ documents : la fiche document SAIT quelles
// demandes lui ont donné naissance ou s'appuient sur lui — impossible avant la
// migration 021 (le lien ne remontait que demande → document).
exports.getDocumentRequests = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  try {
    // PÉRIMÈTRE (ACL) : la réciproque du lien demandes ↔ documents complète
    // la fiche — même périmètre de lecture.
    const refus = await gardePerimetreDocument(tenantId, req.user.id, id, 'read');
    if (refus) return res.status(refus.statut).json({ message: refus.message, code: refus.code });

    const { rows } = await db.query(
      `SELECT r.id, r.statut, r.type_document, r.nom_entreprise, r.num_dossier, r.num_acte,
              r.created_at, u.full_name AS demandeur_name,
              rd.link_type, rd.created_at AS lie_le
         FROM request_documents rd
         JOIN requests r ON r.id = rd.request_id AND r.tenant_id = $1
         LEFT JOIN users u ON u.id = r.id_user
        WHERE rd.document_id = $2
        ORDER BY rd.created_at DESC`,
      [tenantId, id]
    );
    res.json(rows);
  } catch (err) {
    // Pré-migration 021 : la jointure n'existe pas — vide plutôt qu'erreur,
    // pour une donnée qui complète la fiche sans la constituer.
    if (err.code === '42P01') return res.json([]);
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des demandes liées' });
  }
};

exports.getDocumentRelations = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  try {
    // PÉRIMÈTRE (ACL) : les relations décrivent le document — même périmètre
    // de lecture que la fiche.
    const refus = await gardePerimetreDocument(tenantId, req.user.id, id, 'read');
    if (refus) return res.status(refus.statut).json({ message: refus.message, code: refus.code });

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
    // PÉRIMÈTRE (ACL) : lier deux documents écrit dans la fiche source —
    // même périmètre d'écriture.
    const refus = await gardePerimetreDocument(tenantId, req.user.id, id, 'write');
    if (refus) return res.status(refus.statut).json({ message: refus.message, code: refus.code });

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

