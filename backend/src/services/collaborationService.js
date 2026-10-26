// ============================================================================
// collaborationService — travailler à plusieurs autour d'un document
// (migration 033).
//
//   FAVORIS      étoile personnelle, page « Mes favoris ». Aucun droit ouvert :
//                la liste est bornée au périmètre (ACL) de l'utilisateur.
//   SUIVI        abonnement à un document ; notifierAbonnes() prévient les
//                abonnés d'un geste (version, statut, fiche, commentaire, gel,
//                restauration), jamais son auteur. Suivi automatique du
//                créateur (trigger 033) et de qui commente ; un désabonnement
//                explicite est mémorisé et respecté.
//   COMMENTAIRES fil plat, réponses sur un niveau, mentions @identifiant ;
//                seul l'auteur modifie ou supprime (pierre tombale, contenu
//                effacé). Journal : le geste, jamais le texte.
//
// Les notifications ne font JAMAIS échouer l'action métier : toute erreur est
// avalée et journalisée en console (notifierAbonnes ne lève pas).
// ============================================================================
const db = require('../config/db');
const aclService = require('./aclService');
const roleService = require('./roleService');
const documentAuditService = require('./documentAuditService');
const integrite = require('./integriteService');

const COMMENTAIRE_MAX = 5000;

const erreur = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

// La migration 033 est-elle passée ? Même précaution que integriteService :
// vérifié une fois, une requête en échec dans une transaction l'annulerait.
let migrationPromesse = null;
function migrationPassee() {
  if (!migrationPromesse) {
    migrationPromesse = db.query("SELECT to_regclass('document_abonnements') IS NOT NULL AND to_regclass('document_partages') IS NOT NULL AS ok")
      .then((r) => r.rows[0].ok).catch(() => { migrationPromesse = null; return false; });
  }
  return migrationPromesse;
}

// La colonne d'élimination (documents.elimine_at) appartient à un autre
// chantier : elle est lue si elle existe, sans jamais faire échouer la requête.
let eliminationPromesse = null;
function colonneElimination() {
  if (!eliminationPromesse) {
    eliminationPromesse = db.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'elimine_at') AS ok"
    ).then((r) => r.rows[0].ok).catch(() => { eliminationPromesse = null; return false; });
  }
  return eliminationPromesse;
}
/** Fragment SQL « document non éliminé » (alias d), vide si la colonne n'existe pas. */
async function filtreNonElimine(alias = 'd') {
  return (await colonneElimination()) ? ` AND ${alias}.elimine_at IS NULL` : '';
}

// -------------------------------------------------------------- destinataires

/** Libellé d'un document dans un message : « DOC-60-12 — SOBEBRA ». */
const libelleDocument = (d) => [d.reference_mfile, d.nom_entreprise].filter(Boolean).join(' — ') || `document ${d.id}`;

async function chargerDocument(tenantId, documentId) {
  const { rows } = await db.query(
    'SELECT id, reference_mfile, nom_entreprise, dossier_id, deleted_at FROM documents WHERE id = $1 AND tenant_id = $2',
    [documentId, tenantId]
  );
  return rows[0] || null;
}

/**
 * Parmi des utilisateurs, ceux qui peuvent LIRE le document : permission
 * documents.view (rôle actif) et lecture du dossier (ACL). Une notification
 * ou une mention ne doit jamais annoncer un document hors périmètre.
 */
async function lecteursAutorises(tenantId, document, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return [];
  const { rows } = await db.query('SELECT id, role FROM users WHERE tenant_id = $1 AND id = ANY($2::int[])', [tenantId, ids]);
  const retenus = [];
  for (const u of rows) {
    if (!(await roleService.possede(tenantId, u.role, 'documents.view'))) continue;
    if (!(await aclService.peutLire(tenantId, u.id, document.dossier_id))) continue;
    retenus.push(u.id);
  }
  return retenus;
}

async function inscrireNotifications(tenantId, documentId, userIds, { titre, message, type }) {
  if (!userIds.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO notifications (id_user, title, message, type, tenant_id, document_id)
     SELECT u, $2, $3, $4, $5, $6 FROM unnest($1::int[]) AS u`,
    [userIds, String(titre).slice(0, 255), message, type, tenantId, documentId]
  );
  return rowCount;
}

/**
 * Notifie les abonnés d'un document (suivi actif, accès vérifié à l'envoi).
 * Ne lève jamais : renvoie le nombre de notifications écrites (0 en cas d'échec).
 * @param {object} opts { titre, message, exclureUserId, exclureUserIds, type }
 */
async function notifierAbonnes(tenantId, documentId, { titre, message, exclureUserId = null, exclureUserIds = [], type = 'suivi' } = {}) {
  try {
    if (!(await migrationPassee())) return 0;
    const document = await chargerDocument(tenantId, documentId);
    if (!document || document.deleted_at) return 0;
    const exclus = new Set([exclureUserId, ...exclureUserIds].filter((x) => x != null).map(Number));
    const { rows } = await db.query(
      'SELECT user_id FROM document_abonnements WHERE tenant_id = $1 AND document_id = $2 AND suivi',
      [tenantId, documentId]
    );
    const candidats = rows.map((r) => r.user_id).filter((id) => !exclus.has(Number(id)));
    const destinataires = await lecteursAutorises(tenantId, document, candidats);
    return await inscrireNotifications(tenantId, documentId, destinataires, { titre, message, type });
  } catch (err) {
    console.warn(`[collaboration] notification des abonnés du document ${documentId} impossible : ${err.message}`);
    return 0;
  }
}

/**
 * Libellés des événements suivis. Chaque entrée reçoit (nom de l'acteur,
 * libellé du document, détails) et rend { titre, message }.
 */
const EVENEMENTS = {
  version: (qui, doc, d) => ({
    titre: `Nouvelle version — ${doc.reference_mfile}`,
    message: `${qui} a ajouté ${d.nombre > 1 ? `${d.nombre} fichiers` : 'une nouvelle version'} au document « ${libelleDocument(doc)} »${d.fichier ? ` (${d.fichier})` : ''}.`,
  }),
  statut: (qui, doc, d) => ({
    titre: `Statut modifié — ${doc.reference_mfile}`,
    message: `${qui} a fait passer « ${libelleDocument(doc)} » de « ${d.de || '—'} » à « ${d.vers || '—'} ».`,
  }),
  fiche: (qui, doc) => ({
    titre: `Fiche modifiée — ${doc.reference_mfile}`,
    message: `${qui} a modifié la fiche du document « ${libelleDocument(doc)} ».`,
  }),
  metadonnees: (qui, doc) => ({
    titre: `Métadonnées modifiées — ${doc.reference_mfile}`,
    message: `${qui} a modifié les métadonnées du document « ${libelleDocument(doc)} ».`,
  }),
  commentaire: (qui, doc, d) => ({
    titre: `Nouveau commentaire — ${doc.reference_mfile}`,
    message: `${qui} a ${d.reponse ? 'répondu à un commentaire' : 'commenté le document'} « ${libelleDocument(doc)} ».`,
  }),
  mention: (qui, doc) => ({
    titre: `Vous êtes mentionné — ${doc.reference_mfile}`,
    message: `${qui} vous a mentionné dans un commentaire sur « ${libelleDocument(doc)} ».`,
  }),
  gel_pose: (qui, doc, d) => ({
    titre: `Gel juridique posé — ${doc.reference_mfile}`,
    message: `${qui} a posé un gel juridique sur « ${libelleDocument(doc)} »${d.reference ? ` (réf. ${d.reference})` : ''} : aucune destruction n'est possible.`,
  }),
  gel_leve: (qui, doc) => ({
    titre: `Gel juridique levé — ${doc.reference_mfile}`,
    message: `${qui} a levé le gel juridique du document « ${libelleDocument(doc)} ».`,
  }),
  version_restauree: (qui, doc, d) => ({
    titre: `Version restaurée — ${doc.reference_mfile}`,
    message: `${qui} a restauré la version ${d.source} de « ${libelleDocument(doc)} » : elle devient la version ${d.nouvelle}.`,
  }),
};

/**
 * Point d'appel des contrôleurs : signaler un geste aux abonnés, en une ligne.
 * Ne lève jamais. @param {object} details { acteur, ...propres à l'événement }
 */
async function signaler(tenantId, documentId, evenement, { acteur = null, exclureUserIds = [], ...details } = {}) {
  try {
    if (!(await migrationPassee())) return 0;
    const fabrique = EVENEMENTS[evenement];
    const document = await chargerDocument(tenantId, documentId);
    if (!fabrique || !document) return 0;
    const qui = acteur ? (await integrite.identite(acteur)).nom : 'Le système';
    const { titre, message } = fabrique(qui, document, details);
    return await notifierAbonnes(tenantId, documentId, { titre, message, exclureUserId: acteur?.id ?? null, exclureUserIds });
  } catch (err) {
    console.warn(`[collaboration] signalement « ${evenement} » impossible : ${err.message}`);
    return 0;
  }
}

// ------------------------------------------------------------------ favoris

async function ajouterFavori(tenantId, userId, documentId) {
  await db.query(
    `INSERT INTO document_favoris (tenant_id, user_id, document_id) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, document_id) DO NOTHING`,
    [tenantId, userId, documentId]
  );
  return { favori: true };
}

async function retirerFavori(tenantId, userId, documentId) {
  await db.query('DELETE FROM document_favoris WHERE tenant_id = $1 AND user_id = $2 AND document_id = $3', [tenantId, userId, documentId]);
  return { favori: false };
}

/**
 * Documents marqués (favoris) ou suivis par l'utilisateur, hors corbeille et
 * bornés à son périmètre.
 * @param {'favoris'|'suivis'} quoi
 */
async function listerDocumentsPersonnels(tenantId, userId, quoi = 'favoris') {
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, userId);
  const source = quoi === 'suivis'
    ? 'SELECT document_id, maj_at AS marque_le FROM document_abonnements WHERE tenant_id = $1 AND user_id = $2 AND suivi'
    : 'SELECT document_id, created_at AS marque_le FROM document_favoris WHERE tenant_id = $1 AND user_id = $2';
  const { rows } = await db.query(
    `SELECT d.id, d.reference_mfile, d.nom_entreprise, d.num_dossier, d.num_acte, d.type_document, d.annee,
            d.statut, d.dossier_id, fo.name AS dossier_name, d.updated_at, m.marque_le,
            (SELECT count(*) FROM document_files df WHERE df.document_id = d.id)::int AS files_count,
            EXISTS (SELECT 1 FROM document_favoris f WHERE f.user_id = $2 AND f.document_id = d.id) AS favori,
            EXISTS (SELECT 1 FROM document_abonnements a WHERE a.user_id = $2 AND a.document_id = d.id AND a.suivi) AS suivi,
            (SELECT count(*) FROM document_commentaires c WHERE c.document_id = d.id AND c.supprime_at IS NULL)::int AS nb_commentaires
       FROM (${source}) m
       JOIN documents d ON d.id = m.document_id AND d.tenant_id = $1
       LEFT JOIN document_folders fo ON fo.id = d.dossier_id AND fo.tenant_id = d.tenant_id
      WHERE d.deleted_at IS NULL${await filtreNonElimine('d')}
        AND (d.dossier_id IS NULL OR d.dossier_id = ANY($3::int[]))
      ORDER BY m.marque_le DESC
      LIMIT 500`,
    [tenantId, userId, [...lisibles]]
  );
  return rows.map(({ dossier_id: _d, ...r }) => r);
}

/** Identifiants des favoris (étoile dans les listes). */
async function idsFavoris(tenantId, userId) {
  const { rows } = await db.query('SELECT document_id FROM document_favoris WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
  return rows.map((r) => r.document_id);
}

// -------------------------------------------------------------------- suivi

/**
 * Suivi explicite (manuel) : rétablit le suivi même après un désabonnement.
 * Suivi automatique (créateur, commentaire) : n'écrase jamais un choix
 * explicite — ON CONFLICT DO NOTHING.
 */
async function suivre(tenantId, userId, documentId, { origine = 'manuel' } = {}) {
  if (origine === 'manuel') {
    await db.query(
      `INSERT INTO document_abonnements (tenant_id, user_id, document_id, suivi, origine) VALUES ($1, $2, $3, true, 'manuel')
       ON CONFLICT (user_id, document_id) DO UPDATE SET suivi = true, origine = 'manuel', maj_at = now()`,
      [tenantId, userId, documentId]
    );
  } else {
    await db.query(
      `INSERT INTO document_abonnements (tenant_id, user_id, document_id, origine) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, document_id) DO NOTHING`,
      [tenantId, userId, documentId, origine]
    );
  }
  return etatSuivi(tenantId, userId, documentId);
}

/** Désabonnement explicite, mémorisé (suivi = false). */
async function nePlusSuivre(tenantId, userId, documentId) {
  await db.query(
    `INSERT INTO document_abonnements (tenant_id, user_id, document_id, suivi, origine) VALUES ($1, $2, $3, false, 'manuel')
     ON CONFLICT (user_id, document_id) DO UPDATE SET suivi = false, origine = 'manuel', maj_at = now()`,
    [tenantId, userId, documentId]
  );
  return { suivi: false, origine: 'manuel' };
}

async function etatSuivi(tenantId, userId, documentId) {
  const { rows } = await db.query(
    'SELECT suivi, origine FROM document_abonnements WHERE tenant_id = $1 AND user_id = $2 AND document_id = $3',
    [tenantId, userId, documentId]
  );
  return rows[0] ? { suivi: rows[0].suivi, origine: rows[0].origine } : { suivi: false, origine: null };
}

/** État de collaboration d'une fiche, pour l'utilisateur courant. */
async function etatDocument(tenantId, userId, documentId) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM document_favoris WHERE user_id = $2 AND document_id = $3) AS favori,
            (SELECT count(*) FROM document_commentaires WHERE tenant_id = $1 AND document_id = $3 AND supprime_at IS NULL)::int AS nb_commentaires,
            (SELECT count(*) FROM document_abonnements WHERE tenant_id = $1 AND document_id = $3 AND suivi)::int AS nb_abonnes`,
    [tenantId, userId, documentId]
  );
  return { ...rows[0], ...(await etatSuivi(tenantId, userId, documentId)) };
}

// -------------------------------------------------------------- commentaires

// « @identifiant » : lettres (accents compris), chiffres, . _ - +. Le point
// final d'une phrase (« merci @k.mensah. ») est retiré à la résolution.
const MENTION_RE = /(^|[^\p{L}\p{N}._+-])@([\p{L}\p{N}._+-]{2,50})/gu;

/** Identifiants mentionnés dans un texte (bruts, en minuscules). */
function extraireMentions(texte) {
  const vus = new Set();
  for (const m of String(texte || '').matchAll(MENTION_RE)) {
    vus.add(m[2].toLowerCase());
    const sansPonctuation = m[2].replace(/[._+-]+$/, '').toLowerCase();
    if (sansPonctuation.length >= 2) vus.add(sansPonctuation);
  }
  return [...vus];
}

/** Mentions résolues en utilisateurs de l'organisation ET autorisés à lire le document. */
async function resoudreMentions(tenantId, document, texte) {
  const noms = extraireMentions(texte);
  if (!noms.length) return [];
  const { rows } = await db.query('SELECT id FROM users WHERE tenant_id = $1 AND lower(username) = ANY($2::text[])', [tenantId, noms]);
  return lecteursAutorises(tenantId, document, rows.map((r) => r.id));
}

/**
 * Personnes que l'on peut mentionner : comptes de l'organisation qui peuvent
 * lire ce document. Un dossier libre (ni lui ni ses ancêtres sous ACL) suit le
 * RBAC seul : inutile alors de résoudre le périmètre compte par compte.
 */
async function mentionnables(tenantId, document, { exclureUserId = null } = {}) {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.full_name FROM users u
       JOIN roles r ON r.tenant_id = u.tenant_id AND r.key = u.role AND r.is_active
      WHERE u.tenant_id = $1 AND ('*' = ANY(r.permissions) OR 'documents.view' = ANY(r.permissions))
        AND ($2::int IS NULL OR u.id <> $2)
      ORDER BY u.full_name, u.username
      LIMIT 300`,
    [tenantId, exclureUserId]
  );
  let retenus = rows;
  if (document.dossier_id !== null && (await dossierSousRestriction(tenantId, document.dossier_id))) {
    retenus = [];
    for (const u of rows) {
      if (await aclService.peutLire(tenantId, u.id, document.dossier_id)) retenus.push(u);
    }
  }
  return retenus.map((u) => ({ id: u.id, username: u.username, nom: u.full_name || u.username }));
}

/** Le dossier, ou l'un de ses ancêtres, porte-t-il une ACL ? */
async function dossierSousRestriction(tenantId, dossierId) {
  try {
    const { rows } = await db.query(
      `WITH RECURSIVE ancetres AS (
         SELECT id, parent_id, 0 AS profondeur FROM document_folders WHERE id = $2 AND tenant_id = $1
         UNION ALL
         SELECT f.id, f.parent_id, a.profondeur + 1 FROM document_folders f
           JOIN ancetres a ON f.id = a.parent_id WHERE f.tenant_id = $1 AND a.profondeur < 20)
       SELECT EXISTS (SELECT 1 FROM folder_acls x JOIN ancetres a ON a.id = x.folder_id WHERE x.tenant_id = $1) AS restreint`,
      [tenantId, dossierId]
    );
    return rows[0].restreint;
  } catch (err) {
    if (err.code === '42P01') return false; // base antérieure aux ACL (022)
    return true; // dans le doute, on vérifie compte par compte
  }
}

function versCommentaire(c, user, nomsMentions) {
  const supprime = Boolean(c.supprime_at);
  return {
    id: c.id,
    parent_id: c.parent_id,
    auteur: { id: c.auteur_id, nom: c.auteur_nom_actuel || c.auteur_nom || 'Utilisateur supprimé', username: c.auteur_username || null },
    contenu: supprime ? null : c.contenu,
    mentions: supprime ? [] : (c.mentions || []).map((id) => nomsMentions.get(id)).filter(Boolean),
    created_at: c.created_at,
    modifie_at: c.modifie_at,
    supprime,
    supprime_at: c.supprime_at,
    est_auteur: c.auteur_id != null && Number(c.auteur_id) === Number(user.id),
  };
}

const SELECT_COMMENTAIRE = `SELECT c.*, u.full_name AS auteur_nom_actuel, u.username AS auteur_username
  FROM document_commentaires c LEFT JOIN users u ON u.id = c.auteur_id AND u.tenant_id = c.tenant_id`;

async function nomsDesMentions(tenantId, ids) {
  const uniques = [...new Set(ids)];
  if (!uniques.length) return new Map();
  const { rows } = await db.query('SELECT id, username, full_name FROM users WHERE tenant_id = $1 AND id = ANY($2::int[])', [tenantId, uniques]);
  return new Map(rows.map((u) => [u.id, { id: u.id, username: u.username, nom: u.full_name || u.username }]));
}

/** Fil des commentaires : les messages de premier niveau, chacun avec ses réponses. */
async function listerCommentaires(tenantId, documentId, user) {
  const { rows } = await db.query(
    `${SELECT_COMMENTAIRE} WHERE c.tenant_id = $1 AND c.document_id = $2 ORDER BY c.created_at, c.id LIMIT 1000`,
    [tenantId, documentId]
  );
  const noms = await nomsDesMentions(tenantId, rows.flatMap((c) => c.mentions || []));
  const parId = new Map();
  const fil = [];
  for (const c of rows) {
    const item = { ...versCommentaire(c, user, noms), reponses: [] };
    parId.set(c.id, item);
    if (!c.parent_id) fil.push(item);
  }
  for (const c of rows) {
    if (c.parent_id && parId.has(c.parent_id)) parId.get(c.parent_id).reponses.push(parId.get(c.id));
  }
  return { commentaires: fil, total: rows.filter((c) => !c.supprime_at).length };
}

function validerContenu(contenu) {
  const texte = String(contenu ?? '').replace(/\r\n/g, '\n').trim();
  if (!texte) throw erreur(400, 'Le commentaire est vide.');
  if (texte.length > COMMENTAIRE_MAX) throw erreur(400, `Commentaire trop long (${COMMENTAIRE_MAX.toLocaleString('fr-FR')} caractères au plus).`);
  return texte;
}

async function chargerCommentaire(tenantId, documentId, commentaireId) {
  const id = Number(commentaireId);
  if (!Number.isInteger(id) || id <= 0) throw erreur(400, 'Identifiant de commentaire invalide.');
  const { rows } = await db.query(`${SELECT_COMMENTAIRE} WHERE c.id = $1 AND c.tenant_id = $2 AND c.document_id = $3`, [id, tenantId, documentId]);
  if (!rows[0]) throw erreur(404, 'Commentaire introuvable.');
  return rows[0];
}

async function unCommentaire(tenantId, documentId, id, user) {
  const c = await chargerCommentaire(tenantId, documentId, id);
  return versCommentaire(c, user, await nomsDesMentions(tenantId, c.mentions || []));
}

/**
 * Poster un commentaire (ou une réponse). L'auteur suit désormais le document
 * (sauf désabonnement explicite) ; les personnes mentionnées et autorisées
 * sont notifiées, puis les abonnés — une seule notification par personne.
 */
async function creerCommentaire(tenantId, document, user, { contenu, parent_id: parentId = null } = {}) {
  const texte = validerContenu(contenu);
  let parent = null;
  if (parentId !== null && parentId !== undefined && parentId !== '') {
    parent = await chargerCommentaire(tenantId, document.id, parentId);
    if (parent.parent_id) throw erreur(400, 'On répond à un commentaire, pas à une réponse (un seul niveau de réponse).');
    if (parent.supprime_at) throw erreur(409, 'Ce commentaire a été supprimé : impossible d\'y répondre.', 'COMMENTAIRE_SUPPRIME');
  }
  const qui = await integrite.identite(user);
  const mentions = await resoudreMentions(tenantId, document, texte);
  const { rows } = await db.query(
    `INSERT INTO document_commentaires (tenant_id, document_id, parent_id, auteur_id, auteur_nom, contenu, mentions)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [tenantId, document.id, parent ? parent.id : null, user.id, qui.nom, texte, mentions]
  );
  const id = rows[0].id;
  await suivre(tenantId, user.id, document.id, { origine: 'commentaire' }).catch((err) => console.warn('[collaboration] suivi automatique :', err.message));
  await documentAuditService.logAction({
    tenantId, documentId: document.id, userId: user.id, username: qui.username,
    action: 'COMMENTAIRE_AJOUTE', details: { commentaire_id: id, reponse_a: parent ? parent.id : null, mentions: mentions.length },
  });
  const mentionnes = mentions.filter((m) => Number(m) !== Number(user.id));
  await notifierMentions(tenantId, document, user, mentionnes);
  await signaler(tenantId, document.id, 'commentaire', { acteur: user, reponse: Boolean(parent), exclureUserIds: mentionnes });
  return unCommentaire(tenantId, document.id, id, user);
}

async function notifierMentions(tenantId, document, user, ids) {
  if (!ids.length) return 0;
  try {
    const qui = (await integrite.identite(user)).nom;
    const { titre, message } = EVENEMENTS.mention(qui, document);
    return await inscrireNotifications(tenantId, document.id, ids, { titre, message, type: 'mention' });
  } catch (err) {
    console.warn('[collaboration] notification des mentions impossible :', err.message);
    return 0;
  }
}

function verifierAuteur(c, user, verbe) {
  if (c.auteur_id == null || Number(c.auteur_id) !== Number(user.id)) {
    throw erreur(403, `Seul l'auteur d'un commentaire peut le ${verbe}.`, 'PAS_AUTEUR');
  }
  if (c.supprime_at) throw erreur(409, 'Ce commentaire a déjà été supprimé.', 'COMMENTAIRE_SUPPRIME');
}

/** Modifier son commentaire. Seules les NOUVELLES mentions sont notifiées. */
async function modifierCommentaire(tenantId, document, user, commentaireId, { contenu } = {}) {
  const c = await chargerCommentaire(tenantId, document.id, commentaireId);
  verifierAuteur(c, user, 'modifier');
  const texte = validerContenu(contenu);
  const mentions = await resoudreMentions(tenantId, document, texte);
  await db.query(
    'UPDATE document_commentaires SET contenu = $1, mentions = $2, modifie_at = now() WHERE id = $3 AND tenant_id = $4',
    [texte, mentions, c.id, tenantId]
  );
  const qui = await integrite.identite(user);
  await documentAuditService.logAction({
    tenantId, documentId: document.id, userId: user.id, username: qui.username,
    action: 'COMMENTAIRE_MODIFIE', details: { commentaire_id: c.id },
  });
  const anciennes = new Set((c.mentions || []).map(Number));
  await notifierMentions(tenantId, document, user, mentions.filter((m) => !anciennes.has(Number(m)) && Number(m) !== Number(user.id)));
  return unCommentaire(tenantId, document.id, c.id, user);
}

/** Supprimer son commentaire : pierre tombale, contenu effacé. */
async function supprimerCommentaire(tenantId, document, user, commentaireId) {
  const c = await chargerCommentaire(tenantId, document.id, commentaireId);
  verifierAuteur(c, user, 'supprimer');
  await db.query(
    "UPDATE document_commentaires SET contenu = NULL, mentions = '{}', supprime_at = now() WHERE id = $1 AND tenant_id = $2",
    [c.id, tenantId]
  );
  const qui = await integrite.identite(user);
  await documentAuditService.logAction({
    tenantId, documentId: document.id, userId: user.id, username: qui.username,
    action: 'COMMENTAIRE_SUPPRIME', details: { commentaire_id: c.id },
  });
  return unCommentaire(tenantId, document.id, c.id, user);
}

module.exports = {
  COMMENTAIRE_MAX, migrationPassee, colonneElimination, filtreNonElimine, libelleDocument, chargerDocument,
  lecteursAutorises, notifierAbonnes, signaler, EVENEMENTS,
  ajouterFavori, retirerFavori, listerDocumentsPersonnels, idsFavoris,
  suivre, nePlusSuivre, etatSuivi, etatDocument,
  extraireMentions, resoudreMentions, mentionnables, dossierSousRestriction,
  listerCommentaires, creerCommentaire, modifierCommentaire, supprimerCommentaire,
};
