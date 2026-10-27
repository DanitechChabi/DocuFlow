// ============================================================================
// copieCertifieeService — copies certifiées conformes (migration 039).
//
// Décret n° 2007-532, art. 36 ; Code du numérique (loi n° 2017-20), art. 272.
// Une copie n'est délivrée que d'une version dont l'intégrité est vérifiée À
// L'INSTANT (empreinte recalculée sur les octets stockés) : on ne certifie pas
// conforme ce que l'on n'a pas contrôlé. Un document non encore communicable
// au public (art. 32-33) ne sort que sur une autorisation écrite.
//
// Le PDF remis reproduit chaque page de l'original, porte sur chacune la
// mention de certification et son numéro, et se termine par l'attestation du
// signataire. Il est enregistré au registre (inaltérable) avec ses empreintes.
// ============================================================================
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const db = require('../config/db');
const aclService = require('./aclService');
const communicabiliteService = require('./communicabiliteService');
const documentAuditService = require('./documentAuditService');

const RE_NUMERO = /^CCC-\d{4}-\d{5,}$/;
const A4 = [595.28, 841.89];

function erreur(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}
const sha256 = (octets) => crypto.createHash('sha256').update(octets).digest('hex');

/** Nature du fichier reproductible : pdf, jpeg, png ; null sinon. Fonction pure. */
function nature(octets) {
  if (!octets || octets.length < 8) return null;
  if (octets.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return 'jpeg';
  if (octets.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

/** Texte encodable par une police standard (WinAnsi) : le reste est remplacé. */
function encodable(police, texte) {
  const jeu = new Set(police.getCharacterSet());
  return [...String(texte ?? '').normalize('NFC')]
    .map((c) => (jeu.has(c.codePointAt(0)) ? c : ({ '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', ' ': ' ', ' ': ' ' }[c] ?? '?')))
    .join('');
}

/** Coupe un texte en lignes d'au plus `largeur` points. */
function lignes(police, taille, texte, largeur) {
  const sortie = [];
  for (const paragraphe of encodable(police, texte).split('\n')) {
    let courante = '';
    for (const mot of paragraphe.split(/\s+/).filter(Boolean)) {
      const essai = courante ? `${courante} ${mot}` : mot;
      if (police.widthOfTextAtSize(essai, taille) <= largeur || !courante) courante = essai;
      else { sortie.push(courante); courante = mot; }
    }
    sortie.push(courante);
  }
  return sortie;
}

const dateFr = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Porto-Novo' });

/**
 * Construit le PDF certifié. `a` : { numero, organisation, autorite, document,
 * fichier, empreinte_original, signataire, qualite, destinataire, motif, lieu,
 * delivre_at, autorisation }. Rend { octets, pages }.
 */
async function construirePdf(octetsOriginal, a) {
  const sortie = await PDFDocument.create();
  const date = new Date(a.delivre_at);
  sortie.setTitle(`Copie certifiée conforme ${a.numero}`);
  sortie.setAuthor(a.organisation);
  sortie.setSubject(`Copie certifiée conforme de ${a.document.reference}`);
  sortie.setProducer('DocuFlow');
  sortie.setCreator('DocuFlow');
  sortie.setCreationDate(date);
  sortie.setModificationDate(date);
  const police = await sortie.embedFont(StandardFonts.Helvetica);
  const gras = await sortie.embedFont(StandardFonts.HelveticaBold);

  const type = nature(octetsOriginal);
  if (type === 'pdf') {
    let source;
    try { source = await PDFDocument.load(octetsOriginal, { updateMetadata: false }); } catch (err) {
      throw erreur(422, `Le PDF original ne peut pas être reproduit (${/encrypt/i.test(err.message) ? 'il est chiffré' : 'fichier illisible'}).`, 'PDF_ILLISIBLE');
    }
    const pages = await sortie.copyPages(source, source.getPageIndices());
    pages.forEach((p) => sortie.addPage(p));
  } else if (type === 'jpeg' || type === 'png') {
    const image = type === 'jpeg' ? await sortie.embedJpg(octetsOriginal) : await sortie.embedPng(octetsOriginal);
    const page = sortie.addPage(A4);
    const marge = 36;
    const echelle = Math.min((A4[0] - 2 * marge) / image.width, (A4[1] - 2 * marge - 40) / image.height, 1);
    const l = image.width * echelle;
    const h = image.height * echelle;
    page.drawImage(image, { x: (A4[0] - l) / 2, y: (A4[1] - h) / 2 + 20, width: l, height: h });
  } else {
    throw erreur(415, 'Seuls un PDF ou une image JPEG/PNG se reproduisent en copie certifiée. Faites d\'abord une copie de conservation PDF/A de cette version.', 'FORMAT_NON_REPRODUCTIBLE');
  }

  const total = sortie.getPageCount() + 1;
  // Mention sur chaque page reproduite : bandeau en pied de page.
  sortie.getPages().forEach((page, i) => {
    const { width } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width, height: 22, color: rgb(1, 1, 1), opacity: 0.92 });
    page.drawLine({ start: { x: 18, y: 22 }, end: { x: width - 18, y: 22 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    const texte = encodable(police, `Copie certifiée conforme n° ${a.numero} - ${a.organisation} - page ${i + 1}/${total}`);
    page.drawText(texte, { x: 18, y: 8, size: 7.5, font: police, color: rgb(0.2, 0.2, 0.2), maxWidth: width - 36 });
  });

  // Page d'attestation.
  const page = sortie.addPage(A4);
  const [L, H] = A4;
  const x = 64;
  const largeur = L - 2 * x;
  let y = H - 72;
  const ecrire = (texte, { taille = 10.5, f = police, couleur = rgb(0.1, 0.1, 0.1), interligne = 1.45, apres = 6 } = {}) => {
    for (const l of lignes(f, taille, texte, largeur)) {
      page.drawText(l, { x, y, size: taille, font: f, color: couleur });
      y -= taille * interligne;
    }
    y -= apres;
  };
  ecrire(a.organisation.toUpperCase(), { taille: 11, f: gras, apres: 2 });
  if (a.service) ecrire(a.service, { taille: 9.5, couleur: rgb(0.35, 0.35, 0.35) });
  y -= 18;
  ecrire('COPIE CERTIFIÉE CONFORME', { taille: 18, f: gras, apres: 2 });
  ecrire(`N° ${a.numero}`, { taille: 11, f: gras, couleur: rgb(0.25, 0.25, 0.25), apres: 18 });
  ecrire(`Je soussigné(e), ${a.signataire}, ${a.qualite}, certifie que ${total === 2 ? 'la page qui précède reproduit' : `les ${total - 1} pages qui précèdent reproduisent`} fidèlement et intégralement le document « ${a.document.reference} »${a.document.intitule ? ` (${a.document.intitule})` : ''}, conservé par ${a.organisation}, et que la présente copie est conforme à l'original.`);
  ecrire(`Version reproduite : ${a.fichier.version} - fichier « ${a.fichier.nom} ». Son intégrité a été vérifiée au moment de la délivrance : l'empreinte SHA-256 du fichier conservé est identique à celle enregistrée lors de son archivage.`);
  ecrire(`Empreinte SHA-256 de l'original : ${a.empreinte_original}`, { taille: 8.5, couleur: rgb(0.3, 0.3, 0.3) });
  ecrire(`Délivrée à : ${a.destinataire}${a.motif ? ` - motif : ${a.motif}` : ''}.`);
  if (a.autorisation) ecrire(`Document non encore librement communicable au public : copie délivrée sur autorisation (${a.autorisation}).`, { taille: 9.5 });
  y -= 6;
  ecrire(`Fait à ${a.lieu || '..............................'}, le ${dateFr(date)}.`);
  y -= 10;
  page.drawText(encodable(police, `${a.signataire}, ${a.qualite}`), { x: L - x - 200, y, size: 9.5, font: gras, color: rgb(0.2, 0.2, 0.2), maxWidth: 200 });
  page.drawText('Signature et cachet', { x: L - x - 200, y: y - 13, size: 8.5, font: police, color: rgb(0.45, 0.45, 0.45) });
  page.drawRectangle({ x: L - x - 200, y: y - 100, width: 200, height: 80, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.6 });
  y -= 130;
  ecrire('Textes : décret n° 2007-532 du 2 novembre 2007 portant organisation des archives publiques, art. 36 ; loi n° 2017-20 du 20 avril 2018 portant Code du numérique en République du Bénin, art. 272.', { taille: 8, couleur: rgb(0.4, 0.4, 0.4), apres: 2 });
  ecrire(`Vérification : le registre des copies certifiées de ${a.organisation} conserve cette copie sous le n° ${a.numero} ; une copie présentée se compare à l'exemplaire du registre par son empreinte SHA-256.`, { taille: 8, couleur: rgb(0.4, 0.4, 0.4) });
  page.drawText(encodable(police, `Copie certifiée conforme n° ${a.numero} - page ${total}/${total}`), { x: 18, y: 8, size: 7.5, font: police, color: rgb(0.2, 0.2, 0.2) });

  const octets = Buffer.from(await sortie.save({ useObjectStreams: false }));
  return { octets, pages: total };
}

/** Prochain numéro annuel, dans la transaction appelante. */
async function prochainNumero(client, tenantId, annee) {
  const { rows } = await client.query(
    `INSERT INTO copies_certifiees_compteurs (tenant_id, annee, dernier) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, annee) DO UPDATE SET dernier = copies_certifiees_compteurs.dernier + 1
     RETURNING dernier`, [tenantId, annee]);
  return `CCC-${annee}-${String(rows[0].dernier).padStart(5, '0')}`;
}

const COLONNES = `id, numero, document_id, document_reference, file_id, version, nom_fichier, trim(empreinte_original) AS empreinte_original,
  trim(empreinte_copie) AS empreinte_copie, pages, destinataire, motif, request_id, autorisation_communication, lieu,
  delivre_par, delivre_par_nom, qualite_signataire, delivre_at, octet_length(pdf) AS octets`;

/**
 * Délivre une copie certifiée conforme. Corps : { file_id?, destinataire,
 * motif?, qualite?, lieu?, request_id?, autorisation? }. Rend { copie, pdf }.
 */
async function delivrer(tenantId, documentId, corps = {}, user) {
  const destinataire = String(corps.destinataire || '').trim();
  if (!destinataire) throw erreur(400, 'Indiquez à qui la copie est délivrée.');
  const doc = (await db.query(
    `SELECT d.id, d.reference_mfile, d.nom_entreprise, d.description, d.dossier_id, d.elimine_at, d.deleted_at
       FROM documents d WHERE d.id = $1 AND d.tenant_id = $2`, [Number(documentId), tenantId])).rows[0];
  if (!doc || !(await aclService.peutLire(tenantId, user.id, doc.dossier_id))) throw erreur(404, 'Document introuvable.');
  if (doc.elimine_at) throw erreur(409, 'Document éliminé : il n\'y a plus d\'original à reproduire.');
  if (doc.deleted_at) throw erreur(409, 'Document en corbeille : restaurez-le avant d\'en délivrer une copie.');

  const params = [Number(documentId)];
  let filtre = 'ORDER BY version DESC LIMIT 1';
  if (corps.file_id) { params.push(Number(corps.file_id)); filtre = `AND id = $2`; }
  const f = (await db.query(`SELECT * FROM document_files WHERE document_id = $1 ${filtre}`, params)).rows[0];
  if (!f) throw erreur(404, 'Version introuvable.');
  if (!f.empreinte_sha256) throw erreur(409, 'Empreinte d\'archivage en cours de calcul : réessayez dans quelques minutes.', 'SANS_EMPREINTE');

  // Communicabilité (art. 32-33) : hors délai, une autorisation écrite est exigée.
  const comm = await communicabiliteService.etatDocument(tenantId, doc.id);
  const autorisation = String(corps.autorisation || '').trim() || null;
  if (comm && !comm.communicable && !autorisation) {
    throw erreur(403, `Document non communicable au public (${comm.libelle}${comm.a_partir_du ? `, libre à partir du ${new Date(comm.a_partir_du).toLocaleDateString('fr-FR')}` : ''}) : indiquez l'autorisation qui permet de délivrer la copie.`, 'NON_COMMUNICABLE');
  }

  // Intégrité vérifiée maintenant, sur les octets réellement stockés.
  const { lireOctets } = require('./paquetService');
  const octets = await lireOctets(f);
  if (!octets) throw erreur(409, 'Fichier original introuvable dans le stockage : aucune copie ne peut être certifiée.', 'INTEGRITE');
  const attendue = String(f.empreinte_sha256).trim();
  if (sha256(octets) !== attendue) throw erreur(409, 'Le fichier conservé ne correspond plus à son empreinte d\'archivage : aucune copie ne peut être certifiée conforme.', 'INTEGRITE');

  const integrite = require('./integriteService');
  const qui = await integrite.identite(user);
  const reglages = await require('./settingsService').getAll(tenantId);
  const organisation = reglages.legal_entity || (await db.query('SELECT name FROM tenants WHERE id = $1', [tenantId])).rows[0]?.name || 'Organisation';
  const qualite = String(corps.qualite || '').trim() || (user.role === 'archiviste' ? 'archiviste' : 'responsable des archives');
  const lieu = String(corps.lieu || '').trim() || null;
  const delivreAt = new Date();

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const numero = await prochainNumero(client, tenantId, delivreAt.getFullYear());
    const { octets: pdf, pages } = await construirePdf(octets, {
      numero, organisation, document: { reference: doc.reference_mfile, intitule: doc.description || doc.nom_entreprise },
      fichier: { version: f.version, nom: f.original_name }, empreinte_original: attendue,
      signataire: qui.nom, qualite, destinataire, motif: corps.motif ? String(corps.motif).trim() : null,
      lieu, delivre_at: delivreAt, autorisation,
    });
    const { rows } = await client.query(
      `INSERT INTO copies_certifiees (tenant_id, numero, document_id, document_reference, file_id, version, nom_fichier,
         empreinte_original, empreinte_copie, pages, pdf, destinataire, motif, request_id, autorisation_communication, lieu,
         delivre_par, delivre_par_nom, qualite_signataire, delivre_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING ${COLONNES}`,
      [tenantId, numero, doc.id, doc.reference_mfile, f.id, f.version, f.original_name, attendue, sha256(pdf), pages, pdf,
        destinataire, corps.motif ? String(corps.motif).trim() : null, corps.request_id ? Number(corps.request_id) : null,
        autorisation, lieu, qui.id, qui.nom, qualite, delivreAt]);
    await client.query('COMMIT');
    const copie = rows[0];
    await documentAuditService.logAction({
      tenantId, documentId: doc.id, userId: qui.id, username: qui.username, action: 'COPIE_CERTIFIEE_DELIVREE',
      details: { numero, version: f.version, destinataire, empreinte_original: attendue, empreinte_copie: copie.empreinte_copie, autorisation },
    });
    return { copie, pdf };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function lister(tenantId, { document_id: documentId, annee } = {}) {
  const params = [tenantId];
  let filtre = '';
  if (documentId) { params.push(Number(documentId)); filtre += ` AND document_id = $${params.length}`; }
  if (annee) { params.push(Number(annee)); filtre += ` AND extract(year FROM delivre_at) = $${params.length}`; }
  return (await db.query(`SELECT ${COLONNES} FROM copies_certifiees WHERE tenant_id = $1${filtre} ORDER BY delivre_at DESC, id DESC LIMIT 500`, params)).rows;
}

/** Exemplaire du registre (PDF), tel que remis. */
async function exemplaire(tenantId, numero) {
  if (!RE_NUMERO.test(String(numero))) return null;
  return (await db.query('SELECT numero, pdf FROM copies_certifiees WHERE tenant_id = $1 AND numero = $2', [tenantId, numero])).rows[0] || null;
}

/** Une copie présentée (numéro, empreinte du PDF) a-t-elle été délivrée ici ? */
async function verifier(tenantId, numero, empreinte = null) {
  if (!RE_NUMERO.test(String(numero || '').trim())) return { trouve: false, motif: 'format' };
  const c = (await db.query(`SELECT ${COLONNES} FROM copies_certifiees WHERE tenant_id = $1 AND numero = $2`, [tenantId, String(numero).trim()])).rows[0];
  if (!c) return { trouve: false, motif: 'inconnu' };
  const attendue = String(empreinte || '').trim().toLowerCase();
  return { trouve: true, conforme: attendue ? attendue === c.empreinte_copie : null, copie: c };
}

module.exports = { nature, encodable, construirePdf, delivrer, lister, exemplaire, verifier, RE_NUMERO };
