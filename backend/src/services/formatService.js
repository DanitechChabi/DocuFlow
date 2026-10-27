// ============================================================================
// formatService — formats de conservation (migration 037), loi n° 2017-20
// portant Code du numérique, art. 301-302 : les documents archivés sont
// conservés « sur des formats appropriés à la conservation et à la
// migration », et restent accessibles « dans un contexte technologique
// changeant ».
//
// IDENTIFICATION par la signature binaire du fichier (jamais par son
// extension, qui ment souvent) :
//   pérenne     format ouvert et normalisé, lisible sans éditeur particulier
//               (PDF/A, TIFF, PNG, JPEG, texte, XML, OpenDocument) ;
//   surveiller  normalisé mais à faire évoluer (PDF non PDF/A, Office Open
//               XML, GIF, WebP, RTF, vidéo) ;
//   risque      propriétaire ou obsolète (Word, Excel, PowerPoint 97-2003),
//               ou inconnu.
//
// CONVERSION : une COPIE DE CONSERVATION PDF/A-2b s'ajoute comme nouvelle
// version du document ; l'original reste intact (art. 301), la copie désigne
// sa source (copie_de_file_id) et les deux empreintes sont journalisées.
// Elle exige LibreOffice sur le serveur (application de bureau, ou serveur
// équipé) ; sans lui, la conversion est simplement indisponible.
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const db = require('../config/db');

const LIBELLES = { perenne: 'Pérenne', surveiller: 'À surveiller', risque: 'À risque' };

const commence = (b, ...octets) => octets.every((o, i) => b[i] === o);
const ascii = (b, debut, fin) => b.subarray(debut, fin).toString('latin1');

/** Le fichier est-il du texte UTF-8 (sans octet nul) ? */
function estTexte(b) {
  const echantillon = b.subarray(0, 8192);
  if (echantillon.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(echantillon.subarray(0, echantillon.length - 4)); return true; } catch { return false; }
}

/** Noms des entrées d'une archive ZIP (en-têtes locaux, sans décompresser). */
function entreesZip(b) {
  const noms = [];
  for (let p = 0; p + 30 < b.length && noms.length < 200;) {
    if (b.readUInt32LE(p) !== 0x04034b50) break;
    const taille = b.readUInt32LE(p + 18);
    const lnom = b.readUInt16LE(p + 26);
    const lextra = b.readUInt16LE(p + 28);
    noms.push(ascii(b, p + 30, p + 30 + lnom));
    if (b.readUInt16LE(p + 6) & 0x08) break; // taille différée : on s'arrête là
    p += 30 + lnom + lextra + taille;
  }
  return noms;
}

/**
 * Identifie le format d'un fichier à partir de ses octets.
 * @returns {{ nom: string, version: string|null, risque: 'perenne'|'surveiller'|'risque', pdfa: string|null }}
 */
function identifier(b, nomFichier = '') {
  const r = (nom, risque, version = null, pdfa = null) => ({ nom, version, risque, pdfa });
  if (!b || !b.length) return r('Fichier vide', 'risque');
  if (ascii(b, 0, 5) === '%PDF-') {
    const version = /^%PDF-(\d\.\d)/.exec(ascii(b, 0, 16))?.[1] || null;
    // Déclaration PDF/A dans les métadonnées XMP (attribut ou élément).
    const texte = b.toString('latin1');
    const part = /pdfaid:part(?:="|>)\s*(\d)/.exec(texte)?.[1];
    const conf = /pdfaid:conformance(?:="|>)\s*([abuABU])/.exec(texte)?.[1];
    return part ? r('PDF/A', 'perenne', version, `${part}${(conf || '').toUpperCase()}`) : r('PDF', 'surveiller', version);
  }
  if (commence(b, 0x89, 0x50, 0x4e, 0x47)) return r('PNG', 'perenne');
  if (commence(b, 0xff, 0xd8, 0xff)) return r('JPEG', 'perenne');
  if (commence(b, 0x49, 0x49, 0x2a, 0x00) || commence(b, 0x4d, 0x4d, 0x00, 0x2a)) return r('TIFF', 'perenne');
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return r('GIF', 'surveiller', ascii(b, 3, 6));
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return r('WebP', 'surveiller');
  if (ascii(b, 4, 8) === 'ftyp') return r('Vidéo MP4/QuickTime', 'surveiller');
  if (commence(b, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) {
    const ext = path.extname(nomFichier).toLowerCase();
    const nom = { '.doc': 'Word 97-2003', '.xls': 'Excel 97-2003', '.ppt': 'PowerPoint 97-2003' }[ext] || 'Document Office 97-2003';
    return r(nom, 'risque');
  }
  if (commence(b, 0x50, 0x4b, 0x03, 0x04)) {
    const noms = entreesZip(b);
    if (noms[0] === 'mimetype') {
      const type = ascii(b, 38, 38 + b.readUInt32LE(18));
      if (type.includes('opendocument.text')) return r('OpenDocument Texte', 'perenne');
      if (type.includes('opendocument.spreadsheet')) return r('OpenDocument Classeur', 'perenne');
      if (type.includes('opendocument.presentation')) return r('OpenDocument Présentation', 'perenne');
    }
    if (noms.some((n) => n.startsWith('word/'))) return r('Word (DOCX)', 'surveiller');
    if (noms.some((n) => n.startsWith('xl/'))) return r('Excel (XLSX)', 'surveiller');
    if (noms.some((n) => n.startsWith('ppt/'))) return r('PowerPoint (PPTX)', 'surveiller');
    return r('Archive ZIP', 'risque');
  }
  if (ascii(b, 0, 5) === '{\\rtf') return r('RTF', 'surveiller');
  if (estTexte(b)) {
    const debut = b.subarray(0, 200).toString('utf8').replace(/^\uFEFF/, '').trimStart();
    if (debut.startsWith('<?xml')) return r('XML', 'perenne');
    if (/\.csv$/i.test(nomFichier)) return r('CSV', 'perenne');
    return r('Texte', 'perenne');
  }
  return r('Format inconnu', 'risque');
}

let migrationPromesse = null;
const migrationPassee = () => {
  if (!migrationPromesse) {
    migrationPromesse = db.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'document_files' AND column_name = 'format_risque') AS ok")
      .then((r) => r.rows[0].ok).catch(() => { migrationPromesse = null; return false; });
  }
  return migrationPromesse;
};

/** Identifie et enregistre le format d'un fichier déjà en base. */
async function enregistrer(run, fileId, octets, nom) {
  const f = identifier(octets, nom);
  await run.query(
    `UPDATE document_files SET format_nom = $2, format_version = $3, format_risque = $4, pdfa = $5, format_identifie_at = now() WHERE id = $1`,
    [fileId, f.nom, f.version, f.risque, f.pdfa]);
  return f;
}

/** Rattrapage : identifie les fichiers qui ne l'ont pas encore été (par lots). */
async function identifierEnAttente({ lot = 100, lotsMax = 20 } = {}) {
  if (!(await migrationPassee())) return 0;
  let n = 0;
  for (let i = 0; i < lotsMax; i += 1) {
    const r = await identifierLot(lot);
    n += r.identifies;
    if (r.vus < lot) break;
  }
  return n;
}

async function identifierLot(lot) {
  const { lireOctets } = require('./paquetService');
  const { rows } = await db.query(
    `SELECT f.id, f.original_name, f.stored_name, f.cloudinary_public_id, f.mime_type FROM document_files f
      WHERE f.format_identifie_at IS NULL ORDER BY f.id DESC LIMIT $1`, [lot]);
  let n = 0;
  for (const f of rows) {
    try {
      const octets = await lireOctets(f);
      if (octets) { await enregistrer(db, f.id, octets, f.original_name); n += 1; } else {
        await db.query("UPDATE document_files SET format_nom = 'Fichier introuvable', format_risque = 'risque', format_identifie_at = now() WHERE id = $1", [f.id]);
      }
    } catch (err) {
      console.warn(`[formats] fichier ${f.id} :`, err.message);
      // Ne pas rejouer sans fin une lecture qui échoue : marqué, retenté par « Contrôler ».
      await db.query("UPDATE document_files SET format_nom = 'Lecture impossible', format_risque = 'risque', format_identifie_at = now() WHERE id = $1", [f.id]).catch(() => {});
    }
  }
  return { identifies: n, vus: rows.length };
}

let minuterie = null;
function demarrerFormats() {
  if (minuterie) return;
  const passe = () => identifierEnAttente().then((n) => { if (n) console.log(`[formats] ${n} fichier(s) identifié(s)`); }).catch((e) => console.warn('[formats]', e.message));
  setTimeout(passe, 30 * 1000).unref?.();
  minuterie = setInterval(passe, 10 * 60 * 1000);
  minuterie.unref?.();
}

/** Bilan des formats des fichiers vivants de l'organisation (version courante ou non). */
async function bilan(tenantId, lisibles) {
  const { rows } = await db.query(
    `SELECT COALESCE(f.format_nom, 'Non identifié') AS format, f.format_risque AS risque, f.pdfa,
            count(*)::int AS fichiers, COALESCE(sum(f.file_size), 0)::bigint AS volume
       FROM document_files f JOIN documents d ON d.id = f.document_id
      WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND (d.dossier_id IS NULL OR d.dossier_id = ANY($2::int[]))
      GROUP BY 1, 2, 3 ORDER BY fichiers DESC`, [tenantId, [...lisibles]]);
  const aRisque = await db.query(
    `SELECT f.id AS file_id, f.version, f.original_name, f.format_nom, f.format_risque, d.id AS document_id, d.reference_mfile,
            EXISTS (SELECT 1 FROM document_files c WHERE c.copie_de_file_id = f.id) AS copie_existante
       FROM document_files f JOIN documents d ON d.id = f.document_id
      WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND f.format_risque IN ('risque', 'surveiller')
        AND (d.dossier_id IS NULL OR d.dossier_id = ANY($2::int[]))
      ORDER BY (f.format_risque = 'risque') DESC, d.id DESC LIMIT 200`, [tenantId, [...lisibles]]);
  return {
    formats: rows.map((r) => ({ ...r, volume: Number(r.volume) })),
    a_traiter: aRisque.rows,
    conversion_disponible: await libreOfficeDisponible(),
    non_identifies: rows.filter((r) => r.risque === null).reduce((s, r) => s + r.fichiers, 0),
  };
}

// --------------------------------------------------------------- conversion

let cheminSoffice;
/** Chemin de LibreOffice (soffice), ou null. Cherché une fois. */
function trouverSoffice() {
  if (cheminSoffice !== undefined) return cheminSoffice;
  const candidats = [process.env.SOFFICE_PATH, '/usr/bin/soffice', '/usr/local/bin/soffice', '/usr/lib/libreoffice/program/soffice',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'].filter(Boolean);
  cheminSoffice = candidats.find((c) => { try { return fs.existsSync(c); } catch { return false; } }) || null;
  return cheminSoffice;
}
const libreOfficeDisponible = async () => Boolean(module.exports.trouverSoffice());

/** Convertit un fichier en PDF/A-2b ; rend le chemin du PDF produit. */
function versPdfa(source, dossier) {
  const soffice = module.exports.trouverSoffice();
  if (!soffice) return Promise.reject(Object.assign(new Error("Conversion indisponible : LibreOffice n'est pas installé sur ce serveur."), { status: 501 }));
  const filtre = 'pdf:writer_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}';
  return new Promise((resolve, reject) => {
    execFile(soffice, ['--headless', '--norestore', `-env:UserInstallation=file://${dossier}/profil`, '--convert-to', filtre, '--outdir', dossier, source],
      { timeout: 180000 }, (err) => {
        if (err) return reject(new Error(`Conversion échouée : ${err.message}`));
        const sortie = path.join(dossier, `${path.basename(source, path.extname(source))}.pdf`);
        return fs.existsSync(sortie) ? resolve(sortie) : reject(new Error('Conversion échouée : aucun PDF produit.'));
      });
  });
}

/**
 * Copie de conservation PDF/A d'une version : ajoutée comme nouvelle version,
 * l'original intact. Le document doit être modifiable par l'utilisateur
 * (vérifié par le contrôleur) et ne pas être éliminé.
 */
async function copieConservation(tenantId, documentId, fileId, user) {
  const { lireOctets } = require('./paquetService');
  const integrite = require('./integriteService');
  const { addFileToDocument } = require('./documentIndexService');
  const f = (await db.query(
    `SELECT f.* FROM document_files f JOIN documents d ON d.id = f.document_id
      WHERE f.id = $1 AND f.document_id = $2 AND d.tenant_id = $3 AND d.elimine_at IS NULL`, [Number(fileId), Number(documentId), tenantId])).rows[0];
  if (!f) throw Object.assign(new Error('Version introuvable.'), { status: 404 });
  if (f.pdfa) throw Object.assign(new Error('Cette version est déjà au format PDF/A.'), { status: 409 });
  const deja = await db.query('SELECT version FROM document_files WHERE copie_de_file_id = $1 LIMIT 1', [f.id]);
  if (deja.rows[0]) throw Object.assign(new Error(`Une copie de conservation existe déjà (version ${deja.rows[0].version}).`), { status: 409 });
  const octets = await lireOctets(f);
  if (!octets) throw Object.assign(new Error('Fichier source introuvable dans le stockage.'), { status: 404 });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-pdfa-'));
  try {
    const nomSource = `source${path.extname(f.original_name || '') || '.bin'}`;
    const source = path.join(dossier, nomSource);
    fs.writeFileSync(source, octets);
    const pdf = await versPdfa(source, dossier);
    const produit = identifier(fs.readFileSync(pdf), 'copie.pdf');
    if (!produit.pdfa) throw new Error('La conversion n\'a pas produit un PDF/A.');
    const nom = `${path.basename(f.original_name || 'document', path.extname(f.original_name || ''))} (PDF-A).pdf`;
    const ajoute = await addFileToDocument(tenantId, Number(documentId), user.id, {
      path: pdf, filename: path.basename(pdf), originalname: nom, mimetype: 'application/pdf', size: fs.statSync(pdf).size,
    });
    await db.query('UPDATE document_files SET copie_de_file_id = $2 WHERE id = $1', [ajoute.id, f.id]);
    const qui = await integrite.identite(user);
    await db.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json)
       VALUES ($1, $2, $3, 'COPIE_CONSERVATION_PDFA', 'document', $4, $5)`,
      [tenantId, qui.id, qui.username, Number(documentId), JSON.stringify({
        source: { version: f.version, format: f.format_nom, empreinte_sha256: f.empreinte_sha256 ? String(f.empreinte_sha256).trim() : null },
        copie: { version: ajoute.version, format: `PDF/A-${produit.pdfa}`, empreinte_sha256: ajoute.empreinte_sha256 ? String(ajoute.empreinte_sha256).trim() : null },
      })]);
    await require('./documentIndexService').logHistory(tenantId, Number(documentId), user.id, 'Copie de conservation PDF/A ajoutée', null, null,
      `Version ${ajoute.version} (PDF/A-${produit.pdfa}) créée depuis la version ${f.version} (${f.format_nom || 'format non identifié'}), conservée intacte.`);
    return { version: ajoute.version, file_id: ajoute.id, pdfa: produit.pdfa, source_version: f.version };
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

module.exports = {
  LIBELLES, identifier, entreesZip, migrationPassee, enregistrer, identifierEnAttente, demarrerFormats, bilan,
  trouverSoffice, libreOfficeDisponible, copieConservation,
};
