// ============================================================================
// conservation.test.js — preuve et pérennité (migration 037).
// 1. SANS BASE : requête RFC 3161 (DER), lecture d'un vrai jeton FreeTSA
//    (fixture), refus d'un jeton qui ne porte pas l'empreinte demandée ;
//    identification des formats par leur signature binaire.
// 2. AVEC BASE : horodatage des sceaux (réseau simulé), échec enregistré puis
//    retenté, jeton inaltérable ; format identifié au versement, bilan,
//    copie de conservation PDF/A (si LibreOffice est présent) ; sauvegarde
//    intégrée (vidage, documents, manifeste, rotation).
// Exécution : npm run test:conservation
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-conservation-'));
const { FILES_DIR } = require('./config/paths');
const horodatage = require('./services/horodatageService');
const formats = require('./services/formatService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

// Jeton réellement délivré par freetsa.org pour SHA-256("test\n").
const JETON = fs.readFileSync(path.join(__dirname, 'fixtures', 'horodatage-freetsa.tsr'));
const EMPREINTE = crypto.createHash('sha256').update('test\n').digest('hex');

(async () => {
  console.log('\n1. Sans base');
  const req = horodatage.requete(EMPREINTE, Buffer.from('0102030405060708', 'hex'));
  ok(req[0] === 0x30 && req.includes(Buffer.from(EMPREINTE, 'hex')) && req.includes(Buffer.from('0609608648016503040201', 'hex')),
    'requête RFC 3161 : SEQUENCE DER, algorithme SHA-256, empreinte demandée');
  ok(req.subarray(-3).equals(Buffer.from([0x01, 0x01, 0xff])), 'certReq : le jeton embarquera le certificat de l\'autorité');
  const a = horodatage.analyserReponse(JETON, EMPREINTE);
  ok(a.accorde && a.genere_at === '2026-10-27T08:33:25Z' && a.autorite === 'www.freetsa.org', 'jeton FreeTSA lu : accordé, date et autorité');
  ok((await attendreErreur(() => horodatage.analyserReponse(JETON, 'ab'.repeat(32))))?.message.includes('empreinte'), 'jeton pour une autre empreinte : refusé');
  ok(horodatage.dateGeneralisee('20261027083325.123Z') === '2026-10-27T08:33:25.123Z', 'date généralisée avec fractions');

  const f = (b, nom) => formats.identifier(Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'), nom);
  ok(f('%PDF-1.7\n...', 'a.pdf').nom === 'PDF' && f('%PDF-1.7\n...', 'a.pdf').risque === 'surveiller' && f('%PDF-1.7\n...').version === '1.7', 'PDF ordinaire : à surveiller, version lue');
  const pdfa = f('%PDF-1.6\n<rdf:Description pdfaid:part="2" pdfaid:conformance="B"/>');
  ok(pdfa.nom === 'PDF/A' && pdfa.pdfa === '2B' && pdfa.risque === 'perenne', 'PDF/A-2b déclaré dans le XMP : pérenne');
  ok(f(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])).nom === 'PNG' && f(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).nom === 'JPEG', 'PNG et JPEG reconnus');
  ok(f(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 'vieux.doc').nom === 'Word 97-2003'
    && f(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 'vieux.doc').risque === 'risque', 'Word 97-2003 : à risque');
  const zip = (nom, contenu = '') => {
    const n = Buffer.from(nom); const c = Buffer.from(contenu);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt32LE(c.length, 18); h.writeUInt32LE(c.length, 22); h.writeUInt16LE(n.length, 26);
    return Buffer.concat([h, n, c]);
  };
  ok(f(Buffer.concat([zip('[Content_Types].xml', '<x/>'), zip('word/document.xml', '<w/>')])).nom === 'Word (DOCX)', 'DOCX reconnu dans son archive ZIP');
  ok(f(zip('mimetype', 'application/vnd.oasis.opendocument.text')).nom === 'OpenDocument Texte', 'OpenDocument reconnu (pérenne)');
  ok(f('Bonjour, ceci est du texte.\n', 'note.txt').nom === 'Texte' && f('<?xml version="1.0"?><a/>').nom === 'XML', 'texte et XML reconnus');
  ok(f(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00])).risque === 'risque', 'format inconnu : à risque');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const roleService = require('./services/roleService');
    const { addFileToDocument } = require('./services/documentIndexService');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Conservation ${s}`, `conservation-${s}`])).rows[0].id;
    await roleService.provisionRoles(t);
    const archi = (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Archi', $3, 'archiviste') RETURNING id, tenant_id, role, username",
      [t, `archi${s}`, `archi${s}@exemple.test`])).rows[0];
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'horodatage_actif', 'true')", [t]);
    require('./services/settingsService').invalidate?.(t);

    // --- Horodatage ----------------------------------------------------------
    const sceau = (await db.query("INSERT INTO audit_sceaux (tenant_id, chaine_rang, chaine_hash, origine) VALUES ($1, 1, $2, 'manuel') RETURNING id", [t, EMPREINTE])).rows[0].id;
    let appels = 0;
    const reseau = horodatage.http;
    horodatage.http = { post: async () => { appels += 1; if (appels === 1) throw new Error('ECONNREFUSED'); return { data: JETON }; } };
    ok((await horodatage.enAttente(t)).some((x) => x.type === 'sceau' && x.id === sceau), 'sceau sans jeton : en attente d\'horodatage');
    const echec = await horodatage.horodater(t, 'sceau', sceau, EMPREINTE);
    ok(echec.statut === 'echec' && /ECONNREFUSED/.test(echec.erreur), 'autorité injoignable : échec enregistré, rien de bloqué');
    const obtenu = await horodatage.horodater(t, 'sceau', sceau, EMPREINTE);
    ok(obtenu.statut === 'obtenu' && obtenu.genere_at && obtenu.tentatives === 2, 'nouvelle tentative : jeton obtenu et conservé');
    ok((await horodatage.horodater(t, 'sceau', sceau, EMPREINTE)).id === obtenu.id && appels === 2, 'jeton déjà obtenu : rendu sans rappeler l\'autorité');
    ok((await horodatage.jeton(t, obtenu.id)).jeton.equals(JETON), 'jeton conservé octet pour octet (vérifiable par openssl ts -verify)');
    ok((await attendreErreur(() => db.query("UPDATE horodatages SET genere_at = now() WHERE id = $1", [obtenu.id]))) !== null, 'base : un jeton obtenu est inaltérable');
    ok(!(await horodatage.enAttente(t)).some((x) => x.type === 'sceau' && x.id === sceau), 'sceau horodaté : plus en attente');
    horodatage.http = reseau;

    // --- Formats --------------------------------------------------------------
    const doc = (await db.query(
      "INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by) VALUES ($1, $2, 'D', 'A', 'X', 2026, 'disponible', $3) RETURNING id",
      [t, `C-${s}`, archi.id])).rows[0].id;
    const nom = `c${s}.txt`;
    fs.writeFileSync(path.join(FILES_DIR, nom), 'Procès-verbal de la séance du conseil communal.\n');
    const v1 = await addFileToDocument(t, doc, archi.id, { path: path.join(FILES_DIR, nom), filename: nom, originalname: 'pv.txt', mimetype: 'text/plain', size: 50 });
    ok(v1.format_nom === 'Texte' && v1.format_risque === 'perenne' && v1.format_identifie_at, 'format identifié dès le versement');
    const { lisibles } = await require('./services/aclService').dossiersAccessibles(t, archi.id);
    const b = await formats.bilan(t, lisibles);
    ok(b.formats.some((x) => x.format === 'Texte' && x.fichiers === 1), 'bilan des formats de l\'organisation');
    if (formats.trouverSoffice()) {
      const copie = await formats.copieConservation(t, doc, v1.id, archi);
      const v2 = (await db.query('SELECT * FROM document_files WHERE id = $1', [copie.file_id])).rows[0];
      ok(copie.version === 2 && v2.pdfa && v2.copie_de_file_id === v1.id && v2.empreinte_sha256, 'copie de conservation PDF/A ajoutée en version 2, liée à sa source');
      ok((await db.query('SELECT count(*)::int AS n FROM document_files WHERE id = $1', [v1.id])).rows[0].n === 1, 'l\'original reste intact');
      ok((await attendreErreur(() => formats.copieConservation(t, doc, v1.id, archi)))?.status === 409, 'une seule copie de conservation par version');
      ok((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'COPIE_CONSERVATION_PDFA'", [t])).rows[0].n === 1, 'conversion journalisée avec les deux empreintes');
    } else {
      console.log('  —    copie PDF/A non testée : LibreOffice absent');
    }

    // --- Sauvegarde ----------------------------------------------------------
    const sauvegarde = require('./services/sauvegardeService');
    const ancien = process.env.DOCUFLOW_DATA_DIR;
    delete process.env.DOCUFLOW_DATA_DIR;
    ok(!sauvegarde.disponibilite().disponible, 'serveur hébergé : sauvegarde intégrée indisponible, l\'écran le dit');
    process.env.DOCUFLOW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-donnees-'));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-sauvegardes-'));
    if (sauvegarde.disponibilite().disponible) {
      ok((await attendreErreur(() => sauvegarde.enregistrer({ dossier: path.join(process.env.DOCUFLOW_DATA_DIR, 'x') })))?.status === 400, 'dossier dans les données de DocuFlow : refusé');
      sauvegarde.enregistrer({ dossier: dest, conserver: 1, actif: true });
      const r1 = await sauvegarde.executer();
      const d1 = path.join(dest, r1.nom);
      const m = JSON.parse(fs.readFileSync(path.join(d1, 'manifeste.json'), 'utf8'));
      ok(r1.ok && fs.statSync(path.join(d1, 'base.dump')).size > 0 && m.documents.fichiers >= 1 && fs.existsSync(path.join(d1, 'RESTAURER.txt')),
        'sauvegarde : vidage de la base, documents, manifeste et notice de restauration');
      ok(m.base.empreinte_sha256 === crypto.createHash('sha256').update(fs.readFileSync(path.join(d1, 'base.dump'))).digest('hex'), 'manifeste : empreinte du vidage exacte');
      fs.mkdirSync(path.join(dest, 'Mes photos'));
      await new Promise((r) => setTimeout(r, 1100));
      const r2 = await sauvegarde.executer();
      const restantes = fs.readdirSync(dest);
      ok(restantes.includes(r2.nom) && !restantes.includes(r1.nom) && restantes.includes('Mes photos'), 'rotation : une seule conservée, aucun autre dossier touché');
      ok(sauvegarde.etat().derniere?.ok === true && (await sauvegarde.sauvegarderSiDue()) === null, 'sauvegarde du jour faite : pas de seconde passe automatique');
    } else {
      console.log('  —    sauvegarde non testée : pg_dump absent');
    }
    if (ancien) process.env.DOCUFLOW_DATA_DIR = ancien; else delete process.env.DOCUFLOW_DATA_DIR;
    fs.rmSync(dest, { recursive: true, force: true });

    const cx = await db.pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query("SET LOCAL docuflow.audit_override = 'on'");
      await cx.query('DELETE FROM tenants WHERE id = $1', [t]);
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { cx.release(); }
    await db.pool.end();
  }
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Conservation cohérente — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
