// ============================================================================
// versionService — restauration d'une version antérieure (« revert »
// d'Alfresco / M-Files), migration 033.
//
// Restaurer ne réécrit RIEN : la version choisie est COPIÉE en une nouvelle
// version, les versions intermédiaires restent consultables. La copie :
//   - est un nouvel objet de stockage (copie disque, ou relecture Cloudinary
//     par URL signée puis nouvel envoi) — jamais un pointeur partagé, qu'une
//     purge de l'une effacerait pour l'autre ;
//   - est relue et comparée à l'empreinte d'archivage de la version source
//     (031) : une source altérée n'est pas restaurée, on ne propage pas une
//     altération sous couvert de « retour en arrière » ;
//   - reprend l'empreinte (identique, contenu identique — origine
//     « versement », datée de la restauration) et le texte indexé (recherche,
//     OCR déjà fait : pas de nouvelle reconnaissance).
// La garde d'écriture (corbeille, archivé, verrou d'autrui, périmètre) et la
// permission documents.manage_versions sont posées par le contrôleur.
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const db = require('../config/db');
const storage = require('./storageService');
const integrite = require('./integriteService');
const documentAuditService = require('./documentAuditService');
const { enregistrerTexte } = require('./contentIndexService');
const { logHistory } = require('./documentIndexService');

const erreur = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

/** Copie locale du fichier stocké, sous un nouveau nom (convention de multer). */
async function copierEnLocal(source) {
  const { FILES_DIR } = require('../config/paths');
  const ext = path.extname(source.original_name || source.stored_name || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const nom = `file_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  const cible = path.join(FILES_DIR, nom);
  if (!source.cloudinary_public_id) {
    const origine = path.join(FILES_DIR, path.basename(source.stored_name || ''));
    if (!source.stored_name || !fs.existsSync(origine)) return null;
    await fs.promises.copyFile(origine, cible, fs.constants.COPYFILE_EXCL);
    return { chemin: cible, nom };
  }
  const url = storage.signedCloudinaryUrl(source);
  if (!url) return null;
  try {
    const rep = await integrite.http.get(url, { responseType: 'stream', timeout: 120000 });
    await pipeline(rep.data, fs.createWriteStream(cible, { flags: 'wx' }));
    return { chemin: cible, nom };
  } catch (err) {
    fs.rmSync(cible, { force: true });
    if (err.response && [404, 410].includes(err.response.status)) return null;
    throw err;
  }
}

/**
 * @returns {Promise<{fichier: object, version: number, version_source: number}>}
 */
async function restaurerVersion(tenantId, documentId, fichierId, user, { ip = null } = {}) {
  const id = Number(fichierId);
  if (!Number.isInteger(id) || id <= 0) throw erreur(400, 'Identifiant de version invalide.');
  const { rows } = await db.query(
    `SELECT f.*, (SELECT max(version) FROM document_files WHERE document_id = f.document_id) AS version_max
       FROM document_files f JOIN documents d ON d.id = f.document_id AND d.tenant_id = $3
      WHERE f.id = $1 AND f.document_id = $2`,
    [id, documentId, tenantId]
  );
  const source = rows[0];
  if (!source) throw erreur(404, 'Version introuvable.');
  if (Number(source.version) === Number(source.version_max)) {
    throw erreur(409, 'Cette version est déjà la version courante.', 'DEJA_COURANTE');
  }

  const copie = await copierEnLocal(source);
  if (!copie) throw erreur(409, `Le fichier de la version ${source.version} est introuvable dans le stockage : restauration impossible.`, 'SOURCE_INTROUVABLE');
  let info = null;
  try {
    const empreinte = await integrite.empreinteFichier(copie.chemin);
    const attendue = source.empreinte_sha256 ? source.empreinte_sha256.trim() : null;
    if (attendue && empreinte !== attendue) {
      throw erreur(409, `La version ${source.version} ne correspond plus à son empreinte d'archivage : restauration refusée.`, 'SOURCE_ALTEREE');
    }
    const taille = fs.statSync(copie.chemin).size;
    info = await storage.saveFile({ path: copie.chemin, filename: copie.nom, originalname: source.original_name, mimetype: source.mime_type, size: taille });

    const client = await db.pool.connect();
    let nouveau;
    try {
      await client.query('BEGIN');
      // Verrou de la ligne du document : deux restaurations simultanées ne
      // prennent pas le même numéro.
      await client.query('SELECT id FROM documents WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [documentId, tenantId]);
      const { rows: v } = await client.query('SELECT COALESCE(max(version), 0) + 1 AS v FROM document_files WHERE document_id = $1', [documentId]);
      const version = v[0].v;
      const disque = !info.cloudinaryPublicId;
      const { rows: ins } = await client.query(
        `INSERT INTO document_files (document_id, version, original_name, stored_name, cloudinary_public_id, mime_type, file_size,
                                     uploaded_by, secure_url, empreinte_sha256, empreinte_at, empreinte_origine,
                                     integrite_statut, integrite_verifiee_at, ocr_tente_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), 'versement', $11, $12, $13) RETURNING *`,
        [documentId, version, source.original_name, info.storedName, info.cloudinaryPublicId, source.mime_type, taille,
          user.id, info.secureUrl || null, empreinte, disque ? 'intacte' : null, disque ? new Date() : null, source.ocr_tente_at || null]
      );
      nouveau = ins[0];
      await enregistrerTexte(client, tenantId, documentId, nouveau.id, source.texte_extrait || '', { source: source.texte_source || 'texte' });
      await client.query(
        'UPDATE documents SET est_numerise = true, version = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3',
        [version, documentId, tenantId]
      );
      await logHistory(tenantId, documentId, user.id, `Version ${version} restaurée (copie de la version ${source.version})`, null, null,
        source.original_name, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const qui = await integrite.identite(user);
    await documentAuditService.logAction({
      tenantId, documentId, userId: user.id, username: qui.username, ipAddress: ip,
      action: 'VERSION_RESTAUREE',
      details: { fichier_source_id: source.id, version_source: source.version, fichier_id: nouveau.id, version: nouveau.version, empreinte_sha256: empreinte },
    });
    const { texte_extrait: _t, ...fichier } = nouveau;
    return { fichier, version: nouveau.version, version_source: source.version };
  } catch (err) {
    // Rien ne doit rester orphelin : ni la copie locale, ni l'objet envoyé.
    if (info) {
      await storage.deleteFile({ storedName: info.storedName, cloudinaryPublicId: info.cloudinaryPublicId, resourceType: source.mime_type }).catch(() => {});
    }
    fs.rmSync(copie.chemin, { force: true });
    throw err;
  }
}

module.exports = { restaurerVersion, copierEnLocal };
