// ============================================================================
// partageService — liens de partage publics (migration 033).
//
// Un lien /partage/<jeton> ouvre UN fichier d'un document à un tiers sans
// compte. Règles :
//   - le jeton (256 bits, base64url) n'est montré qu'à la création ; seule son
//     empreinte SHA-256 est stockée ;
//   - expiration obligatoire (réglage partage_duree_jours, 90 jours au plus),
//     mot de passe facultatif (bcrypt), plafond de téléchargements facultatif,
//     version courante ou figée, révocation ;
//   - après un mot de passe juste, une PREUVE courte (HMAC dérivé de
//     JWT_SECRET, 30 min, liée au lien) autorise les téléchargements — ce n'est
//     pas un jeton de session et il ne peut pas en tenir lieu ;
//   - chaque accès, chaque création et révocation est inscrit au journal
//     chaîné ; les compteurs et le plafond sont tenus par la base (UPDATE
//     conditionnel : deux téléchargements simultanés ne dépassent pas le plafond).
// ============================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const db = require('../config/db');
const settingsService = require('./settingsService');
const documentAuditService = require('./documentAuditService');
const integrite = require('./integriteService');
const collaboration = require('./collaborationService');

const DUREE_MAX_JOURS = 90;
const PREUVE_DUREE_MS = 30 * 60 * 1000;
const JETON_RE = /^[A-Za-z0-9_-]{43}$/;
// Aperçu dans le navigateur : seulement des types qui n'exécutent rien. Tout le
// reste part en pièce jointe (un SVG ou un HTML servi « inline » depuis l'API
// serait un vecteur de script).
const TYPES_APERCU = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'text/plain']);

const erreur = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const empreinteJeton = (jeton) => crypto.createHash('sha256').update(String(jeton)).digest('hex');
const nouveauJeton = () => crypto.randomBytes(32).toString('base64url');

// ------------------------------------------------------------ limitation de débit

// En mémoire, par instance : suffisant contre l'énumération et la force brute
// (un jeton de 256 bits ne se devine pas ; un mot de passe, si — d'où le plafond
// d'échecs par lien ET par adresse, en plus du coût de bcrypt).
const compteurs = new Map();
function limiter(cle, max, fenetreMs) {
  const maintenant = Date.now();
  if (compteurs.size > 10000) {
    for (const [k, v] of compteurs) if (v.fin < maintenant) compteurs.delete(k);
  }
  const c = compteurs.get(cle);
  if (!c || c.fin < maintenant) {
    compteurs.set(cle, { n: 1, fin: maintenant + fenetreMs });
    return true;
  }
  c.n += 1;
  return c.n <= max;
}
const echecsDepasses = (cle, max) => {
  const c = compteurs.get(cle);
  return Boolean(c && c.fin >= Date.now() && c.n >= max);
};
function noterEchec(cle, fenetreMs) {
  limiter(cle, Infinity, fenetreMs);
}
const reinitialiserLimites = () => compteurs.clear();

// ------------------------------------------------------------------- preuve

function clePreuve() {
  if (!process.env.JWT_SECRET) throw erreur(500, 'Configuration du serveur incomplète.');
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update('docuflow:partage:preuve:v1').digest();
}
const signature = (partage, exp) => crypto.createHmac('sha256', clePreuve())
  .update(`${partage.id}:${String(partage.jeton_hash).trim()}:${exp}`).digest('base64url');

function emettrePreuve(partage) {
  const exp = Date.now() + PREUVE_DUREE_MS;
  return { preuve: `${exp}.${signature(partage, exp)}`, expire_at: new Date(exp).toISOString() };
}

function verifierPreuve(partage, preuve) {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(String(preuve || ''));
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp < Date.now()) return false;
  const attendue = Buffer.from(signature(partage, exp));
  const recue = Buffer.from(m[2]);
  return attendue.length === recue.length && crypto.timingSafeEqual(attendue, recue);
}

// ----------------------------------------------------------- présentation

/** État d'un lien : actif, revoque, expire, epuise, version_retiree. */
function etat(p, maintenant = new Date()) {
  if (p.revoque_at) return 'revoque';
  if (new Date(p.expire_at) <= maintenant) return 'expire';
  if (p.max_telechargements != null && p.nb_telechargements >= p.max_telechargements) return 'epuise';
  if (p.version_mode === 'fixe' && !p.fichier_id) return 'version_retiree';
  return 'actif';
}

function versPartage(p) {
  return {
    id: p.id,
    libelle: p.libelle,
    version_mode: p.version_mode,
    version: p.version_numero,
    fichier_id: p.fichier_id,
    expire_at: p.expire_at,
    protege: Boolean(p.mot_de_passe_hash),
    max_telechargements: p.max_telechargements,
    nb_telechargements: p.nb_telechargements,
    nb_consultations: p.nb_consultations,
    dernier_acces_at: p.dernier_acces_at,
    cree_par: p.cree_par_nom,
    created_at: p.created_at,
    revoque_at: p.revoque_at,
    revoque_par: p.revoque_par_nom,
    etat: etat(p),
  };
}

async function reglages(tenantId) {
  const r = await settingsService.getAll(tenantId);
  const duree = Number(r.partage_duree_jours);
  return {
    actif: r.partage_public_actif !== false,
    duree_jours: Number.isFinite(duree) ? Math.min(Math.max(Math.round(duree), 1), DUREE_MAX_JOURS) : 7,
    mot_de_passe_obligatoire: r.partage_mot_de_passe_obligatoire === true,
    duree_max_jours: DUREE_MAX_JOURS,
  };
}

// ------------------------------------------------------------- gestion (staff)

async function listerPartages(tenantId, documentId) {
  const { rows } = await db.query(
    'SELECT * FROM document_partages WHERE tenant_id = $1 AND document_id = $2 ORDER BY revoque_at IS NULL DESC, created_at DESC LIMIT 100',
    [tenantId, documentId]
  );
  return rows.map(versPartage);
}

/**
 * Crée un lien. @returns {{partage, jeton, chemin}} — le jeton en clair n'est
 * rendu qu'ici, une seule fois.
 */
async function creerPartage(tenantId, documentId, user, corps = {}, { ip = null } = {}) {
  const r = await reglages(tenantId);
  if (!r.actif) throw erreur(403, "Le partage public est désactivé par votre organisation.", 'PARTAGE_DESACTIVE');

  // Communicabilité (décret n° 2007-532, art. 32-33) : un lien public ouvre le
  // document à un tiers. Avant son délai, il faut une autorisation référencée
  // (comité permanent, art. 32 al. 3), enregistrée par qui en a le droit.
  const comm = await require('./communicabiliteService').etatDocument(tenantId, documentId);
  let autorisation = null;
  if (comm && !comm.communicable) {
    autorisation = String(corps.autorisation_communication || '').trim();
    const motif = comm.a_partir_du
      ? `Ce document n'est communicable au public qu'à partir du ${comm.a_partir_du.split('-').reverse().join('/')} (${comm.libelle}).`
      : `Ce document n'est pas réputé communicable (${comm.libelle}). ${comm.raison || ''}`.trim();
    if (!autorisation) throw Object.assign(erreur(403, `${motif} Un lien public exige une autorisation de communication anticipée.`, 'NON_COMMUNICABLE'), { communicabilite: comm });
    if (autorisation.length > 500) throw erreur(400, "Référence de l'autorisation trop longue (500 caractères au plus).");
    if (!(await require('./roleService').possede(tenantId, user.role, 'archives.communicate'))) {
      throw erreur(403, `${motif} Seul un gestionnaire habilité peut enregistrer une autorisation de communication anticipée.`, 'NON_COMMUNICABLE');
    }
  }

  // Version : courante par défaut, ou une version précise du document.
  const { rows: fichiers } = await db.query('SELECT id, version FROM document_files WHERE document_id = $1 ORDER BY version DESC', [documentId]);
  if (!fichiers.length) throw erreur(409, 'Ce document ne contient aucun fichier : rien à partager.', 'SANS_FICHIER');
  let versionMode = 'courante';
  let fichier = null;
  if (corps.fichier_id !== undefined && corps.fichier_id !== null && corps.fichier_id !== '') {
    fichier = fichiers.find((f) => String(f.id) === String(corps.fichier_id));
    if (!fichier) throw erreur(400, "Cette version n'appartient pas au document.");
    versionMode = 'fixe';
  }

  // Expiration : date explicite, ou durée en jours (réglage par défaut), 90 jours au plus.
  const maintenant = Date.now();
  let expireAt;
  if (corps.expire_at) {
    expireAt = new Date(corps.expire_at);
    if (Number.isNaN(expireAt.getTime())) throw erreur(400, "Date d'expiration invalide.");
  } else {
    const jours = corps.duree_jours === undefined || corps.duree_jours === null || corps.duree_jours === '' ? r.duree_jours : Number(corps.duree_jours);
    if (!Number.isInteger(jours) || jours < 1) throw erreur(400, 'Durée de validité invalide (en jours, 1 au moins).');
    if (jours > DUREE_MAX_JOURS) throw erreur(400, `Un lien de partage vaut ${DUREE_MAX_JOURS} jours au plus.`);
    expireAt = new Date(maintenant + jours * 86400000);
  }
  if (expireAt.getTime() <= maintenant + 60000) throw erreur(400, "La date d'expiration doit être dans le futur.");
  if (expireAt.getTime() > maintenant + DUREE_MAX_JOURS * 86400000 + 60000) {
    throw erreur(400, `Un lien de partage vaut ${DUREE_MAX_JOURS} jours au plus.`);
  }

  const motDePasse = corps.mot_de_passe === undefined || corps.mot_de_passe === null ? '' : String(corps.mot_de_passe);
  if (motDePasse && (motDePasse.length < 6 || motDePasse.length > 128)) throw erreur(400, 'Le mot de passe doit compter de 6 à 128 caractères.');
  if (!motDePasse && r.mot_de_passe_obligatoire) {
    throw erreur(400, 'Votre organisation exige un mot de passe sur chaque lien de partage.', 'MOT_DE_PASSE_OBLIGATOIRE');
  }
  let max = null;
  if (corps.max_telechargements !== undefined && corps.max_telechargements !== null && corps.max_telechargements !== '') {
    max = Number(corps.max_telechargements);
    if (!Number.isInteger(max) || max < 1 || max > 1000) throw erreur(400, 'Nombre maximal de téléchargements invalide (1 à 1 000).');
  }
  const libelle = String(corps.libelle || '').trim();
  if (libelle.length > 120) throw erreur(400, 'Libellé trop long (120 caractères au plus).');

  const jeton = nouveauJeton();
  const qui = await integrite.identite(user);
  const { rows } = await db.query(
    `INSERT INTO document_partages (tenant_id, document_id, version_mode, fichier_id, version_numero, jeton_hash, libelle,
                                    mot_de_passe_hash, expire_at, max_telechargements, cree_par, cree_par_nom, autorisation_communication)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [tenantId, documentId, versionMode, fichier ? fichier.id : null, fichier ? fichier.version : null, empreinteJeton(jeton),
      libelle || null, motDePasse ? await bcrypt.hash(motDePasse, 10) : null, expireAt, max, qui.id, qui.nom, autorisation]
  );
  const p = rows[0];
  if (autorisation) {
    await documentAuditService.logAction({
      tenantId, documentId, userId: qui.id, username: qui.username, ipAddress: ip,
      action: 'COMMUNICATION_ANTICIPEE',
      details: { partage_id: p.id, autorisation, communicable_le: comm.a_partir_du, categorie: comm.categorie },
    });
  }
  await documentAuditService.logAction({
    tenantId, documentId, userId: qui.id, username: qui.username, ipAddress: ip,
    action: 'PARTAGE_CREE',
    details: { partage_id: p.id, version: versionMode === 'fixe' ? p.version_numero : 'courante', expire_at: p.expire_at, protege: Boolean(motDePasse), max_telechargements: max, libelle: libelle || null },
  });
  await require('./documentIndexService').logHistory(tenantId, documentId, user.id, 'Lien de partage public créé', null, null,
    `Valable jusqu'au ${expireAt.toLocaleDateString('fr-FR')}${motDePasse ? ' · protégé par mot de passe' : ''}${libelle ? ` · ${libelle}` : ''}`.slice(0, 500));
  return { partage: versPartage(p), jeton, chemin: `/partage/${jeton}` };
}

async function revoquerPartage(tenantId, documentId, partageId, user, { ip = null } = {}) {
  const id = Number(partageId);
  if (!Number.isInteger(id) || id <= 0) throw erreur(400, 'Identifiant de lien invalide.');
  const qui = await integrite.identite(user);
  const { rows } = await db.query(
    `UPDATE document_partages SET revoque_at = now(), revoque_par = $4, revoque_par_nom = $5
      WHERE id = $1 AND tenant_id = $2 AND document_id = $3 AND revoque_at IS NULL RETURNING *`,
    [id, tenantId, documentId, qui.id, qui.nom]
  );
  if (!rows[0]) {
    const existe = await db.query('SELECT 1 FROM document_partages WHERE id = $1 AND tenant_id = $2 AND document_id = $3', [id, tenantId, documentId]);
    if (existe.rowCount) throw erreur(409, 'Ce lien est déjà révoqué.', 'DEJA_REVOQUE');
    throw erreur(404, 'Lien de partage introuvable.');
  }
  await documentAuditService.logAction({
    tenantId, documentId, userId: qui.id, username: qui.username, ipAddress: ip,
    action: 'PARTAGE_REVOQUE', details: { partage_id: id },
  });
  await require('./documentIndexService').logHistory(tenantId, documentId, user.id, 'Lien de partage public révoqué', null, null, rows[0].libelle || null);
  return versPartage(rows[0]);
}

// ------------------------------------------------------------------ public

const MESSAGES_REFUS = {
  revoque: [410, 'Ce lien de partage a été révoqué.', 'PARTAGE_REVOQUE'],
  expire: [410, 'Ce lien de partage a expiré.', 'PARTAGE_EXPIRE'],
  epuise: [410, 'Ce lien a atteint son nombre maximal de téléchargements.', 'PARTAGE_EPUISE'],
  version_retiree: [410, "La version partagée n'existe plus.", 'VERSION_RETIREE'],
};

/**
 * Résout un jeton public en lien VALIDE (document disponible, organisation
 * active, partage autorisé, lien ni révoqué, ni expiré, ni épuisé) et en
 * fichier à servir. Lève une erreur { status, code } sinon ; `partage` est
 * joint à l'erreur quand le lien existe (journalisation du refus).
 */
async function resoudre(jeton) {
  if (!JETON_RE.test(String(jeton || ''))) throw erreur(404, 'Lien de partage introuvable.', 'PARTAGE_INTROUVABLE');
  const hash = empreinteJeton(jeton);
  const elimine = (await collaboration.colonneElimination()) ? 'd.elimine_at' : 'NULL::timestamptz';
  const { rows } = await db.query(
    `SELECT p.*, d.reference_mfile, d.nom_entreprise, d.type_document, d.annee, d.description,
            d.deleted_at, ${elimine} AS elimine_at, t.status AS tenant_statut, t.name AS tenant_nom
       FROM document_partages p
       JOIN documents d ON d.id = p.document_id AND d.tenant_id = p.tenant_id
       JOIN tenants t ON t.id = p.tenant_id
      WHERE p.jeton_hash = $1`,
    [hash]
  );
  const p = rows[0];
  // Comparaison à temps constant (l'égalité SQL a déjà tranché ; ceinture et bretelles).
  if (!p || !crypto.timingSafeEqual(Buffer.from(String(p.jeton_hash).trim(), 'hex'), Buffer.from(hash, 'hex'))) {
    throw erreur(404, 'Lien de partage introuvable.', 'PARTAGE_INTROUVABLE');
  }
  const refuser = (status, message, code) => { throw Object.assign(erreur(status, message, code), { partage: p }); };
  if (p.deleted_at || p.elimine_at || (p.tenant_statut && p.tenant_statut !== 'active')) {
    refuser(410, "Ce document n'est plus disponible.", 'DOCUMENT_INDISPONIBLE');
  }
  if (!(await reglages(p.tenant_id)).actif) refuser(403, "Le partage public est désactivé par l'organisation.", 'PARTAGE_DESACTIVE');
  const e = etat(p);
  if (e !== 'actif') refuser(...MESSAGES_REFUS[e]);
  const { rows: fichiers } = p.version_mode === 'fixe'
    ? await db.query('SELECT * FROM document_files WHERE id = $1 AND document_id = $2', [p.fichier_id, p.document_id])
    : await db.query('SELECT * FROM document_files WHERE document_id = $1 ORDER BY version DESC, id DESC LIMIT 1', [p.document_id]);
  if (!fichiers[0]) refuser(410, p.version_mode === 'fixe' ? "La version partagée n'existe plus." : 'Ce document ne contient plus aucun fichier.', 'VERSION_RETIREE');
  return { partage: p, fichier: fichiers[0] };
}

async function organisation(tenantId, req, nomParDefaut) {
  const r = await settingsService.getAll(tenantId);
  return {
    nom: r.site_name && r.site_name !== 'DocuFlow' ? r.site_name : (r.legal_entity || nomParDefaut || r.site_name || 'DocuFlow'),
    logo_url: r.site_logo ? require('../helpers/publicUrl').uploadUrl(req, r.site_logo) : null,
    couleur: r.primary_color || '#0f172a',
  };
}

/** Ce que voit le visiteur : jamais l'identité du créateur ni d'autre version. */
function presentationPublique(p, f) {
  return {
    document: {
      reference: p.reference_mfile,
      titre: p.nom_entreprise,
      type: p.type_document,
      annee: p.annee,
    },
    fichier: {
      nom: f.original_name,
      type: f.mime_type,
      taille: f.file_size,
      version: f.version,
      apercu: TYPES_APERCU.has(f.mime_type),
    },
    libelle: p.libelle,
    expire_at: p.expire_at,
    telechargements_restants: p.max_telechargements == null ? null : Math.max(p.max_telechargements - p.nb_telechargements, 0),
  };
}

async function noterConsultation(p, f, ip, acces) {
  await db.query('UPDATE document_partages SET nb_consultations = nb_consultations + 1, dernier_acces_at = now() WHERE id = $1', [p.id]);
  await journaliserAcces(p, ip, { acces, version: f.version, fichier_id: f.id });
}

async function journaliserAcces(p, ip, details, action = 'PARTAGE_CONSULTE') {
  await documentAuditService.logAction({
    tenantId: p.tenant_id, documentId: p.document_id, userId: null, username: null, ipAddress: ip,
    action, details: { partage_id: p.id, visiteur: 'public', ...details },
  });
}

/**
 * Réserve un téléchargement : UPDATE conditionnel, la base arbitre le plafond.
 * @returns {Promise<boolean>} false = plafond atteint entre-temps.
 */
async function reserverTelechargement(partageId) {
  const { rowCount } = await db.query(
    `UPDATE document_partages SET nb_telechargements = nb_telechargements + 1, dernier_acces_at = now()
      WHERE id = $1 AND revoque_at IS NULL AND expire_at > now()
        AND (max_telechargements IS NULL OR nb_telechargements < max_telechargements)`,
    [partageId]
  );
  return rowCount === 1;
}

/**
 * Source du fichier stocké : flux disque, ou flux Cloudinary relu par URL
 * signée (jamais redirigée : l'URL signée n'expire pas, elle ne doit pas
 * sortir du serveur). @returns {Promise<{flux, taille}|null>} null = introuvable.
 */
async function ouvrirFichier(f) {
  if (!f.cloudinary_public_id) {
    const { FILES_DIR } = require('../config/paths');
    const chemin = path.join(FILES_DIR, path.basename(f.stored_name || ''));
    if (!f.stored_name || !fs.existsSync(chemin)) return null;
    return { flux: fs.createReadStream(chemin), taille: fs.statSync(chemin).size };
  }
  const url = require('./storageService').signedCloudinaryUrl(f);
  if (!url) return null;
  try {
    const rep = await module.exports.http.get(url, { responseType: 'stream', timeout: 120000 });
    return { flux: rep.data, taille: Number(rep.headers?.['content-length']) || null };
  } catch (err) {
    if (err.response && [404, 410].includes(err.response.status)) return null;
    throw err;
  }
}

module.exports = {
  DUREE_MAX_JOURS, TYPES_APERCU, JETON_RE,
  empreinteJeton, nouveauJeton, limiter, echecsDepasses, noterEchec, reinitialiserLimites,
  emettrePreuve, verifierPreuve, etat, versPartage, reglages,
  listerPartages, creerPartage, revoquerPartage,
  resoudre, organisation, presentationPublique, noterConsultation, journaliserAcces,
  reserverTelechargement, ouvrirFichier,
  http: axios,
};
