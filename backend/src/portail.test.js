// ============================================================================
// portail.test.js — portail citoyen et vérification publique des copies (040).
// Exécution : npm run test:portail
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const portail = require('./services/portailService');
const copies = require('./services/copieCertifieeService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const valide = {
  type_acte: 'naissance', lien: 'soi_meme', demandeur_nom: 'MENSAH', demandeur_prenoms: 'Koffi Jean', telephone: '+229 01 97 00 00 00',
  personne_concernee: 'Koffi Jean MENSAH', date_evenement: '1998-03-14', lieu_evenement: 'Vallée-Verte', motif: 'Passeport',
};

(async () => {
  console.log('\n1. Sans base');
  ok(/^DF-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(portail.nouveauCode()), 'code de suivi : DF-XXXX-XXXX, sans 0/O ni 1/I');
  ok(portail.normaliserCode('df-ab2c 3d4e') === 'AB2C3D4E', 'code saisi en minuscules, avec espaces : reconnu');
  ok(portail.lireDemande(valide).erreurs.length === 0, 'demande complète : acceptée');
  ok(portail.lireDemande({ ...valide, site_web: 'http://spam' }).erreurs.length > 0, 'champ piège rempli (robot) : refusé');
  ok(portail.lireDemande({ ...valide, telephone: '12' }).erreurs.length > 0, 'téléphone invalide : refusé');
  ok(portail.lireDemande({ ...valide, date_evenement: '', annee_evenement: '' }).erreurs.some((e) => /année/.test(e)), 'ni date ni année : refusé');
  ok(portail.lireDemande({ ...valide, date_evenement: '', annee_evenement: 1975 }).valeurs.annee_evenement === 1975, 'année seule : acceptée');
  ok(portail.statutCitoyen({ statut: 'a traiter', copies: 1 }).cle === 'prete', 'copie délivrée : « prête »');
  ok(portail.statutCitoyen({ statut: 'transmis', copies: 0 }).cle === 'traitement' && portail.statutCitoyen({ statut: 'livré' }).cle === 'retiree', 'en traitement, puis retirée');
  const a = {
    numero: 'CCC-2026-00009', organisation: 'Mairie', document: { reference: 'DOC-1' }, fichier: { version: 1, nom: 'a.pdf' },
    empreinte_original: 'a'.repeat(64), signataire: 'A', qualite: 'archiviste', destinataire: 'B', delivre_at: new Date('2026-10-27'),
    verification_url: 'https://archives.exemple.bj/verifier/abcdefghijklmnopqrstuvwx',
  };
  const src = await PDFDocument.create(); src.addPage(); const brut = Buffer.from(await src.save());
  const avecQr = await copies.construirePdf(brut, a);
  const sansQr = await copies.construirePdf(brut, { ...a, verification_url: null });
  ok(avecQr.octets.includes(Buffer.from('/Subtype /Image')) && !sansQr.octets.includes(Buffer.from('/Subtype /Image')), 'QR code imprimé sur l\'attestation quand une adresse publique est connue');
  ok(copies.adressePublique({ adresse_publique: 'https://archives.exemple.bj/' }) === 'https://archives.exemple.bj', 'adresse publique normalisée (sans barre finale)');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const roleService = require('./services/roleService');
    const settingsService = require('./services/settingsService');
    const { FILES_DIR } = require('./config/paths');
    const s = Date.now();
    const slug = `mairie-${s}`;
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Mairie ${s}`, slug])).rows[0].id;
    await roleService.provisionRoles(t);
    const archi = (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Aïcha Dossou', $3, 'archiviste') RETURNING id, tenant_id, role, username, full_name",
      [t, `archi${s}`, `archi${s}@exemple.test`])).rows[0];

    ok((await attendreErreur(() => portail.deposer(slug, valide)))?.status === 404, 'portail fermé par défaut : dépôt refusé');
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'portail_citoyen_actif', 'true'), ($1, 'portail_lieu_retrait', 'Guichet état civil'), ($1, 'adresse_publique', 'https://archives.exemple.bj')", [t]);
    settingsService.invalidate(t);
    const depot = await portail.deposer(slug, valide, { ip: '10.0.0.1' });
    ok(/^DF-/.test(depot.code_suivi), `demande déposée : ${depot.code_suivi}`);
    const dc = (await db.query('SELECT * FROM demandes_citoyennes WHERE code_suivi = $1', [depot.code_suivi])).rows[0];
    const req = (await db.query('SELECT r.*, u.username FROM requests r JOIN users u ON u.id = r.id_user WHERE r.id = $1', [dc.request_id])).rows[0];
    ok(req.statut === 'en attente' && req.username === `portail-citoyen-${t}` && req.nom_entreprise === 'Koffi Jean MENSAH', 'demande entrée dans le circuit habituel, au nom du compte technique');
    ok((await db.query("SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND request_id = $2", [t, req.id])).rows[0].n >= 1, 'personnel prévenu');
    let suivi = await portail.suivre(slug, depot.code_suivi.toLowerCase());
    ok(suivi.statut.cle === 'recue' && !JSON.stringify(suivi).includes('MENSAH'), 'suivi public : « reçue », aucun nom affiché');
    ok((await portail.suivre(slug, 'DF-AAAA-AAAA')) === null, 'code inconnu : rien');
    ok((await attendreErreur(() => portail.deposer(slug, { ...valide, telephone: '' })))?.status === 400, 'dépôt incomplet : 400');

    // Copie certifiée liée à la demande → « prête ».
    const d = (await db.query(
      "INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by) VALUES ($1, $2, 'EC', '412', 'MENSAH', 1998, 'archivé', $3) RETURNING id",
      [t, `ACTE-${s}`, archi.id])).rows[0].id;
    const src2 = await PDFDocument.create(); src2.addPage(); const original = Buffer.from(await src2.save());
    const stocke = `portail-test-${s}.pdf`;
    fs.writeFileSync(path.join(FILES_DIR, stocke), original);
    await db.query(
      `INSERT INTO document_files (document_id, version, original_name, stored_name, mime_type, file_size, uploaded_by, empreinte_sha256, empreinte_at)
       VALUES ($1, 1, 'acte.pdf', $2, 'application/pdf', $3, $4, $5, now())`, [d, stocke, original.length, archi.id, sha(original)]);
    ok((await attendreErreur(() => portail.marquerRetire(t, req.id, archi)))?.status === 409, 'retrait refusé tant qu\'aucune copie n\'est délivrée');
    const { copie, pdf } = await copies.delivrer(t, d, { destinataire: 'Koffi Jean MENSAH', request_id: req.id }, archi);
    ok(copie.verification_url && copie.verification_url.startsWith('https://archives.exemple.bj/verifier/'), 'copie : adresse de vérification (QR)');
    suivi = await portail.suivre(slug, depot.code_suivi);
    ok(suivi.statut.cle === 'prete' && suivi.lieu_retrait === 'Guichet état civil', 'suivi : « prête », lieu de retrait affiché');
    ok((await db.query('SELECT statut FROM requests WHERE id = $1', [req.id])).rows[0].statut === 'transmis', 'demande passée à « transmis » (étapes historisées)');
    const jeton = copie.verification_url.split('/').pop();
    const pub = await copies.verifierPublic(jeton, sha(pdf));
    ok(pub.numero === copie.numero && pub.conforme === true, 'vérification publique par le QR : copie authentique');
    ok((await copies.verifierPublic(jeton, sha(Buffer.from('autre')))).conforme === false && (await copies.verifierPublic('x'.repeat(24))) === null, 'fichier différent : non conforme ; jeton inconnu : rien');
    ok((await attendreErreur(() => copies.delivrer(t, d, { destinataire: 'X', request_id: 999999999 }, archi)))?.status === 404, 'demande liée d\'une autre organisation : refusée');
    const vue = await portail.marquerRetire(t, req.id, archi);
    ok(vue.retire_at && vue.statut_citoyen.cle === 'retiree', 'retrait au guichet enregistré');
    ok((await db.query('SELECT statut FROM requests WHERE id = $1', [req.id])).rows[0].statut === 'livré', 'demande livrée');
    const ind = await portail.indicateurs(t);
    ok(ind.demandes === 1 && ind.retirees === 1 && ind.delai_moyen_heures !== null, `indicateurs : délai moyen ${ind.delai_moyen_heures} h`);
    ok((await require('./services/demarrageService').etat(t)).etapes.find((e) => e.cle === 'equipe').detail === '1 compte(s)', 'le compte technique ne compte pas dans l\'équipe');

    fs.rmSync(path.join(FILES_DIR, stocke), { force: true });
    const cx = await db.pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query("SET LOCAL docuflow.audit_override = 'on'");
      await cx.query('DELETE FROM tenants WHERE id = $1', [t]);
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { cx.release(); }
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Portail citoyen cohérent — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
