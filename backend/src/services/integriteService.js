// ============================================================================
// integriteService — preuve et intégrité (migration 031, exigences SAE
// NF Z42-013 / ISO 14641).
//
//   EMPREINTES   SHA-256 de chaque fichier, au versement (ou en rattrapage) ;
//                doublons repérés par empreinte.
//   CONTRÔLE     relecture périodique des fichiers stockés : intacte, altérée
//                ou introuvable. Une altération est journalisée et signalée.
//   JOURNAL      vérification de la chaîne d'empreintes du journal d'audit,
//                purges déclarées comprises ; sceaux de la tête de chaîne.
//   GEL          gel juridique (legal hold) : poser, lever, refuser toute
//                destruction d'un document gelé.
//   CERTIFICAT   attestation d'archivage d'un document : fichiers, empreintes,
//                événements, état de la chaîne au moment de l'émission.
// ============================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../config/db');
const aclService = require('./aclService');
const documentAuditService = require('./documentAuditService');

const ZERO = '0'.repeat(64);
const STATUTS = ['intacte', 'alteree', 'introuvable'];
const VERIFICATION_JOURS_DEFAUT = 30;

// La migration 031 est-elle passée ? Vérifié une fois (même précaution que
// contentIndexService.colonnesTexte : une requête en échec dans une
// transaction l'annulerait tout entière).
let migrationPromesse = null;
function migrationPassee() {
  if (!migrationPromesse) {
    migrationPromesse = db.query(
      `SELECT to_regclass('document_gels') IS NOT NULL
          AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'document_files' AND column_name = 'empreinte_origine') AS ok`
    ).then((r) => r.rows[0].ok).catch(() => { migrationPromesse = null; return false; });
  }
  return migrationPromesse;
}

// ---------------------------------------------------------------- empreintes

/** Empreinte SHA-256 (hexadécimal) d'un flux lisible. */
function empreinteFlux(flux) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    flux.on('data', (morceau) => h.update(morceau));
    flux.on('error', reject);
    flux.on('end', () => resolve(h.digest('hex')));
  });
}

const empreinteFichier = (chemin) => empreinteFlux(fs.createReadStream(chemin));
const empreinteTampon = (tampon) => crypto.createHash('sha256').update(tampon).digest('hex');

/**
 * Empreinte d'un fichier reçu (multer), calculée AVANT l'envoi au stockage :
 * en mode Cloudinary, saveFile supprime le fichier temporaire. null si le
 * fichier est illisible — le versement n'échoue pas pour autant, le
 * rattrapage reprendra.
 */
async function empreinteVersement(file) {
  if (!file?.path) return null;
  try {
    return await empreinteFichier(file.path);
  } catch (err) {
    console.warn(`[intégrité] empreinte non calculée (${file.originalname}) : ${err.message}`);
    return null;
  }
}

/**
 * Empreinte du fichier TEL QU'IL EST STOCKÉ (disque, ou Cloudinary par URL
 * signée), lue en flux : aucune limite de taille.
 * @returns {Promise<string|null>} null = fichier introuvable.
 * Lève sur toute autre erreur (réseau, droits) : une panne ne doit jamais
 * passer pour une perte.
 */
async function empreinteStockee(fichier) {
  if (!fichier.cloudinary_public_id) {
    if (!fichier.stored_name) return null;
    const { FILES_DIR } = require('../config/paths');
    const local = path.join(FILES_DIR, fichier.stored_name);
    if (!fs.existsSync(local)) return null;
    return empreinteFichier(local);
  }
  const url = require('./storageService').signedCloudinaryUrl(fichier);
  if (!url) return null;
  try {
    const rep = await module.exports.http.get(url, { responseType: 'stream', timeout: 120000 });
    return await empreinteFlux(rep.data);
  } catch (err) {
    if (err.response && [404, 410].includes(err.response.status)) return null;
    throw err;
  }
}

// ------------------------------------------------------------------ doublons

/**
 * Documents de l'organisation (hors corbeille) qui portent déjà un fichier
 * de même empreinte, bornés au périmètre de l'utilisateur : un doublon dans
 * un dossier qu'il ne peut pas lire ne lui est pas révélé.
 */
async function doublons(tenantId, empreinte, { userId = null, exclureDocumentId = null, run = db, limite = 5 } = {}) {
  if (!empreinte || !(await migrationPassee())) return [];
  const { rows } = await run.query(
    `SELECT DISTINCT ON (d.id) d.id, d.reference_mfile, d.nom_entreprise, d.num_dossier, d.num_acte,
            d.dossier_id, f.version, f.original_name
       FROM document_files f JOIN documents d ON d.id = f.document_id
      WHERE d.tenant_id = $1 AND f.empreinte_sha256 = $2 AND d.deleted_at IS NULL
        AND ($3::int IS NULL OR d.id <> $3)
      ORDER BY d.id, f.version DESC
      LIMIT 20`,
    [tenantId, empreinte, exclureDocumentId]
  );
  if (!rows.length) return [];
  const lisibles = userId ? (await aclService.dossiersAccessibles(tenantId, userId)).lisibles : null;
  return rows
    .filter((r) => !lisibles || r.dossier_id === null || lisibles.has(r.dossier_id))
    .slice(0, limite)
    .map(({ dossier_id: _d, ...r }) => r);
}

/** Groupes de documents partageant un même fichier (vue Archivage). */
async function groupesDoublons(tenantId, user, { limite = 50 } = {}) {
  if (!(await migrationPassee())) return [];
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  const { rows } = await db.query(
    `SELECT f.empreinte_sha256 AS empreinte,
            json_agg(DISTINCT jsonb_build_object('id', d.id, 'reference_mfile', d.reference_mfile,
                     'nom_entreprise', d.nom_entreprise, 'dossier_id', d.dossier_id)) AS documents,
            max(f.original_name) AS nom_fichier, max(f.file_size) AS taille
       FROM document_files f JOIN documents d ON d.id = f.document_id
      WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND f.empreinte_sha256 IS NOT NULL
      GROUP BY f.empreinte_sha256
     HAVING count(DISTINCT d.id) > 1
      ORDER BY count(DISTINCT d.id) DESC, max(f.id) DESC
      LIMIT $2`,
    [tenantId, limite]
  );
  return rows
    .map((g) => ({
      ...g,
      documents: g.documents
        .filter((d) => d.dossier_id === null || lisibles.has(d.dossier_id))
        .map(({ dossier_id: _d, ...d }) => d)
        .sort((a, b) => a.id - b.id),
    }))
    .filter((g) => g.documents.length > 1);
}

// ------------------------------------------------------- contrôle d'intégrité

/**
 * Destinataires des alertes d'archivage : les comptes de l'organisation dont
 * le rôle porte la permission (ou le joker).
 */
async function destinataires(tenantId, permission) {
  const { rows } = await db.query(
    `SELECT u.id FROM users u
       JOIN roles r ON r.tenant_id = u.tenant_id AND r.key = u.role AND r.is_active
      WHERE u.tenant_id = $1 AND ('*' = ANY(r.permissions) OR $2 = ANY(r.permissions))`,
    [tenantId, permission]
  );
  return rows.map((r) => r.id);
}

async function notifier(tenantId, userIds, { titre, message, documentId = null, type = 'archives' }) {
  for (const id of userIds) {
    try {
      await db.query(
        `INSERT INTO notifications (id_user, title, message, type, tenant_id, document_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, titre.slice(0, 255), message, type, tenantId, documentId]
      );
    } catch (err) {
      console.warn('[intégrité] notification non enregistrée :', err.message);
    }
  }
}

/**
 * Relit UN fichier stocké et compare à son empreinte. Enregistre le
 * constat ; une dégradation (ou son rétablissement) est journalisée, et une
 * dégradation signalée aux gestionnaires de l'archivage.
 * @param {object} f ligne document_files + tenant_id
 */
async function verifierFichierLigne(f, { acteur = null } = {}) {
  const constatee = await empreinteStockee(f);
  let statut;
  if (!f.empreinte_sha256) statut = constatee ? 'intacte' : 'introuvable';
  else if (constatee === null) statut = 'introuvable';
  else statut = constatee === f.empreinte_sha256.trim() ? 'intacte' : 'alteree';

  if (!f.empreinte_sha256 && constatee) {
    // Première empreinte de ce fichier (rattrapage) : elle prouve l'intégrité
    // à partir de maintenant, pas depuis le versement.
    await db.query(
      `UPDATE document_files SET empreinte_sha256 = $1, empreinte_at = now(), empreinte_origine = 'rattrapage',
              integrite_statut = 'intacte', integrite_verifiee_at = now() WHERE id = $2`,
      [constatee, f.id]
    );
  } else {
    await db.query('UPDATE document_files SET integrite_statut = $1, integrite_verifiee_at = now() WHERE id = $2', [statut, f.id]);
  }

  const avant = f.integrite_statut || null;
  if (statut !== avant && (statut !== 'intacte' || (avant && avant !== 'intacte'))) {
    const action = statut === 'alteree' ? 'INTEGRITE_ALTEREE' : statut === 'introuvable' ? 'FICHIER_INTROUVABLE' : 'INTEGRITE_RETABLIE';
    const qui = await identite(acteur);
    await documentAuditService.logAction({
      tenantId: f.tenant_id, documentId: f.document_id, userId: qui.id, username: qui.username,
      action, details: { fichier_id: f.id, version: f.version, nom: f.original_name, attendue: f.empreinte_sha256 || null, constatee },
    });
    // Signalé : toute altération, et la disparition d'un fichier qui avait été
    // vérifié intact. Le rattrapage qui découvre d'anciens fichiers perdus (disque
    // éphémère d'avant Cloudinary) journalise sans inonder les gestionnaires.
    if (statut === 'alteree' || (statut === 'introuvable' && avant === 'intacte')) {
      const ref = f.reference_mfile || `document ${f.document_id}`;
      await notifier(f.tenant_id, await destinataires(f.tenant_id, 'archives.manage'), {
        titre: statut === 'alteree' ? `Fichier altéré : ${ref}` : `Fichier introuvable : ${ref}`,
        message: statut === 'alteree'
          ? `La version ${f.version} (« ${f.original_name} ») ne correspond plus à son empreinte d'archivage. Le fichier a été modifié hors de DocuFlow.`
          : `La version ${f.version} (« ${f.original_name} ») est introuvable dans le stockage.`,
        documentId: f.document_id,
      });
    }
  }
  return {
    fichier_id: f.id, version: f.version, nom: f.original_name, statut,
    empreinte_attendue: f.empreinte_sha256 ? f.empreinte_sha256.trim() : null, empreinte_constatee: constatee,
  };
}

const LIGNE_FICHIER = `SELECT f.*, d.tenant_id, d.reference_mfile
                         FROM document_files f JOIN documents d ON d.id = f.document_id`;

/** Vérifie maintenant tous les fichiers d'un document. */
async function verifierDocument(tenantId, documentId, { acteur = null } = {}) {
  const { rows } = await db.query(`${LIGNE_FICHIER} WHERE d.id = $1 AND d.tenant_id = $2 ORDER BY f.version`, [documentId, tenantId]);
  const resultats = [];
  for (const f of rows) {
    try {
      resultats.push(await verifierFichierLigne(f, { acteur }));
    } catch (err) {
      resultats.push({ fichier_id: f.id, version: f.version, nom: f.original_name, statut: 'erreur', erreur: err.message });
    }
  }
  return resultats;
}

/**
 * Rattrapage : empreinte des fichiers versés avant la 031 (ou dont le calcul
 * a échoué). Chaque tentative est datée : un fichier injoignable ne bloque
 * pas la file, il est repris le lendemain.
 */
async function rattraperEmpreintes({ lot = 10, tenantId = null } = {}) {
  if (!(await migrationPassee())) return 0;
  const { rows } = await db.query(
    `${LIGNE_FICHIER}
      WHERE f.empreinte_sha256 IS NULL AND f.integrite_statut IS NULL
        AND ($2::int IS NULL OR d.tenant_id = $2)
        AND (f.integrite_verifiee_at IS NULL OR f.integrite_verifiee_at < now() - interval '1 day')
      ORDER BY f.id DESC LIMIT $1`,
    [lot, tenantId]
  );
  for (const f of rows) {
    try {
      await verifierFichierLigne(f);
    } catch (err) {
      await db.query('UPDATE document_files SET integrite_verifiee_at = now() WHERE id = $1', [f.id]);
      console.warn(`[intégrité] fichier ${f.id} injoignable, repris plus tard : ${err.message}`);
    }
  }
  return rows.length;
}

/**
 * Contrôle périodique : les fichiers dont la dernière vérification dépasse
 * la période de l'organisation (réglage integrite_verification_jours), les
 * jamais vérifiés d'abord.
 */
async function verifierLot({ lot = 10, tenantId = null, acteur = null } = {}) {
  if (!(await migrationPassee())) return [];
  const { rows } = await db.query(
    `${LIGNE_FICHIER}
      WHERE f.empreinte_sha256 IS NOT NULL
        AND ($2::int IS NULL OR d.tenant_id = $2)
        AND (f.integrite_verifiee_at IS NULL OR f.integrite_verifiee_at < now() - make_interval(days => COALESCE(
              (SELECT CASE WHEN s.value ~ '^[0-9]{1,3}$' THEN s.value::int END FROM settings s
                WHERE s.tenant_id = d.tenant_id AND s.key = 'integrite_verification_jours'), ${VERIFICATION_JOURS_DEFAUT})))
      ORDER BY f.integrite_verifiee_at NULLS FIRST, f.id
      LIMIT $1`,
    [lot, tenantId]
  );
  const resultats = [];
  for (const f of rows) {
    try {
      resultats.push(await verifierFichierLigne(f, { acteur }));
    } catch (err) {
      // Panne d'accès : rien n'est conclu, le fichier reste en tête de file.
      console.warn(`[intégrité] vérification du fichier ${f.id} différée : ${err.message}`);
    }
  }
  return resultats;
}

/** Fichiers altérés ou introuvables, bornés au périmètre de l'utilisateur. */
async function anomalies(tenantId, user) {
  if (!(await migrationPassee())) return [];
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  const { rows } = await db.query(
    `SELECT f.id AS fichier_id, f.version, f.original_name, f.integrite_statut, f.integrite_verifiee_at,
            f.empreinte_sha256, d.id AS document_id, d.reference_mfile, d.nom_entreprise, d.dossier_id,
            (d.deleted_at IS NOT NULL) AS en_corbeille
       FROM document_files f JOIN documents d ON d.id = f.document_id
      WHERE d.tenant_id = $1 AND f.integrite_statut IN ('alteree', 'introuvable')
      ORDER BY f.integrite_statut, f.integrite_verifiee_at DESC
      LIMIT 200`,
    [tenantId]
  );
  return rows.filter((r) => r.dossier_id === null || lisibles.has(r.dossier_id)).map(({ dossier_id: _d, ...r }) => ({
    ...r, empreinte_sha256: r.empreinte_sha256 ? r.empreinte_sha256.trim() : null,
  }));
}

// ------------------------------------------------------------ journal chaîné

/**
 * Vérifie la chaîne du journal d'une organisation, de bout en bout :
 *   - contenu : chaque ligne recalculée doit redonner son empreinte ;
 *   - liaison : chaque maillon doit citer l'empreinte du précédent ;
 *   - continuité : rangs consécutifs (une ligne retirée hors purge déclarée
 *     laisse un trou) ;
 *   - tête : le dernier maillon doit être celui que retient la tête (une
 *     troncature de la fin est sinon indétectable) ;
 *   - sceaux : chaque sceau doit retrouver son maillon.
 * Les purges déclarées (014) sont enjambées par leurs empreintes de bord.
 */
async function verifierJournal(tenantId) {
  const { rows } = await db.query(
    `WITH maillons AS (
       SELECT a.chaine_rang AS debut, a.chaine_rang AS fin, a.chaine_precedent::text AS precedent,
              a.chaine_hash::text AS hash, audit_empreinte_ligne(a)::text = a.chaine_hash::text AS contenu_ok,
              a.id AS audit_id, false AS purge
         FROM audit_logs a WHERE a.tenant_id = $1 AND a.chaine_hash IS NOT NULL
       UNION ALL
       SELECT p.rang_debut, p.rang_fin, p.precedent::text, p.hash_fin::text, true, NULL, true
         FROM audit_chaine_purges p WHERE p.tenant_id = $1
     ), ordonnes AS (
       SELECT m.*, lag(m.fin) OVER w AS fin_avant, lag(m.hash) OVER w AS hash_avant
         FROM maillons m WINDOW w AS (ORDER BY m.debut, m.fin)
     ), constats AS (
       SELECT o.*, CASE
                WHEN NOT o.contenu_ok THEN 'alteree'
                WHEN o.debut <> COALESCE(o.fin_avant, 0) + 1 THEN 'discontinuite'
                WHEN o.precedent <> COALESCE(o.hash_avant, $2) THEN 'rupture'
              END AS anomalie
         FROM ordonnes o
     )
     SELECT
       (SELECT count(*) FROM constats WHERE NOT purge)::int AS lignes,
       (SELECT COALESCE(sum(fin - debut + 1), 0) FROM constats WHERE purge)::int AS purgees,
       (SELECT count(*) FROM constats WHERE purge)::int AS purges,
       (SELECT max(fin) FROM constats) AS dernier_rang,
       (SELECT hash FROM constats ORDER BY fin DESC LIMIT 1) AS dernier_hash,
       (SELECT count(*) FROM constats WHERE anomalie IS NOT NULL)::int AS nb_anomalies,
       (SELECT COALESCE(json_agg(x ORDER BY x.debut), '[]') FROM (
          SELECT debut, fin, anomalie, audit_id, purge FROM constats WHERE anomalie IS NOT NULL ORDER BY debut LIMIT 20) x) AS anomalies,
       (SELECT count(*) FROM audit_logs WHERE tenant_id = $1 AND chaine_hash IS NULL)::int AS anterieures,
       (SELECT row_to_json(t) FROM (SELECT dernier_rang, dernier_hash::text AS dernier_hash, maj_at
                                      FROM audit_chaine_tetes WHERE tenant_id = $1) t) AS tete,
       (SELECT COALESCE(json_agg(s ORDER BY s.scelle_at DESC), '[]') FROM (
          SELECT sc.id, sc.chaine_rang, sc.chaine_hash::text AS chaine_hash, sc.origine, sc.scelle_par_nom, sc.scelle_at,
                 (SELECT c.hash FROM constats c WHERE c.fin = sc.chaine_rang LIMIT 1) AS hash_trouve,
                 EXISTS (SELECT 1 FROM constats c WHERE c.purge AND sc.chaine_rang BETWEEN c.debut AND c.fin - 1) AS dans_purge
            FROM audit_sceaux sc WHERE sc.tenant_id = $1) s) AS sceaux`,
    [tenantId, ZERO]
  );
  const r = rows[0];
  const dernierRang = r.dernier_rang === null ? 0 : Number(r.dernier_rang);
  const tete = r.tete ? { rang: Number(r.tete.dernier_rang), hash: r.tete.dernier_hash, maj_at: r.tete.maj_at } : { rang: 0, hash: ZERO, maj_at: null };
  const teteOk = tete.rang === dernierRang && (dernierRang === 0 || tete.hash === r.dernier_hash);
  const sceaux = r.sceaux.map((s) => ({
    id: s.id, rang: Number(s.chaine_rang), hash: s.chaine_hash, origine: s.origine, scelle_par: s.scelle_par_nom, scelle_at: s.scelle_at,
    etat: s.hash_trouve === s.chaine_hash ? 'conforme' : (s.dans_purge ? 'non_verifiable' : 'non_conforme'),
  }));
  const sceauxKo = sceaux.filter((s) => s.etat === 'non_conforme').length;
  return {
    integre: r.nb_anomalies === 0 && teteOk && sceauxKo === 0,
    verifie_at: new Date().toISOString(),
    lignes: r.lignes,
    lignes_purgees: r.purgees,
    purges_declarees: r.purges,
    lignes_anterieures: r.anterieures,
    dernier_rang: dernierRang,
    dernier_hash: r.dernier_hash || ZERO,
    anomalies: { total: r.nb_anomalies, premieres: r.anomalies },
    tete: { ...tete, conforme: teteOk },
    sceaux: { total: sceaux.length, non_conformes: sceauxKo, liste: sceaux.slice(0, 30) },
  };
}

/** État courant de la tête de chaîne (sans vérification). */
async function teteChaine(tenantId, run = db) {
  const { rows } = await run.query('SELECT dernier_rang, dernier_hash::text AS dernier_hash, maj_at FROM audit_chaine_tetes WHERE tenant_id = $1', [tenantId]);
  return rows[0] ? { rang: Number(rows[0].dernier_rang), hash: rows[0].dernier_hash, maj_at: rows[0].maj_at } : { rang: 0, hash: ZERO, maj_at: null };
}

/**
 * Scelle la tête de chaîne. Un sceau manuel identique au dernier n'est pas
 * dupliqué (rien n'a été journalisé depuis) : le sceau existant est rendu.
 */
async function sceller(tenantId, { user = null, origine = 'manuel' } = {}) {
  const tete = await teteChaine(tenantId);
  if (!tete.rang) {
    const err = new Error("Le journal chaîné est encore vide : rien à sceller.");
    err.status = 409;
    throw err;
  }
  const dernier = await db.query(
    'SELECT * FROM audit_sceaux WHERE tenant_id = $1 ORDER BY scelle_at DESC, id DESC LIMIT 1', [tenantId]);
  if (dernier.rows[0] && Number(dernier.rows[0].chaine_rang) === tete.rang) return { ...versSceau(dernier.rows[0]), nouveau: false };
  const qui = await identite(user);
  const { rows } = await db.query(
    `INSERT INTO audit_sceaux (tenant_id, chaine_rang, chaine_hash, origine, scelle_par, scelle_par_nom)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tenantId, tete.rang, tete.hash, origine, qui.id, qui.nom]
  );
  return { ...versSceau(rows[0]), nouveau: true };
}

function versSceau(s) {
  return { id: s.id, rang: Number(s.chaine_rang), hash: String(s.chaine_hash).trim(), origine: s.origine, scelle_par: s.scelle_par_nom, scelle_at: s.scelle_at };
}

async function listerSceaux(tenantId, { limite = 500 } = {}) {
  const { rows } = await db.query('SELECT * FROM audit_sceaux WHERE tenant_id = $1 ORDER BY scelle_at DESC, id DESC LIMIT $2', [tenantId, limite]);
  return rows.map(versSceau);
}

/**
 * Sceau automatique quotidien de chaque organisation dont le journal a
 * avancé depuis le dernier sceau (réglage journal_scellement_auto).
 */
async function scellerAutomatiquement() {
  if (!(await migrationPassee())) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO audit_sceaux (tenant_id, chaine_rang, chaine_hash, origine)
     SELECT t.tenant_id, t.dernier_rang, t.dernier_hash, 'auto'
       FROM audit_chaine_tetes t
      WHERE t.dernier_rang > 0
        AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.tenant_id = t.tenant_id
                         AND s.key = 'journal_scellement_auto' AND s.value = 'false')
        AND NOT EXISTS (SELECT 1 FROM audit_sceaux s WHERE s.tenant_id = t.tenant_id
                         AND (s.scelle_at > now() - interval '24 hours' OR s.chaine_rang >= t.dernier_rang))`
  );
  return rowCount;
}

function sceauxEnCsv(sceaux, organisation) {
  const echap = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lignes = [['organisation', 'rang', 'empreinte_sha256', 'origine', 'scelle_par', 'scelle_le']]
    .concat(sceaux.map((s) => [organisation, s.rang, s.hash, s.origine, s.scelle_par || '', new Date(s.scelle_at).toISOString()]));
  return `﻿${lignes.map((l) => l.map(echap).join(';')).join('\r\n')}\r\n`;
}

// --------------------------------------------------------------- gel juridique

function erreurGel(gel) {
  const err = new Error(`Document sous gel juridique${gel?.reference ? ` (réf. ${gel.reference})` : ''} : aucune destruction n'est possible tant que le gel n'est pas levé.`);
  err.status = 409;
  err.code = 'GEL_JURIDIQUE';
  err.gel = gel || null;
  return err;
}

/** L'erreur vient-elle du refus d'un gel (code applicatif ou trigger 031) ? */
function estErreurGel(err) {
  return Boolean(err) && (err.code === 'GEL_JURIDIQUE' || /GEL_JURIDIQUE/.test(String(err.message || '')));
}

/** Réponse HTTP 409 uniforme d'un refus pour gel. */
function reponseGel(res, gel) {
  const err = erreurGel(gel);
  return res.status(409).json({ message: err.message, code: err.code, gel: gel ? versGel(gel) : null });
}

function versGel(g) {
  return {
    id: g.id, document_id: g.document_id, motif: g.motif, reference: g.reference,
    pose_par: g.pose_par_nom, pose_at: g.pose_at, leve_par: g.leve_par_nom, leve_at: g.leve_at, motif_levee: g.motif_levee,
  };
}

async function gelActif(tenantId, documentId, run = db) {
  if (!(await migrationPassee())) return null;
  const { rows } = await run.query(
    'SELECT * FROM document_gels WHERE tenant_id = $1 AND document_id = $2 AND leve_at IS NULL', [tenantId, documentId]);
  return rows[0] || null;
}

/** Identifiants gelés parmi une liste (traitements par lots : rétention…). */
async function documentsGeles(tenantId, ids) {
  if (!ids.length || !(await migrationPassee())) return new Set();
  const { rows } = await db.query(
    'SELECT document_id FROM document_gels WHERE tenant_id = $1 AND document_id = ANY($2::int[]) AND leve_at IS NULL', [tenantId, ids]);
  return new Set(rows.map((r) => r.document_id));
}

/**
 * Identité affichable de l'acteur. Le jeton ne porte que l'identifiant :
 * le nom est relu en base (un gel, un sceau, un certificat se signent d'un nom).
 */
async function identite(user) {
  if (!user?.id) return { id: null, nom: null, username: null };
  if (user.full_name && user.username) return { id: user.id, nom: user.full_name, username: user.username };
  const { rows } = await db.query('SELECT full_name, username FROM users WHERE id = $1', [user.id]);
  const u = rows[0] || {};
  return { id: user.id, nom: u.full_name || u.username || `Utilisateur ${user.id}`, username: u.username || null };
}

async function poserGel(tenantId, documentId, { motif, reference } = {}, user) {
  const m = String(motif || '').trim();
  const ref = String(reference || '').trim();
  if (!m) throw Object.assign(new Error('Le motif du gel est obligatoire (contentieux, contrôle, enquête…).'), { status: 400 });
  if (m.length > 2000) throw Object.assign(new Error('Motif trop long (2 000 caractères au plus).'), { status: 400 });
  if (ref.length > 120) throw Object.assign(new Error('Référence trop longue (120 caractères au plus).'), { status: 400 });
  const qui = await identite(user);
  let gel;
  try {
    const { rows } = await db.query(
      `INSERT INTO document_gels (tenant_id, document_id, motif, reference, pose_par, pose_par_nom)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, documentId, m, ref || null, qui.id, qui.nom]
    );
    gel = rows[0];
  } catch (err) {
    if (err.code === '23505') throw Object.assign(new Error('Ce document est déjà sous gel juridique.'), { status: 409, code: 'DEJA_GELE' });
    throw err;
  }
  await documentAuditService.logAction({
    tenantId, documentId, userId: qui.id, username: qui.username,
    action: 'GEL_POSE', details: { gel_id: gel.id, motif: m, reference: ref || null },
  });
  await require('./documentIndexService').logHistory(tenantId, documentId, user?.id || null,
    `Gel juridique posé${ref ? ` (réf. ${ref})` : ''}`.slice(0, 100), null, null, m.slice(0, 500));
  return versGel(gel);
}

async function leverGel(tenantId, documentId, { motif } = {}, user) {
  const m = String(motif || '').trim();
  if (!m) throw Object.assign(new Error('Le motif de la levée est obligatoire (décision, clôture de l\'affaire…).'), { status: 400 });
  if (m.length > 2000) throw Object.assign(new Error('Motif trop long (2 000 caractères au plus).'), { status: 400 });
  const qui = await identite(user);
  const { rows } = await db.query(
    `UPDATE document_gels SET leve_at = now(), leve_par = $3, leve_par_nom = $4, motif_levee = $5
      WHERE tenant_id = $1 AND document_id = $2 AND leve_at IS NULL RETURNING *`,
    [tenantId, documentId, qui.id, qui.nom, m]
  );
  if (!rows[0]) throw Object.assign(new Error("Ce document n'est pas sous gel juridique."), { status: 404 });
  await documentAuditService.logAction({
    tenantId, documentId, userId: qui.id, username: qui.username,
    action: 'GEL_LEVE', details: { gel_id: rows[0].id, motif_levee: m },
  });
  await require('./documentIndexService').logHistory(tenantId, documentId, user?.id || null,
    'Gel juridique levé', null, null, m.slice(0, 500));
  return versGel(rows[0]);
}

async function listerGels(tenantId, user, { actifs = true } = {}) {
  if (!(await migrationPassee())) return [];
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  const { rows } = await db.query(
    `SELECT g.*, d.reference_mfile, d.nom_entreprise, d.num_dossier, d.num_acte, d.dossier_id,
            (d.deleted_at IS NOT NULL) AS en_corbeille
       FROM document_gels g JOIN documents d ON d.id = g.document_id
      WHERE g.tenant_id = $1 AND ($2::boolean IS FALSE OR g.leve_at IS NULL)
      ORDER BY g.leve_at IS NULL DESC, COALESCE(g.leve_at, g.pose_at) DESC
      LIMIT 500`,
    [tenantId, actifs]
  );
  return rows
    .filter((r) => r.dossier_id === null || lisibles.has(r.dossier_id))
    .map((r) => ({
      ...versGel(r), reference_mfile: r.reference_mfile, nom_entreprise: r.nom_entreprise,
      num_dossier: r.num_dossier, num_acte: r.num_acte, en_corbeille: r.en_corbeille,
    }));
}

// ------------------------------------------------------------ fiche & rapport

/** Volet « Intégrité & preuve » de la fiche d'un document. */
async function etatDocument(tenantId, documentId, user) {
  const { rows: fichiers } = await db.query(
    `SELECT id, version, original_name, mime_type, file_size, created_at, empreinte_sha256, empreinte_at,
            empreinte_origine, integrite_statut, integrite_verifiee_at
       FROM document_files WHERE document_id = $1 ORDER BY version DESC`,
    [documentId]
  );
  const liste = [];
  for (const f of fichiers) {
    const empreinte = f.empreinte_sha256 ? f.empreinte_sha256.trim() : null;
    liste.push({
      ...f, empreinte_sha256: empreinte,
      doublons: empreinte ? await doublons(tenantId, empreinte, { userId: user.id, exclureDocumentId: documentId }) : [],
    });
  }
  const gel = await gelActif(tenantId, documentId);
  const { rows: evts } = await db.query(
    `SELECT count(*)::int AS n, count(chaine_hash)::int AS chaines FROM audit_logs
      WHERE tenant_id = $1 AND object_type = 'document' AND object_id = $2`,
    [tenantId, documentId]
  );
  return { fichiers: liste, gel: gel ? versGel(gel) : null, evenements: evts[0] };
}

/** Chiffres de l'onglet Intégrité de la page Archivage. */
async function rapport(tenantId) {
  const [fichiers, nbDoublons, gels, tete, dernierSceau, anterieures] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS total,
              count(f.empreinte_sha256)::int AS avec_empreinte,
              count(*) FILTER (WHERE f.integrite_statut = 'intacte')::int AS intactes,
              count(*) FILTER (WHERE f.integrite_statut = 'alteree')::int AS alterees,
              count(*) FILTER (WHERE f.integrite_statut = 'introuvable')::int AS introuvables,
              count(*) FILTER (WHERE f.empreinte_sha256 IS NOT NULL AND f.integrite_statut IS NULL)::int AS en_attente,
              count(*) FILTER (WHERE f.empreinte_origine = 'rattrapage')::int AS rattrapees,
              max(f.integrite_verifiee_at) AS derniere_verification
         FROM document_files f JOIN documents d ON d.id = f.document_id
        WHERE d.tenant_id = $1`, [tenantId]),
    db.query(
      `SELECT count(*)::int AS n FROM (
         SELECT f.empreinte_sha256 FROM document_files f JOIN documents d ON d.id = f.document_id
          WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND f.empreinte_sha256 IS NOT NULL
          GROUP BY f.empreinte_sha256 HAVING count(DISTINCT d.id) > 1) x`, [tenantId]),
    db.query('SELECT count(*)::int AS n FROM document_gels WHERE tenant_id = $1 AND leve_at IS NULL', [tenantId]),
    teteChaine(tenantId),
    db.query('SELECT * FROM audit_sceaux WHERE tenant_id = $1 ORDER BY scelle_at DESC, id DESC LIMIT 1', [tenantId]),
    db.query('SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND chaine_hash IS NULL', [tenantId]),
  ]);
  return {
    fichiers: fichiers.rows[0],
    doublons: nbDoublons.rows[0].n,
    gels_actifs: gels.rows[0].n,
    journal: {
      tete, lignes_anterieures: anterieures.rows[0].n,
      dernier_sceau: dernierSceau.rows[0] ? versSceau(dernierSceau.rows[0]) : null,
    },
  };
}

// ------------------------------------------------------------------ certificat

const LIBELLES_ACTIONS = {
  FILE_DOWNLOADED: 'Fichier consulté ou téléchargé', METADATA_UPDATE: 'Métadonnées modifiées', RELATION_CREATED: 'Relation créée',
  GEL_POSE: 'Gel juridique posé', GEL_LEVE: 'Gel juridique levé', INTEGRITE_ALTEREE: 'Altération constatée',
  FICHIER_INTROUVABLE: 'Fichier introuvable', INTEGRITE_RETABLIE: 'Intégrité rétablie', CERTIFICAT_EMIS: 'Certificat émis',
};

/**
 * Certificat d'archivage d'un document. Son contenu est figé dans une
 * empreinte (empreinte_certificat), elle-même inscrite au journal chaîné :
 * un certificat présenté plus tard se vérifie contre le journal.
 */
async function certificat(tenantId, documentId, user) {
  const { rows } = await db.query(
    `SELECT d.id, d.reference_mfile, d.nom_entreprise, d.num_dossier, d.num_acte, d.annee, d.type_document,
            d.description, d.date_document, d.statut, d.created_at, d.deleted_at,
            c.name AS classe, fo.name AS dossier, t.name AS organisation
       FROM documents d
       JOIN tenants t ON t.id = d.tenant_id
       LEFT JOIN metadata_schemas c ON c.id = d.classe_id AND c.tenant_id = d.tenant_id
       LEFT JOIN document_folders fo ON fo.id = d.dossier_id AND fo.tenant_id = d.tenant_id
      WHERE d.id = $1 AND d.tenant_id = $2`,
    [documentId, tenantId]
  );
  const doc = rows[0];
  if (!doc) return null;
  const { rows: fichiers } = await db.query(
    `SELECT version, original_name, mime_type, file_size, created_at, empreinte_sha256, empreinte_at,
            empreinte_origine, integrite_statut, integrite_verifiee_at
       FROM document_files WHERE document_id = $1 ORDER BY version`,
    [documentId]
  );
  const { rows: evenements } = await db.query(
    `SELECT a.action, COALESCE(a.occurred_at, a."timestamp") AS date, COALESCE(u.full_name, a.actor_username, a.user_name) AS acteur,
            a.chaine_rang, a.chaine_hash::text AS chaine_hash
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id AND u.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1 AND a.object_type = 'document' AND a.object_id = $2
      ORDER BY COALESCE(a.occurred_at, a."timestamp"), a.id
      LIMIT 200`,
    [tenantId, documentId]
  );
  const gel = await gelActif(tenantId, documentId);
  const settingsService = require('./settingsService');
  const reglages = await settingsService.getAll(tenantId);
  const tete = await teteChaine(tenantId);
  const dernierSceau = (await db.query('SELECT * FROM audit_sceaux WHERE tenant_id = $1 ORDER BY scelle_at DESC, id DESC LIMIT 1', [tenantId])).rows[0];

  const qui = await identite(user);
  const emisAt = new Date();
  const numero = `CERT-${tenantId}-${documentId}-${emisAt.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const corps = {
    numero,
    emis_at: emisAt.toISOString(),
    emis_par: qui.nom,
    organisation: reglages.legal_entity || doc.organisation,
    document: {
      reference: doc.reference_mfile, entreprise: doc.nom_entreprise, dossier_numero: doc.num_dossier, acte: doc.num_acte,
      annee: doc.annee, type: doc.type_document, classe: doc.classe, dossier: doc.dossier, statut: doc.statut,
      date_document: doc.date_document, cree_le: doc.created_at, en_corbeille: Boolean(doc.deleted_at),
    },
    fichiers: fichiers.map((f) => ({
      version: f.version, nom: f.original_name, type: f.mime_type, taille: f.file_size, verse_le: f.created_at,
      empreinte_sha256: f.empreinte_sha256 ? f.empreinte_sha256.trim() : null, empreinte_le: f.empreinte_at,
      empreinte_origine: f.empreinte_origine, integrite: f.integrite_statut, verifie_le: f.integrite_verifiee_at,
    })),
    evenements: evenements.map((e) => ({
      action: LIBELLES_ACTIONS[e.action] || e.action, date: e.date, acteur: e.acteur,
      rang: e.chaine_rang === null ? null : Number(e.chaine_rang), empreinte: e.chaine_hash,
    })),
    gel: gel ? versGel(gel) : null,
    journal: { rang: tete.rang, empreinte: tete.hash, dernier_sceau: dernierSceau ? versSceau(dernierSceau) : null },
  };
  const empreinte = empreinteTampon(Buffer.from(JSON.stringify(corps), 'utf8'));
  await documentAuditService.logAction({
    tenantId, documentId, userId: qui.id, username: qui.username,
    action: 'CERTIFICAT_EMIS', details: { numero, empreinte_certificat: empreinte },
  });
  return { ...corps, empreinte_certificat: empreinte };
}

/**
 * Un certificat présenté (numéro + empreinte) a-t-il bien été émis ici ?
 * La réponse vient du journal chaîné, pas du document lui-même.
 */
async function verifierCertificat(tenantId, numero, empreinte = null) {
  const n = String(numero || '').trim();
  if (!/^CERT-\d+-\d+-\d{14}$/.test(n)) return { trouve: false, motif: 'format' };
  const { rows } = await db.query(
    `SELECT a.details_json->>'empreinte_certificat' AS empreinte, COALESCE(a.occurred_at, a."timestamp") AS emis_at,
            a.chaine_rang, a.actor_username, d.reference_mfile
       FROM audit_logs a LEFT JOIN documents d ON d.id = a.object_id AND d.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1 AND a.action = 'CERTIFICAT_EMIS' AND a.details_json->>'numero' = $2
      ORDER BY a.id LIMIT 1`,
    [tenantId, n]
  );
  const r = rows[0];
  if (!r) return { trouve: false, motif: 'inconnu' };
  const attendue = String(empreinte || '').trim().toLowerCase();
  return {
    trouve: true,
    conforme: attendue ? attendue === r.empreinte : null,
    empreinte_certificat: r.empreinte,
    emis_at: r.emis_at,
    rang_journal: r.chaine_rang === null ? null : Number(r.chaine_rang),
    document: r.reference_mfile || null,
  };
}

// ---------------------------------------------------------- tâche de fond

/**
 * Travail de fond : rattrapage des empreintes, contrôle périodique, sceau
 * quotidien. Un lot par minute tant qu'il reste du travail, puis un passage
 * toutes les 30 minutes. Ne retient pas le processus et ne le fait jamais
 * tomber.
 */
function demarrerIntegrite() {
  let delai = 60000;
  const tour = async () => {
    try {
      const rattrapes = await rattraperEmpreintes({ lot: 10 });
      const verifies = await verifierLot({ lot: 10 });
      const sceaux = await scellerAutomatiquement();
      if (sceaux) console.log(`[intégrité] ${sceaux} journal(aux) scellé(s)`);
      delai = rattrapes || verifies.length ? 60000 : 30 * 60000;
    } catch (err) {
      console.warn('[intégrité] passage différé :', err.message);
      delai = 10 * 60000;
    }
    setTimeout(tour, delai).unref();
  };
  setTimeout(tour, 120000).unref();
}

module.exports = {
  ZERO, STATUTS, migrationPassee,
  empreinteFlux, empreinteFichier, empreinteTampon, empreinteVersement, empreinteStockee,
  doublons, groupesDoublons,
  verifierFichierLigne, verifierDocument, rattraperEmpreintes, verifierLot, anomalies,
  verifierJournal, teteChaine, sceller, listerSceaux, scellerAutomatiquement, sceauxEnCsv,
  erreurGel, estErreurGel, reponseGel, gelActif, documentsGeles, poserGel, leverGel, listerGels,
  etatDocument, rapport, certificat, verifierCertificat, destinataires, identite,
  demarrerIntegrite,
  http: axios,
};
