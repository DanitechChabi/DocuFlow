/**
 * Service d'extraction de texte depuis les fichiers uploadés.
 * Extrait le texte des PDF, documents Word (.docx) et fichiers texte.
 * Le texte extrait est stocké pour la recherche full-text et l'auto-tagging.
 */
const fs = require('fs');
const path = require('path');

let pdfParse;
let mammoth;

// pdf-parse a été entièrement réécrit en 2.x : l'export est désormais une classe
// `PDFParse` (new PDFParse({data}).load().getText()) et non plus une fonction
// `(buffer) => Promise<{text}>`. Les deux formes sont prises en charge pour que
// l'installation de l'une ou l'autre ne désactive pas silencieusement l'extraction.
try {
  pdfParse = require('pdf-parse');
  if (typeof pdfParse !== 'function' && !pdfParse.PDFParse) {
    console.warn('[text-extraction] pdf-parse présente une API inconnue — extraction PDF désactivée');
    pdfParse = null;
  }
} catch {
  console.warn('[text-extraction] pdf-parse non installé — extraction PDF désactivée');
}

try {
  mammoth = require('mammoth');
} catch {
  console.warn('[text-extraction] mammoth non installé — extraction DOCX désactivée');
}

/**
 * Extraire le texte d'un buffer PDF selon l'API de la version de pdf-parse
 * installée. API 2.x : classe PDFParse (getText() renvoie { text, pages }).
 * API 1.x : fonction directe renvoyant { text }. Les séparateurs de page que
 * la 2.x insère (« -- N of M -- ») sont retirés : ils n'ont pas de sens pour
 * la recherche plein texte ni pour l'auto-tagging.
 */
async function extractPdfText(buffer) {
  if (typeof pdfParse === 'function') {
    // API 1.x (pdf-parse < 2)
    const data = await pdfParse(buffer);
    return data.text || '';
  }

  const Parser = pdfParse.PDFParse || pdfParse;
  const parser = new Parser({ data: buffer });
  await parser.load();
  const result = await parser.getText();
  return (result.text || '').replace(/^--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '').trim();
}

/**
 * Extraire le texte d'un fichier selon son type MIME.
 * @param {string} filePath - Chemin vers le fichier sur disque
 * @param {string} mimeType - Type MIME du fichier
 * @returns {Promise<string>} Texte extrait (tronqué à 50 000 caractères)
 */
async function extractText(filePath, mimeType) {
  if (!fs.existsSync(filePath)) return '';

  try {
    if (mimeType === 'application/pdf' && pdfParse) {
      const buffer = fs.readFileSync(filePath);
      const text = await extractPdfText(buffer);
      return truncate(text);
    }

    if (
      (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
       mimeType === 'application/msword') &&
      mammoth
    ) {
      const buffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer });
      return truncate(result.value || '');
    }

    if (
      mimeType === 'text/plain' ||
      mimeType === 'text/csv' ||
      mimeType === 'text/markdown' ||
      mimeType === 'application/json'
    ) {
      const text = fs.readFileSync(filePath, 'utf-8');
      return truncate(text || '');
    }

    // Pour les images, on ne peut pas extraire de texte sans OCR externe
    return '';
  } catch (err) {
    console.error(`[text-extraction] Erreur extraction ${path.basename(filePath)}:`, err.message);
    return '';
  }
}

function truncate(text, maxLen = 50000) {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

/**
 * Extraire des tags/mots-clés automatiques depuis le texte d'un document.
 * Analyse de fréquence simple sans IA externe.
 */
function extractAutoTags(text, existingTags = []) {
  if (!text || text.length < 20) return existingTags;

  const lower = text.toLowerCase();

  // Mots-clés métier prédéfinis
  const KEYWORDS = {
    'finance': ['facture', 'paiement', 'montant', 'budget', 'comptable', 'financier', 'tva', 'impôt', 'revenu', 'dépense', 'bilan', 'trésorerie'],
    'juridique': ['contrat', 'convention', 'accord', 'clause', 'juridique', 'legal', 'loi', 'règlement', 'statut', 'procur'],
    'RH': ['employé', 'salarié', 'paie', 'congé', 'recrutement', 'contrat de travail', 'formation', 'évaluation'],
    'technique': ['cahier des charges', 'spécification', 'technique', 'architecture', 'système', 'réseau', 'sécurité'],
    'commercial': ['devis', 'offre', 'client', 'prospect', 'vente', 'commercial', 'marché', 'négociation'],
    'immobilier': ['immobilier', 'bail', 'loyer', 'propriété', 'terrain', 'construction', 'permis'],
    'assurance': ['assurance', 'sinistre', 'garantie', 'prime', 'couverture', 'police'],
    'comptabilité': ['bilan', 'compte', 'journal', 'grand livre', 'balance', 'amortissement', 'provision'],
  };

  const found = new Set(existingTags);

  for (const [tag, keywords] of Object.entries(KEYWORDS)) {
    const count = keywords.filter(kw => lower.includes(kw)).length;
    if (count >= 2 || (keywords.some(kw => lower.includes(kw)) && text.length < 500)) {
      found.add(tag);
    }
  }

  // Extraire les noms propres (mots commençant par majuscule, > 3 lettres)
  const properNouns = text.match(/\b[A-ZÀÂÉÈÊËÏÎÔÙÛÜÇ][a-zàâéèêëïîôùûüç]{3,}\b/g) || [];
  const freq = {};
  properNouns.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .forEach(([word]) => found.add(word));

  return Array.from(found).slice(0, 10);
}

module.exports = { extractText, extractAutoTags };
