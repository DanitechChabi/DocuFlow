// ============================================================================
// ocr.test.js — reconnaissance des documents scannés (migration 028).
//
// Les « scans » sont fabriqués ici : une page dessinée (@napi-rs/canvas), en
// PNG (photo) et dans un PDF qui ne contient QUE cette image, sans couche
// texte — exactement ce que produit un scanner.
// 1. SANS BASE : reconnaissance d'une image et d'un PDF image (moteur local,
//    données de langue embarquées : aucun accès réseau).
// 2. AVEC BASE (DB_HOST ou DATABASE_URL) : un scan versé entre dans la file,
//    l'OCR en arrière-plan le lit, la recherche automatique le retrouve ;
//    organisation qui a désactivé l'OCR respectée. Organisation jetable.
// Exécution : npm run test:ocr
// ============================================================================
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const ocr = require('./services/ocrService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };

/** Une page « scannée » : fond légèrement grisé, texte noir. */
function page(lignes, type = 'image/png') {
  const c = createCanvas(1700, 160 + lignes.length * 110);
  const g = c.getContext('2d');
  g.fillStyle = '#f3f0e8'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#111'; g.font = '40px serif';
  lignes.forEach((l, i) => g.fillText(l, 80, 120 + i * 110));
  return { buffer: c.toBuffer(type), largeur: c.width, hauteur: c.height };
}

/** PDF d'une seule page contenant uniquement une image JPEG (aucun texte). */
function pdfImage(jpeg, largeur, hauteur) {
  const contenu = Buffer.from(`q 612 0 0 ${Math.round(612 * hauteur / largeur)} 0 0 cm /Im0 Do Q`);
  const h = Math.round(612 * hauteur / largeur);
  const objets = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${h}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`),
    Buffer.concat([Buffer.from(`<< /Length ${contenu.length} >>\nstream\n`), contenu, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${largeur} /Height ${hauteur} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let taille = parts[0].length;
  objets.forEach((o, i) => {
    offsets.push(taille);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    parts.push(b); taille += b.length;
  });
  const xref = [`xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${taille}\n%%EOF\n`));
  return Buffer.concat(parts);
}

const ARRETE = ['MAIRIE DE PORTO-NOVO', 'Arrêté municipal n° 2019/045 portant budget primitif', 'Vu la délibération du conseil municipal du 14 mars 2019'];
const ATTESTATION = ['DIRECTION DES RESSOURCES HUMAINES', 'Attestation de travail de Monsieur Houngbo Jean', 'Matricule 4521 — en poste depuis le 2 janvier 2012'];

(async () => {
  console.log('\n1. Reconnaissance (sans base, sans réseau)');
  ok(ocr.ocrisable('application/pdf') && ocr.ocrisable('image/jpeg') && !ocr.ocrisable('application/zip'), 'types reconnaissables');
  const png = page(ARRETE);
  let t = await ocr.lireScan(png.buffer, 'image/png');
  ok(/Porto-Novo/i.test(t) && /délibération/i.test(t) && /2019\/045/.test(t), 'photo PNG : texte reconnu, accents compris');
  const jpg = page(ATTESTATION, 'image/jpeg');
  const pdf = pdfImage(jpg.buffer, jpg.largeur, jpg.hauteur);
  const { extractText } = require('./services/textExtractionService');
  const os = require('os');
  const tmp = path.join(os.tmpdir(), `scan-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, pdf);
  ok((await extractText(tmp, 'application/pdf')) === '', 'PDF scanné : aucune couche texte (d\'où l\'OCR)');
  fs.rmSync(tmp, { force: true });
  t = await ocr.lireScan(pdf, 'application/pdf', { maxPages: 5 });
  ok(/Houngbo/i.test(t) && /4521/.test(t), 'PDF scanné : page rendue puis reconnue');
  ok((await ocr.lireScan(Buffer.from('x'), 'application/zip')) === '', 'type non reconnaissable : rien');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. File d\'attente sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. File d\'attente sur PostgreSQL');
    const db = require('./config/db');
    const { addFileToDocument } = require('./services/documentIndexService');
    const { ocrEnAttente } = require('./services/contentIndexService');
    const ged = require('./services/gedMatchService');
    const { FILES_DIR } = require('./config/paths');
    const s = Date.now();
    const tenant = async (n) => (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test OCR ${n} ${s}`, `test-ocr-${n}-${s}`])).rows[0].id;
    const t1 = await tenant('a');
    const t2 = await tenant('b');
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'ocr_enabled', 'false')", [t2]);
    const verser = async (tid, nom, buffer, mime) => {
      const d = (await db.query(
        "INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut) VALUES ($1, $2, 'À indexer', 'À indexer', 'À indexer', 2019, 'à indexer') RETURNING id",
        [tid, `OCR-${s}-${nom}`])).rows[0].id;
      const fichier = path.join(FILES_DIR, `test-ocr-${s}-${nom}`);
      fs.writeFileSync(fichier, buffer);
      await addFileToDocument(tid, d, null, { path: fichier, filename: path.basename(fichier), originalname: nom, mimetype: mime, size: buffer.length });
      return d;
    };
    const dPdf = await verser(t1, 'attestation.pdf', pdf, 'application/pdf');
    const dPng = await verser(t1, 'arrete.png', png.buffer, 'image/png');
    const dDesactive = await verser(t2, 'arrete2.png', png.buffer, 'image/png');

    const etat = async (d) => (await db.query('SELECT texte_extrait, texte_source, ocr_tente_at FROM document_files WHERE document_id = $1', [d])).rows[0];
    ok((await etat(dPdf)).texte_extrait === null && (await etat(dPdf)).ocr_tente_at === null, 'scan versé : en file d\'attente (pas d\'OCR pendant l\'envoi)');
    const avant = await ged.chercher(t1, { description: 'attestation de travail de M. Houngbo, matricule 4521' });
    ok(!avant.some((x) => x.document_id === dPdf), 'avant OCR : introuvable par son contenu');

    // La file traite d'abord les fichiers les plus récents, toutes
    // organisations confondues : on la vide jusqu'à ce que nos deux scans
    // soient passés (borne de sécurité).
    for (let tours = 0; tours < 50; tours += 1) {
      if ((await etat(dPdf)).ocr_tente_at && (await etat(dPng)).ocr_tente_at) break;
      if ((await ocrEnAttente({ lot: 5 })) === 0) break;
    }
    const e = await etat(dPdf);
    ok(/Houngbo/i.test(e.texte_extrait || '') && e.texte_source === 'ocr', 'PDF scanné : texte reconnu et marqué « ocr »');
    ok(/Porto-Novo/i.test((await etat(dPng)).texte_extrait || ''), 'photo : texte reconnue');
    const apres = await ged.chercher(t1, { description: 'attestation de travail de M. Houngbo, matricule 4521' });
    ok(apres[0]?.document_id === dPdf && apres[0].score >= ged.SEUIL_PROBABLE, `après OCR : retrouvé par la recherche automatique (${apres[0]?.score})`);
    ok((await etat(dDesactive)).ocr_tente_at === null, 'organisation qui a désactivé l\'OCR : fichier laissé de côté');
    const reprise = (await db.query('SELECT ocr_tente_at FROM document_files WHERE document_id = $1', [dPdf])).rows[0].ocr_tente_at;
    await ocrEnAttente({ lot: 5 });
    const ensuite = (await db.query('SELECT ocr_tente_at FROM document_files WHERE document_id = $1', [dPdf])).rows[0].ocr_tente_at;
    ok(String(reprise) === String(ensuite), 'fichier traité : pas repris');

    fs.readdirSync(FILES_DIR).filter((f) => f.startsWith(`test-ocr-${s}`)).forEach((f) => fs.rmSync(path.join(FILES_DIR, f), { force: true }));
    await db.pool.end();
  }
  await ocr.liberer();
  console.log(`\n${echecs === 0 ? '✅' : '❌'} OCR cohérent — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})();
