// ============================================================================
// serviceArchives.test.js — copies certifiées conformes (039) et rapport
// annuel (décret n° 2007-532, art. 31 et 36 ; Code du numérique, art. 272).
// Exécution : npm run test:service-archives
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const copies = require('./services/copieCertifieeService');
const rapports = require('./services/rapportAnnuelService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// PNG 1×1 valide.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function pdfDeux() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const t of ['Acte de naissance n° 412', 'Page 2']) d.addPage([595, 842]).drawText(t, { x: 50, y: 700, font: f, size: 14 });
  return Buffer.from(await d.save());
}

(async () => {
  console.log('\n1. Sans base');
  const original = await pdfDeux();
  ok(copies.nature(original) === 'pdf' && copies.nature(PNG) === 'png' && copies.nature(Buffer.from('bonjour tout le monde')) === null, 'nature du fichier par signature');
  const a = {
    numero: 'CCC-2026-00001', organisation: 'Mairie de Vallée-Verte', document: { reference: 'DOC-1', intitule: 'Acte' },
    fichier: { version: 1, nom: 'acte.pdf' }, empreinte_original: sha(original), signataire: 'Aïcha Dossou', qualite: 'archiviste',
    destinataire: 'M. Koffi Mensah', motif: 'Dossier de passeport', lieu: 'Vallée-Verte', delivre_at: new Date('2026-10-27T10:00:00Z'),
  };
  const c = await copies.construirePdf(original, a);
  const relu = await PDFDocument.load(c.octets);
  ok(c.pages === 3 && relu.getPageCount() === 3, 'PDF : 2 pages reproduites + attestation');
  ok(relu.getTitle() === 'Copie certifiée conforme CCC-2026-00001', 'métadonnées : numéro de la copie');
  const c2 = await copies.construirePdf(original, a);
  ok(sha(c.octets) === sha(c2.octets), 'même délivrance, mêmes octets : la copie est reproductible');
  const img = await copies.construirePdf(PNG, a);
  ok(img.pages === 2, 'image PNG : une page + attestation');
  ok((await attendreErreur(() => copies.construirePdf(Buffer.from('PK\u0003\u0004 contenu bureautique'), a)))?.code === 'FORMAT_NON_REPRODUCTIBLE', 'format non reproductible : refusé (PDF/A d\'abord)');
  const helv = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  ok(copies.encodable(helv, 'Aïcha « Dossou » — n° 3 ✓') === 'Aïcha « Dossou » — n° 3 ?', 'texte ramené à l\'encodage de la police (accents conservés)');
  const vide = { conservation: { alterees: 0, formats_a_risque: 0 }, fonds: { classes_sans_duree: 0, documents_papier: 0 }, recolement: { manquants: 0, abimes: 0, clos: 0 }, communication: { prets_en_retard: 0 }, eliminations: { en_attente_visa: 0 } };
  ok(rapports.pointsAttention(vide).length === 0, 'rapport sans anomalie : aucun point d\'attention');
  ok(rapports.pointsAttention({ ...vide, fonds: { classes_sans_duree: 2, documents_papier: 5 } }).length === 2, 'classes sans durée et papier sans récolement : signalés');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const { FILES_DIR } = require('./config/paths');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Copies ${s}`, `copies-${s}`])).rows[0].id;
    const archi = (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Aïcha Dossou', $3, 'archiviste') RETURNING id, tenant_id, role, username, full_name",
      [t, `archi${s}`, `archi${s}@exemple.test`])).rows[0];
    const doc = async (ref, octets, nom, extra = '') => {
      const d = (await db.query(
        `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by, description${extra ? ', classe_id' : ''})
         VALUES ($1, $2, 'D', 'A', 'X', 2026, 'archivé', $3, $4${extra ? ', $5' : ''}) RETURNING id`,
        extra ? [t, `${ref}-${s}`, archi.id, ref, extra] : [t, `${ref}-${s}`, archi.id, ref])).rows[0].id;
      const stocke = `copie-test-${s}-${ref}`;
      fs.writeFileSync(path.join(FILES_DIR, stocke), octets);
      await db.query(
        `INSERT INTO document_files (document_id, version, original_name, stored_name, mime_type, file_size, uploaded_by, empreinte_sha256, empreinte_at)
         VALUES ($1, 1, $2, $3, 'application/pdf', $4, $5, $6, now())`, [d, nom, stocke, octets.length, archi.id, sha(octets)]);
      return { id: d, stocke };
    };
    const acte = await doc('Acte', original, 'acte-412.pdf');
    const { copie, pdf } = await copies.delivrer(t, acte.id, { destinataire: 'M. Koffi Mensah', motif: 'Passeport', lieu: 'Vallée-Verte' }, archi);
    ok(/^CCC-\d{4}-00001$/.test(copie.numero) && copie.pages === 3, `copie délivrée : ${copie.numero}, 3 pages`);
    ok(copie.empreinte_original === sha(original) && copie.empreinte_copie === sha(pdf), 'registre : empreintes de l\'original et du PDF remis');
    const deux = await copies.delivrer(t, acte.id, { destinataire: 'Tribunal de Cotonou' }, archi);
    ok(deux.copie.numero.endsWith('00002'), 'numérotation annuelle continue');
    ok((await copies.verifier(t, copie.numero, sha(pdf))).conforme === true, 'copie présentée intacte : conforme au registre');
    ok((await copies.verifier(t, copie.numero, sha(Buffer.from('falsifiée')))).conforme === false, 'copie retouchée : non conforme');
    ok((await copies.exemplaire(t, copie.numero)).pdf.equals(pdf), 'exemplaire du registre identique au PDF remis');
    ok((await attendreErreur(() => db.query('DELETE FROM copies_certifiees WHERE id = $1', [copie.id]))) !== null, 'base : le registre est inaltérable');
    ok((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'COPIE_CERTIFIEE_DELIVREE'", [t])).rows[0].n === 2, 'délivrances journalisées');
    ok((await attendreErreur(() => copies.delivrer(t, acte.id, {}, archi)))?.status === 400, 'destinataire obligatoire');

    // Intégrité vérifiée à l'instant : un fichier altéré ne se certifie pas.
    const altere = await doc('Altere', original, 'altere.pdf');
    fs.writeFileSync(path.join(FILES_DIR, altere.stocke), Buffer.concat([original, Buffer.from('x')]));
    ok((await attendreErreur(() => copies.delivrer(t, altere.id, { destinataire: 'X' }, archi)))?.code === 'INTEGRITE', 'fichier altéré depuis l\'archivage : copie refusée');

    // Communicabilité (art. 33) : état civil de moins de 100 ans.
    const classe = (await db.query("INSERT INTO metadata_schemas (tenant_id, name, communicabilite) VALUES ($1, 'Actes d''état civil', 'etat_civil') RETURNING id", [t])).rows[0].id;
    const civil = await doc('Civil', PNG, 'naissance.png', classe);
    await db.query("UPDATE documents SET date_document = '2001-05-04' WHERE id = $1", [civil.id]);
    ok((await attendreErreur(() => copies.delivrer(t, civil.id, { destinataire: 'Un tiers' }, archi)))?.code === 'NON_COMMUNICABLE', 'état civil de 2001 : copie refusée sans autorisation');
    const autorisee = await copies.delivrer(t, civil.id, { destinataire: 'La personne concernée', autorisation: 'Intéressé, pièce d\'identité vérifiée' }, archi);
    ok(autorisee.copie.autorisation_communication && autorisee.copie.pages === 2, 'avec autorisation : copie de l\'image délivrée');

    // Rapport annuel.
    const annee = new Date().getFullYear();
    const r = await rapports.rapport(t, annee);
    ok(r.accroissements.documents === 3 && r.fonds.documents === 3, `rapport ${annee} : 3 entrées, 3 documents au fonds`);
    ok(r.communication.copies_certifiees === 3 && r.communication.copies_sur_autorisation === 1, 'rapport : 3 copies, dont 1 sur autorisation');
    ok(r.fonds.classes_sans_duree === 1 && r.points_attention.some((x) => /sans durée/.test(x)), 'rapport : classe sans durée signalée');
    ok((await attendreErreur(() => rapports.rapport(t, 'deux mille')))?.status === 400, 'année invalide : refusée');

    for (const d of [acte, altere, civil]) fs.rmSync(path.join(FILES_DIR, d.stocke), { force: true });
    const cx = await db.pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query("SET LOCAL docuflow.audit_override = 'on'");
      await cx.query('DELETE FROM tenants WHERE id = $1', [t]);
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { cx.release(); }
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Service d'archives cohérent — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
