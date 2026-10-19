// ============================================================================
// ocrService — lire le texte des documents scannés (migration 028).
//
// Moteur : Tesseract (tesseract.js, WebAssembly) — aucun service externe, rien
// ne quitte le serveur ; fonctionne à l'identique dans l'app de bureau, hors
// ligne : les données de langue française sont EMBARQUÉES
// (@tesseract.js-data/fra), pas téléchargées au premier usage.
//
// Un PDF est rendu page par page en image (pdf-parse → pdfjs + @napi-rs/canvas,
// déjà présents), puis chaque page est reconnue. Une image (JPEG, PNG, TIFF…)
// est reconnue directement.
//
// SOBRIÉTÉ — le serveur de production a peu de mémoire (Render free) :
//   * un seul moteur, créé au premier besoin, libéré après 3 min d'inactivité ;
//   * une seule reconnaissance à la fois (file interne) ;
//   * pages plafonnées (réglage ocr_max_pages), largeur de rendu bornée ;
//   * jamais pendant un envoi de fichier : la file d'attente est traitée en
//     arrière-plan (contentIndexService.demarrerOcr).
// ============================================================================

const TYPES_IMAGE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/tiff', 'image/webp', 'image/bmp', 'image/gif']);
const LARGEUR_RENDU = 2000;           // px — ~240 dpi sur une page A4
const INACTIVITE_MS = 3 * 60 * 1000;  // libération du moteur
const DELAI_PAGE_MS = 90 * 1000;      // une page qui dépasse ce temps est abandonnée

/** Ce type de fichier peut-il passer par l'OCR ? */
function ocrisable(mime) {
  return mime === 'application/pdf' || TYPES_IMAGE.has(mime);
}

let moteur = null;      // Promise<Worker>
let minuterie = null;
let file = Promise.resolve();

function obtenirMoteur() {
  clearTimeout(minuterie);
  if (!moteur) {
    const Tesseract = require('tesseract.js');
    const fra = require('@tesseract.js-data/fra');
    const os = require('os');
    const path = require('path');
    moteur = Tesseract.createWorker('fra', 1, {
      langPath: fra.langPath,
      gzip: fra.gzip,
      cachePath: path.join(os.tmpdir(), 'docuflow-ocr'),
    }).catch((err) => { moteur = null; throw err; });
  }
  return moteur;
}

function planifierLiberation() {
  clearTimeout(minuterie);
  minuterie = setTimeout(async () => {
    const m = moteur;
    moteur = null;
    if (m) (await m.catch(() => null))?.terminate().catch(() => {});
  }, INACTIVITE_MS);
  minuterie.unref?.();
}

const avecDelai = (promesse, ms, message) => Promise.race([
  promesse,
  new Promise((_, rej) => setTimeout(() => rej(new Error(message)), ms).unref?.()),
]);

/** Reconnaît une image (Buffer) ; une seule reconnaissance à la fois. */
function reconnaitreImage(buffer) {
  const tache = file.then(async () => {
    const w = await obtenirMoteur();
    try {
      const { data } = await avecDelai(w.recognize(buffer), DELAI_PAGE_MS, 'OCR trop long sur une page');
      planifierLiberation();
      return (data.text || '').trim();
    } catch (err) {
      // Moteur peut-être encore occupé (délai dépassé) ou en mauvais état :
      // on le jette, le suivant repartira d'un moteur neuf.
      await liberer();
      throw err;
    }
  });
  file = tache.catch(() => {});
  return tache;
}

/** Rend les premières pages d'un PDF en images PNG. */
async function rendrePages(buffer, maxPages) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const r = await parser.getScreenshot({ first: maxPages, desiredWidth: LARGEUR_RENDU, imageBuffer: true, imageDataUrl: false });
    return (r.pages || []).map((p) => Buffer.from(p.data));
  } finally {
    await parser.destroy?.().catch(() => {});
  }
}

/**
 * Texte d'un fichier scanné.
 * @param {Buffer} buffer
 * @param {string} mime
 * @param {object} [opts] { maxPages }
 * @returns {Promise<string>} '' si rien n'est lisible
 */
async function lireScan(buffer, mime, { maxPages = 20 } = {}) {
  if (!ocrisable(mime)) return '';
  if (mime !== 'application/pdf') return reconnaitreImage(buffer);
  const pages = await rendrePages(buffer, Math.max(1, Math.min(200, Number(maxPages) || 20)));
  const textes = [];
  for (const page of pages) {
    const t = await reconnaitreImage(page);
    if (t) textes.push(t);
  }
  return textes.join('\n\n');
}

/** Libère le moteur tout de suite (tests, arrêt du serveur). */
async function liberer() {
  clearTimeout(minuterie);
  const m = moteur;
  moteur = null;
  if (m) await (await m.catch(() => null))?.terminate().catch(() => {});
}

module.exports = { ocrisable, lireScan, reconnaitreImage, liberer, TYPES_IMAGE };
