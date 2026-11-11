// ============================================================================
// archivothequeService — archivothèque virtuelle (migration 045).
//
// Une vitrine publique de quelques pièces choisies : la valorisation des
// archives, et la preuve par l'exemple qu'elles sont tenues. Une pièce n'y
// entre qu'à trois conditions, vérifiées ici :
//   1. elle est communicable au public (décret n° 2007-532, art. 32 et 33) —
//      revérifié à chaque consultation, car une règle peut se durcir ;
//   2. celui qui la propose déclare qu'elle ne porte aucune donnée
//      personnelle, ou qu'elles ont été masquées ;
//   3. une personne habilitée (archives.validate) autorise la publication.
// Seuls les PDF et les images se publient : ils se lisent dans le navigateur.
// Le fichier est figé à la proposition — une version déposée plus tard dans
// la GED ne part pas d'elle-même en ligne.
// ============================================================================
const db = require('../config/db');
const settingsService = require('./settingsService');
const integrite = require('./integriteService');
const communicabilite = require('./communicabiliteService');

const STATUTS = { proposee: 'Proposée', publiee: 'Publiée', retiree: 'Retirée' };
const TYPES_PUBLIES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);
const erreur = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const court = (v, max) => String(v ?? '').trim().slice(0, max) || null;

/** Lecture de la saisie d'une proposition. Fonction pure. */
function lireSaisie(corps = {}, defauts = {}) {
  const titre = court(corps.titre, 300) || court(defauts.titre, 300);
  if (!titre) throw erreur(400, 'Donnez un titre à la pièce : celui que le public lira.');
  if (corps.sans_donnees_personnelles !== true) {
    throw erreur(400, "Confirmez que la pièce ne porte aucune donnée personnelle, ou qu'elles ont été masquées.", 'DONNEES_PERSONNELLES');
  }
  return { titre, notice: court(corps.notice, 3000), date_affichee: court(corps.date_affichee, 60), theme: court(corps.theme, 120) };
}

async function journaliser(tenantId, qui, action, piece, details = {}) {
  await db.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json)
     VALUES ($1, $2, $3, $4, 'document', $5, $6)`,
    [tenantId, qui.id, qui.username, action, piece.document_id, JSON.stringify({ piece: piece.id, titre: piece.titre, ...details })]
  ).catch((err) => console.warn('[archivothèque] journal :', err.message));
}

async function notifier(tenantId, userIds, titre, message, documentId) {
  for (const id of new Set(userIds.filter(Boolean))) {
    await db.query(
      "INSERT INTO notifications (tenant_id, id_user, title, message, type, document_id, lien) VALUES ($1, $2, $3, $4, 'archives', $5, '/documents/archivotheque')",
      [tenantId, id, titre.slice(0, 255), message, documentId]
    ).catch((err) => console.warn('[archivothèque] notification :', err.message));
  }
}

const SQL_PIECE = `
  SELECT p.*, d.reference_mfile, d.description AS document_titre, d.dossier_id, d.deleted_at, d.elimine_at,
         f.mime_type, f.original_name, f.file_size, f.version AS fichier_version
    FROM archivotheque_pieces p
    JOIN documents d ON d.id = p.document_id AND d.tenant_id = p.tenant_id
    LEFT JOIN document_files f ON f.id = p.fichier_id`;

const versPiece = (p) => ({
  id: p.id, document_id: p.document_id, reference: p.reference_mfile, document_titre: p.document_titre,
  titre: p.titre, notice: p.notice, date_affichee: p.date_affichee, theme: p.theme,
  statut: p.statut, statut_libelle: STATUTS[p.statut],
  fichier: p.fichier_id ? { id: p.fichier_id, nom: p.original_name, type: p.mime_type, taille: p.file_size === null ? null : Number(p.file_size), version: p.fichier_version } : null,
  propose_par: p.propose_par_nom, propose_at: p.propose_at, autorise_par: p.autorise_par_nom, autorise_at: p.autorise_at,
  retire_par: p.retire_par_nom, retire_at: p.retire_at, retire_motif: p.retire_motif, vues: p.vues,
});

async function charger(tenantId, id) {
  const { rows } = await db.query(`${SQL_PIECE} WHERE p.tenant_id = $1 AND p.id = $2`, [tenantId, Number(id) || 0]);
  if (!rows[0]) throw erreur(404, 'Pièce introuvable.');
  return rows[0];
}

/** Une pièce ne se gère que si l'on peut lire son document : la restriction d'un dossier vaut ici aussi. */
async function exigerLecture(tenantId, user, dossierId) {
  if (dossierId && !(await require('./aclService').peutLire(tenantId, user.id, dossierId))) {
    throw erreur(403, 'Cette pièce appartient à un dossier hors de votre périmètre.', 'HORS_PERIMETRE');
  }
}

/** Le document peut-il être montré au public ? Lève une 403 qui dit pourquoi. */
async function exigerCommunicable(tenantId, documentId) {
  const etat = await communicabilite.etatDocument(tenantId, documentId);
  if (etat && etat.communicable === false) {
    const quand = etat.a_partir_du ? ` Il le sera à partir du ${etat.a_partir_du.split('-').reverse().join('/')}.` : '';
    throw erreur(403, `Ce document n'est pas encore communicable au public (${etat.libelle}).${quand}${etat.raison ? ` ${etat.raison}` : ''}`, 'NON_COMMUNICABLE');
  }
}

/**
 * Propose un document à l'archivothèque (ou reprend une proposition).
 * L'accès en lecture au document est vérifié par le contrôleur.
 */
async function proposer(tenantId, documentId, corps = {}, user) {
  const doc = (await db.query(
    'SELECT id, description, deleted_at, elimine_at FROM documents WHERE id = $1 AND tenant_id = $2', [Number(documentId), tenantId])).rows[0];
  if (!doc || doc.deleted_at || doc.elimine_at) throw erreur(404, 'Document introuvable.');
  const saisie = lireSaisie(corps, { titre: doc.description });
  const fichiers = (await db.query(
    'SELECT id, mime_type, version FROM document_files WHERE document_id = $1 ORDER BY version DESC, id DESC', [doc.id])).rows;
  const fichier = corps.fichier_id ? fichiers.find((f) => f.id === Number(corps.fichier_id)) : fichiers[0];
  if (!fichier) throw erreur(400, corps.fichier_id ? 'Ce fichier ne fait pas partie du document.' : "Ce document n'a pas de fichier : numérisez-le d'abord.");
  if (!TYPES_PUBLIES.has(fichier.mime_type)) throw erreur(400, 'Seuls les PDF et les images se publient : ils se lisent dans le navigateur.', 'TYPE_NON_PUBLIABLE');
  await exigerCommunicable(tenantId, doc.id);

  const existante = (await db.query('SELECT id, statut FROM archivotheque_pieces WHERE tenant_id = $1 AND document_id = $2', [tenantId, doc.id])).rows[0];
  if (existante && existante.statut === 'publiee') throw erreur(409, 'Cette pièce est déjà publiée : retirez-la pour la modifier.', 'DEJA_PUBLIEE');
  const qui = await integrite.identite(user);
  const { rows } = await db.query(
    `INSERT INTO archivotheque_pieces (tenant_id, document_id, fichier_id, titre, notice, date_affichee, theme, sans_donnees_personnelles, propose_par, propose_par_nom)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)
     ON CONFLICT (tenant_id, document_id) DO UPDATE
        SET fichier_id = EXCLUDED.fichier_id, titre = EXCLUDED.titre, notice = EXCLUDED.notice, date_affichee = EXCLUDED.date_affichee,
            theme = EXCLUDED.theme, sans_donnees_personnelles = true, statut = 'proposee',
            propose_par = EXCLUDED.propose_par, propose_par_nom = EXCLUDED.propose_par_nom, propose_at = now(),
            autorise_par = NULL, autorise_par_nom = NULL, autorise_at = NULL, retire_par_nom = NULL, retire_at = NULL, retire_motif = NULL
     RETURNING id`,
    [tenantId, doc.id, fichier.id, saisie.titre, saisie.notice, saisie.date_affichee, saisie.theme, qui.id, qui.nom]
  );
  const piece = await charger(tenantId, rows[0].id);
  await journaliser(tenantId, qui, 'ARCHIVOTHEQUE_PROPOSEE', piece, { fichier_id: fichier.id, version: fichier.version });
  await notifier(tenantId, (await integrite.destinataires(tenantId, 'archives.validate')).filter((id) => id !== qui.id),
    `Archivothèque : une pièce attend votre autorisation`, `${qui.nom} propose de publier « ${piece.titre} ».`, doc.id);
  return versPiece(piece);
}

/** Autorise la publication d'une pièce proposée. */
async function autoriser(tenantId, id, user) {
  const p = await charger(tenantId, id);
  await exigerLecture(tenantId, user, p.dossier_id);
  if (p.statut !== 'proposee') throw erreur(409, p.statut === 'publiee' ? 'Cette pièce est déjà publiée.' : 'Cette pièce a été retirée : elle doit être proposée de nouveau.');
  if (p.deleted_at || p.elimine_at) throw erreur(409, "Le document n'existe plus : la pièce ne peut pas être publiée.");
  if (!p.fichier_id) throw erreur(409, 'Le fichier proposé a été retiré du document : proposez de nouveau la pièce.');
  await exigerCommunicable(tenantId, p.document_id);
  const qui = await integrite.identite(user);
  await db.query(
    "UPDATE archivotheque_pieces SET statut = 'publiee', autorise_par = $3, autorise_par_nom = $4, autorise_at = now() WHERE id = $1 AND tenant_id = $2",
    [p.id, tenantId, qui.id, qui.nom]);
  const piece = await charger(tenantId, p.id);
  await journaliser(tenantId, qui, 'ARCHIVOTHEQUE_PUBLIEE', piece);
  await notifier(tenantId, [p.propose_par].filter((x) => x !== qui.id), 'Archivothèque : pièce publiée', `« ${piece.titre} » est en ligne, autorisée par ${qui.nom}.`, p.document_id);
  return versPiece(piece);
}

/** Retire une pièce (publiée ou proposée). Elle reste dans l'historique. */
async function retirer(tenantId, id, { motif } = {}, user) {
  const p = await charger(tenantId, id);
  await exigerLecture(tenantId, user, p.dossier_id);
  if (p.statut === 'retiree') throw erreur(409, 'Cette pièce est déjà retirée.');
  const qui = await integrite.identite(user);
  await db.query(
    "UPDATE archivotheque_pieces SET statut = 'retiree', retire_par_nom = $3, retire_at = now(), retire_motif = $4 WHERE id = $1 AND tenant_id = $2",
    [p.id, tenantId, qui.nom, court(motif, 500)]);
  const piece = await charger(tenantId, p.id);
  await journaliser(tenantId, qui, 'ARCHIVOTHEQUE_RETIREE', piece, { motif: court(motif, 500), etait: p.statut });
  return versPiece(piece);
}

/** Pièces de l'organisation, pour qui gère l'archivothèque (bornées à son périmètre de lecture). */
async function lister(tenantId, user) {
  const [{ rows }, reglages, tenant, acces] = await Promise.all([
    db.query(`${SQL_PIECE} WHERE p.tenant_id = $1 AND d.deleted_at IS NULL AND d.elimine_at IS NULL
               ORDER BY (p.statut = 'proposee') DESC, COALESCE(p.autorise_at, p.propose_at) DESC`, [tenantId]),
    settingsService.getAll(tenantId),
    db.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]),
    require('./aclService').dossiersAccessibles(tenantId, user.id),
  ]);
  const roleService = require('./roleService');
  return {
    active: reglages.archivotheque_active === true, slug: tenant.rows[0]?.slug || null, presentation: reglages.archivotheque_presentation || '',
    pieces: rows.filter((p) => !p.dossier_id || acces.lisibles.has(p.dossier_id)).map(versPiece),
    droits: {
      proposer: await roleService.possede(tenantId, user.role, 'archives.manage'),
      autoriser: await roleService.possede(tenantId, user.role, 'archives.validate'),
      configurer: await roleService.possede(tenantId, user.role, 'settings.manage'),
    },
  };
}

/** Pièce d'un document (carte de la fiche), ou null. */
async function pourDocument(tenantId, documentId) {
  const { rows } = await db.query(`${SQL_PIECE} WHERE p.tenant_id = $1 AND p.document_id = $2`, [tenantId, Number(documentId)]);
  return rows[0] ? versPiece(rows[0]) : null;
}

// ------------------------------------------------------------------ public

async function organisation(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(s)) return null;
  const t = (await db.query("SELECT id, name, slug FROM tenants WHERE lower(slug) = $1 AND status = 'active'", [s])).rows[0];
  if (!t) return null;
  const r = await settingsService.getAll(t.id);
  if (r.archivotheque_active !== true) return null;
  // « DocuFlow » est le nom de plateforme par défaut, pas celui de l'organisation.
  const nom = r.legal_entity || (r.site_name && r.site_name !== 'DocuFlow' ? r.site_name : null) || t.name;
  return { id: t.id, slug: t.slug, nom, logo: r.site_logo || null, presentation: r.archivotheque_presentation || null };
}

async function publiees(tenantId) {
  const { rows } = await db.query(
    `${SQL_PIECE} WHERE p.tenant_id = $1 AND p.statut = 'publiee' AND p.fichier_id IS NOT NULL AND d.deleted_at IS NULL AND d.elimine_at IS NULL
      ORDER BY p.autorise_at DESC, p.id DESC LIMIT 500`, [tenantId]);
  // Une règle de communicabilité a pu se durcir depuis la publication.
  const visibles = await Promise.all(rows.map(async (p) => {
    const etat = await communicabilite.etatDocument(tenantId, p.document_id).catch(() => null);
    return etat && etat.communicable === false ? null : p;
  }));
  return visibles.filter(Boolean);
}

/** La vitrine publique d'une organisation, ou null si elle n'en a pas. Rien d'interne n'en sort. */
async function vitrine(slug) {
  const o = await organisation(slug);
  if (!o) return null;
  const pieces = await publiees(o.id);
  return {
    nom: o.nom, slug: o.slug, logo: o.logo, presentation: o.presentation,
    themes: [...new Set(pieces.map((p) => p.theme).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')),
    pieces: pieces.map((p) => ({
      id: p.id, titre: p.titre, notice: p.notice, date_affichee: p.date_affichee, theme: p.theme,
      type: p.mime_type === 'application/pdf' ? 'pdf' : 'image', publiee_le: p.autorise_at,
    })),
  };
}

/**
 * Fichier d'une pièce publiée (ligne de document_files), ou null.
 * `compter` : la pièce est ouverte pour être lue (et non chargée en vignette).
 */
async function fichierPublic(slug, id, { compter = false } = {}) {
  const o = await organisation(slug);
  if (!o) return null;
  const p = (await publiees(o.id)).find((x) => x.id === Number(id));
  if (!p) return null;
  const f = (await db.query('SELECT * FROM document_files WHERE id = $1 AND document_id = $2', [p.fichier_id, p.document_id])).rows[0];
  if (!f || !TYPES_PUBLIES.has(f.mime_type)) return null;
  if (compter) await db.query('UPDATE archivotheque_pieces SET vues = vues + 1 WHERE id = $1', [p.id]).catch(() => {});
  return { fichier: f, titre: p.titre };
}

module.exports = {
  STATUTS, TYPES_PUBLIES, lireSaisie,
  proposer, autoriser, retirer, lister, pourDocument, vitrine, fichierPublic,
};
