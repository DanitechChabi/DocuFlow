// ============================================================================
// contentIndexService — le texte des fichiers alimente la recherche (027).
//
// - enregistrerTexte : à l'ajout d'un fichier, son texte (extrait AVANT
//   l'envoi vers Cloudinary, qui supprime le fichier temporaire) est conservé
//   sur la version, et le texte de toutes les versions recopié sur le
//   document — le trigger de 027 le verse dans l'index plein texte.
// - rattraperContenu : les fichiers versés avant 027 (ou dont l'extraction a
//   échoué faute de fichier local) sont traités en arrière-plan, quelques-uns
//   à la fois, sans action de qui que ce soit. Un fichier Cloudinary est
//   relu par URL signée.
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../config/db');
const { extractText } = require('./textExtractionService');

const TAILLE_MAX_DOCUMENT = 100000; // caractères de contenu_texte par document
const TAILLE_MAX_FICHIER_RATTRAPAGE = 25 * 1024 * 1024;
const TYPES_EXTRACTIBLES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain', 'text/csv', 'text/markdown', 'application/json',
]);

// La migration 027 est-elle passée ? Vérifié une fois : une requête en échec
// dans une transaction l'annulerait tout entière (indexRequestToDocuments).
let colonnesPromesse = null;
function colonnesTexte() {
  if (!colonnesPromesse) {
    colonnesPromesse = db.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE (table_name = 'document_files' AND column_name = 'texte_extrait')
           OR (table_name = 'documents' AND column_name = 'contenu_texte')`
    ).then((r) => r.rows[0].n === 2).catch(() => { colonnesPromesse = null; return false; });
  }
  return colonnesPromesse;
}

// Migration 028 (OCR) passée ? Même précaution que colonnesTexte.
let colonnesOcrPromesse = null;
function colonnesOcr() {
  if (!colonnesOcrPromesse) {
    colonnesOcrPromesse = db.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'document_files' AND column_name IN ('texte_source', 'ocr_tente_at')`
    ).then((r) => r.rows[0].n === 2).catch(() => { colonnesOcrPromesse = null; return false; });
  }
  return colonnesOcrPromesse;
}

/**
 * Conserve le texte d'une version et met à jour celui du document.
 * @param {object} run  client de transaction ou db
 * @param {string} texte '' si rien d'extractible (la tentative est notée ;
 *        un scan entre alors dans la file de l'OCR, migration 028)
 * @param {object} [opts] { source: 'texte' | 'ocr' }
 */
async function enregistrerTexte(run, tenantId, documentId, fileId, texte, { source = 'texte' } = {}) {
  if (!(await colonnesTexte())) return;
  if (await colonnesOcr()) {
    await run.query(
      'UPDATE document_files SET texte_extrait = $2, texte_extrait_at = now(), texte_source = $3 WHERE id = $1',
      [fileId, texte || null, texte ? source : null]
    );
  } else {
    await run.query(
      'UPDATE document_files SET texte_extrait = $2, texte_extrait_at = now() WHERE id = $1',
      [fileId, texte || null]
    );
  }
  await run.query(
    `UPDATE documents SET contenu_texte = left((
        SELECT string_agg(texte_extrait, E'\\n' ORDER BY version DESC)
          FROM document_files WHERE document_id = $1 AND texte_extrait IS NOT NULL
      ), ${TAILLE_MAX_DOCUMENT})
      WHERE id = $1 AND tenant_id = $2`,
    [documentId, tenantId]
  );
}

/**
 * Contenu binaire d'un fichier stocké (disque local, ou Cloudinary par URL
 * signée) ; null si introuvable (disque éphémère) ou trop volumineux.
 */
async function lireBinaire(fichier) {
  if (Number(fichier.file_size) > TAILLE_MAX_FICHIER_RATTRAPAGE) return null;
  const { FILES_DIR } = require('../config/paths');
  const local = fichier.stored_name && !fichier.cloudinary_public_id && path.join(FILES_DIR, fichier.stored_name);
  if (local && fs.existsSync(local)) return fs.readFileSync(local);
  if (!fichier.cloudinary_public_id) return null;
  const url = require('./storageService').signedCloudinaryUrl(fichier);
  if (!url) return null;
  const axios = require('axios');
  const rep = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: TAILLE_MAX_FICHIER_RATTRAPAGE });
  return Buffer.from(rep.data);
}

/** Texte d'un fichier stocké (couche texte seulement — l'OCR est à part). */
async function lireTexteStocke(fichier) {
  if (!TYPES_EXTRACTIBLES.has(fichier.mime_type)) return '';
  const binaire = await lireBinaire(fichier);
  if (!binaire) return '';
  const tmp = path.join(os.tmpdir(), `docuflow-rattrapage-${process.pid}-${fichier.id}`);
  fs.writeFileSync(tmp, binaire);
  try {
    return await extractText(tmp, fichier.mime_type);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Passe à l'OCR les scans en attente (extraction faite, rien trouvé), en
 * respectant le réglage ocr_enabled de chaque organisation. Chaque fichier
 * est RÉSERVÉ (ocr_tente_at) avant traitement : un fichier qui ferait tomber
 * le processus ne serait pas repris en boucle au redémarrage.
 * @returns {Promise<number>} nombre de fichiers traités
 */
async function ocrEnAttente({ lot = 1 } = {}) {
  if (!(await colonnesOcr())) return 0;
  const r = await db.query(
    `UPDATE document_files f SET ocr_tente_at = now()
      WHERE f.id IN (
        SELECT f2.id FROM document_files f2 JOIN documents d ON d.id = f2.document_id
         WHERE f2.texte_extrait IS NULL AND f2.texte_extrait_at IS NOT NULL AND f2.ocr_tente_at IS NULL
           AND d.deleted_at IS NULL
           AND (f2.mime_type = 'application/pdf' OR f2.mime_type LIKE 'image/%')
           AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.tenant_id = d.tenant_id AND s.key = 'ocr_enabled' AND s.value = 'false')
         ORDER BY f2.id DESC LIMIT $1
         FOR UPDATE OF f2 SKIP LOCKED
      )
      RETURNING f.*, (SELECT tenant_id FROM documents WHERE id = f.document_id) AS tenant_id`,
    [lot]
  );
  const ocr = require('./ocrService');
  const settingsService = require('./settingsService');
  for (const f of r.rows) {
    try {
      const binaire = await lireBinaire(f);
      if (!binaire) continue;
      const { ocr_max_pages: maxPages } = await settingsService.getAll(f.tenant_id);
      const texte = await ocr.lireScan(binaire, f.mime_type, { maxPages });
      if (texte) {
        await enregistrerTexte(db, f.tenant_id, f.document_id, f.id, require('./textExtractionService').tronquer(texte), { source: 'ocr' });
        console.log(`[ocr] fichier ${f.id} : ${texte.length} caractères reconnus`);
      }
    } catch (err) {
      console.warn(`[ocr] fichier ${f.id} non reconnu : ${err.message}`);
    }
  }
  return r.rows.length;
}

/**
 * Traite un lot de fichiers jamais passés par l'extraction.
 * @returns {Promise<number>} nombre de fichiers traités
 */
async function rattraperContenu({ lot = 8 } = {}) {
  if (!(await colonnesTexte())) return 0;
  const r = await db.query(
    `SELECT f.*, d.tenant_id
       FROM document_files f JOIN documents d ON d.id = f.document_id
      WHERE f.texte_extrait_at IS NULL AND d.deleted_at IS NULL
      ORDER BY f.id DESC LIMIT $1`,
    [lot]
  );
  for (const f of r.rows) {
    let texte = '';
    try {
      texte = await lireTexteStocke(f);
    } catch (err) {
      // Fichier illisible ou injoignable : noté comme tenté, pour ne pas
      // le reprendre en boucle ; une nouvelle version sera, elle, extraite.
      console.warn(`[contenu] fichier ${f.id} illisible : ${err.message}`);
    }
    await enregistrerTexte(db, f.tenant_id, f.document_id, f.id, texte);
  }
  return r.rows.length;
}

/**
 * Lance le rattrapage en arrière-plan : un lot toutes les 2 minutes tant
 * qu'il reste du travail, puis une vérification toutes les 30 minutes. Ne
 * retient pas le processus (unref) et ne fait jamais tomber le serveur.
 */
function demarrerRattrapage() {
  let delai = 120000;
  const tour = async () => {
    try {
      const n = await rattraperContenu();
      if (n) console.log(`[contenu] ${n} fichier(s) indexé(s) en rattrapage`);
      delai = n ? 120000 : 30 * 60000;
    } catch (err) {
      console.warn('[contenu] rattrapage différé :', err.message);
      delai = 10 * 60000;
    }
    setTimeout(tour, delai).unref();
  };
  setTimeout(tour, 60000).unref();
}

/**
 * File de l'OCR en arrière-plan : un scan à la fois, toutes les 20 s tant
 * qu'il en reste, puis une vérification toutes les 5 min. Un nouveau scan
 * versé est donc lu dans les minutes qui suivent.
 */
function demarrerOcr() {
  let delai = 20000;
  const tour = async () => {
    try {
      const n = await ocrEnAttente();
      delai = n ? 20000 : 5 * 60000;
    } catch (err) {
      console.warn('[ocr] file différée :', err.message);
      delai = 10 * 60000;
    }
    setTimeout(tour, delai).unref();
  };
  setTimeout(tour, 90000).unref();
}

module.exports = {
  enregistrerTexte, rattraperContenu, demarrerRattrapage, ocrEnAttente, demarrerOcr,
  lireTexteStocke, lireBinaire, colonnesTexte, TYPES_EXTRACTIBLES,
};
