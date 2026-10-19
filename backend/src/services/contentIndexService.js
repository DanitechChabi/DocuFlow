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

/**
 * Conserve le texte d'une version et met à jour celui du document.
 * @param {object} run  client de transaction ou db
 * @param {string} texte '' si rien d'extractible (la tentative est notée)
 */
async function enregistrerTexte(run, tenantId, documentId, fileId, texte) {
  if (!(await colonnesTexte())) return;
  await run.query(
    'UPDATE document_files SET texte_extrait = $2, texte_extrait_at = now() WHERE id = $1',
    [fileId, texte || null]
  );
  await run.query(
    `UPDATE documents SET contenu_texte = left((
        SELECT string_agg(texte_extrait, E'\\n' ORDER BY version DESC)
          FROM document_files WHERE document_id = $1 AND texte_extrait IS NOT NULL
      ), ${TAILLE_MAX_DOCUMENT})
      WHERE id = $1 AND tenant_id = $2`,
    [documentId, tenantId]
  );
}

/** Texte d'un fichier stocké (disque local ou Cloudinary). */
async function lireTexteStocke(fichier) {
  if (!TYPES_EXTRACTIBLES.has(fichier.mime_type)) return '';
  if (Number(fichier.file_size) > TAILLE_MAX_FICHIER_RATTRAPAGE) return '';
  const { FILES_DIR } = require('../config/paths');
  const local = fichier.stored_name && !fichier.cloudinary_public_id && path.join(FILES_DIR, fichier.stored_name);
  if (local && fs.existsSync(local)) return extractText(local, fichier.mime_type);
  if (!fichier.cloudinary_public_id) return ''; // fichier local perdu (disque éphémère)

  const storage = require('./storageService');
  const url = storage.signedCloudinaryUrl(fichier);
  if (!url) return '';
  const axios = require('axios');
  const rep = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: TAILLE_MAX_FICHIER_RATTRAPAGE });
  const tmp = path.join(os.tmpdir(), `docuflow-rattrapage-${process.pid}-${fichier.id}`);
  fs.writeFileSync(tmp, Buffer.from(rep.data));
  try {
    return await extractText(tmp, fichier.mime_type);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
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

module.exports = { enregistrerTexte, rattraperContenu, demarrerRattrapage, lireTexteStocke, colonnesTexte, TYPES_EXTRACTIBLES };
