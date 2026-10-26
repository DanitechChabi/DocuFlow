// ============================================================================
// integrite.test.js — preuve et intégrité (migration 031).
// 1. SANS BASE : empreintes (vecteur connu, flux, fichier reçu, stockage
//    disque et Cloudinary simulé), erreurs de gel, relevé des sceaux.
// 2. AVEC BASE (DB_HOST ou DATABASE_URL) : empreinte au versement, doublons
//    bornés au périmètre, contrôle (intacte → altérée → introuvable →
//    rétablie), rattrapage, journal chaîné (altération, purge déclarée,
//    suppression non déclarée, troncature), sceaux, gel juridique (base et
//    API), rétention suspendue, certificat vérifiable, isolement.
// Exécution : npm run test:integrite
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

// Stockage local isolé : les fichiers du test ne touchent pas backend/uploads.
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-integrite-'));
const { FILES_DIR } = require('./config/paths');
const integrite = require('./services/integriteService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const SHA_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

/** Réponse Express minimale : statut et corps JSON. */
const reponse = () => {
  const r = { statut: 200, corps: null };
  r.status = (s) => { r.statut = s; return r; };
  r.json = (c) => { r.corps = c; return r; };
  return r;
};

(async () => {
  console.log('\n1. Empreintes');
  ok(integrite.empreinteTampon(Buffer.from('abc')) === SHA_ABC, 'SHA-256 de « abc » : vecteur de référence');
  ok(await integrite.empreinteFlux(Readable.from([Buffer.from('a'), Buffer.from('bc')])) === SHA_ABC, 'flux en plusieurs morceaux : même empreinte');
  const recu = path.join(FILES_DIR, 'recu-test.txt');
  fs.writeFileSync(recu, 'abc');
  ok(await integrite.empreinteVersement({ path: recu, originalname: 'recu.txt' }) === SHA_ABC, 'fichier reçu : empreinte calculée');
  ok(await integrite.empreinteVersement({ path: path.join(FILES_DIR, 'absent.txt'), originalname: 'absent.txt' }) === null, 'fichier reçu illisible : null, sans lever');
  ok(await integrite.empreinteStockee({ stored_name: 'recu-test.txt' }) === SHA_ABC, 'fichier stocké sur disque : relu en flux');
  ok(await integrite.empreinteStockee({ stored_name: 'disparu.txt' }) === null, 'fichier stocké absent : introuvable (null)');

  const httpReel = integrite.http;
  const storage = require('./services/storageService');
  const urlReelle = storage.signedCloudinaryUrl;
  storage.signedCloudinaryUrl = () => 'https://res.cloudinary.test/fichier';
  integrite.http = { get: async () => ({ data: Readable.from([Buffer.from('abc')]) }) };
  ok(await integrite.empreinteStockee({ cloudinary_public_id: 'documents/x', mime_type: 'application/pdf' }) === SHA_ABC, 'Cloudinary : fichier relu par URL signée');
  integrite.http = { get: async () => { throw Object.assign(new Error('Not Found'), { response: { status: 404 } }); } };
  ok(await integrite.empreinteStockee({ cloudinary_public_id: 'documents/x', mime_type: 'application/pdf' }) === null, 'Cloudinary 404 : introuvable');
  integrite.http = { get: async () => { throw new Error('ECONNRESET'); } };
  let leve = false;
  try { await integrite.empreinteStockee({ cloudinary_public_id: 'documents/x', mime_type: 'application/pdf' }); } catch { leve = true; }
  ok(leve, 'Cloudinary injoignable : erreur levée (une panne n\'est pas une perte)');
  integrite.http = httpReel;
  storage.signedCloudinaryUrl = urlReelle;

  console.log('\n2. Gel et sceaux (sans base)');
  ok(integrite.estErreurGel({ message: 'GEL_JURIDIQUE: le document 4 est sous gel juridique' }) && integrite.estErreurGel(integrite.erreurGel(null))
    && !integrite.estErreurGel(new Error('autre')), 'refus de gel reconnu, du trigger comme du code');
  const r409 = reponse();
  integrite.reponseGel(r409, { id: 1, document_id: 4, motif: 'Contentieux', reference: 'RG 26/104' });
  ok(r409.statut === 409 && r409.corps.code === 'GEL_JURIDIQUE' && /RG 26\/104/.test(r409.corps.message), 'réponse 409 GEL_JURIDIQUE avec la référence du gel');
  const csv = integrite.sceauxEnCsv([{ rang: 12, hash: 'f'.repeat(64), origine: 'auto', scelle_par: null, scelle_at: '2026-10-26T08:00:00Z' }], 'Mairie; centrale');
  ok(csv.startsWith('﻿organisation;rang;empreinte_sha256') && csv.includes('"Mairie; centrale";12;' + 'f'.repeat(64) + ';auto;;2026-10-26T08:00:00.000Z'),
    'relevé des sceaux : CSV pour Excel, séparateur échappé');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n3. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n3. Sur PostgreSQL');
    const db = require('./config/db');
    const aclService = require('./services/aclService');
    const roleService = require('./services/roleService');
    const retentionService = require('./services/retentionService');
    const { addFileToDocument } = require('./services/documentIndexService');
    const documentController = require('./controllers/documentController');
    ok(await integrite.migrationPassee(), 'migration 031 appliquée');

    const s = Date.now();
    const tenant = async (nom) => (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`${nom} ${s}`, `${nom.toLowerCase()}-${s}`])).rows[0].id;
    const t = await tenant('Integ');
    const t2 = await tenant('Ailleurs');
    await roleService.provisionRoles(t);
    const utilisateur = async (tid, role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username, full_name",
      [tid, `${nom}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const archiviste = await utilisateur(t, 'archiviste', 'Archi');
    const agent = await utilisateur(t, 'agent', 'Agent');
    const autre = await utilisateur(t2, 'archiviste', 'Autre');
    const nouveauDocument = async (tid, extra = {}) => (await db.query(
      `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, dossier_id, date_document)
       VALUES ($1, $2, 'D-1', 'A-1', 'SOBEBRA', 2026, 'disponible', $3, $4) RETURNING id`,
      [tid, `I-${s}-${Math.random().toString(36).slice(2, 8)}`, extra.dossier || null, extra.date || null])).rows[0].id;
    let numero = 0;
    const verser = async (tid, docId, contenu, user) => {
      const nom = `t${s}-${++numero}.txt`;
      fs.writeFileSync(path.join(FILES_DIR, nom), contenu);
      return addFileToDocument(tid, docId, user.id, { path: path.join(FILES_DIR, nom), filename: nom, originalname: `piece-${numero}.txt`, mimetype: 'text/plain', size: Buffer.byteLength(contenu) });
    };

    // --- Empreinte au versement, doublons ----------------------------------
    const d1 = await nouveauDocument(t);
    const v1 = await verser(t, d1, 'Facture F-2026-001 — 1 200 000 FCFA', archiviste);
    const attendue = integrite.empreinteTampon(Buffer.from('Facture F-2026-001 — 1 200 000 FCFA'));
    ok(v1.empreinte_sha256.trim() === attendue && v1.empreinte_origine === 'versement' && v1.integrite_statut === 'intacte',
      'versement : empreinte SHA-256 enregistrée, origine « versement », vérifiée de fait (disque)');
    ok(Array.isArray(v1.doublons) && v1.doublons.length === 0, 'premier versement : aucun doublon');
    const d2 = await nouveauDocument(t);
    const v2 = await verser(t, d2, 'Facture F-2026-001 — 1 200 000 FCFA', agent);
    ok(v2.doublons.length === 1 && v2.doublons[0].id === d1, 'même fichier versé dans un autre document : doublon signalé');
    const dossier = (await db.query("INSERT INTO document_folders (tenant_id, name) VALUES ($1, 'Contentieux') RETURNING id", [t])).rows[0].id;
    await db.query("INSERT INTO folder_acls (tenant_id, folder_id, subject_type, subject_id, level) VALUES ($1, $2, 'user', $3, 'manage')", [t, dossier, String(archiviste.id)]);
    await db.query('UPDATE documents SET dossier_id = $1 WHERE id = $2', [dossier, d1]);
    aclService.invalidate();
    ok((await integrite.doublons(t, attendue, { userId: agent.id, exclureDocumentId: d2 })).length === 0, 'doublon dans un dossier hors périmètre : non révélé');
    ok((await integrite.doublons(t, attendue, { userId: archiviste.id, exclureDocumentId: d2 })).length === 1, 'doublon visible de qui lit le dossier');
    const groupes = await integrite.groupesDoublons(t, archiviste);
    ok(groupes.length === 1 && groupes[0].documents.length === 2, 'vue Archivage : un groupe de deux documents identiques');
    ok((await integrite.groupesDoublons(t, agent)).length === 0, 'vue Archivage, hors périmètre : le groupe ne compte plus qu\'un document, il disparaît');

    // --- Contrôle d'intégrité ----------------------------------------------
    const cheminV1 = path.join(FILES_DIR, v1.stored_name);
    let res = await integrite.verifierDocument(t, d1, { acteur: archiviste });
    ok(res.length === 1 && res[0].statut === 'intacte', 'contrôle immédiat : intacte');
    fs.writeFileSync(cheminV1, 'Facture F-2026-001 — 9 200 000 FCFA');
    res = await integrite.verifierDocument(t, d1, { acteur: archiviste });
    ok(res[0].statut === 'alteree' && res[0].empreinte_constatee !== attendue, 'fichier modifié hors DocuFlow : altération constatée');
    const audit = async (doc, action) => (await db.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND object_type = 'document' AND object_id = $2 AND action = $3", [t, doc, action])).rows[0].n;
    ok(await audit(d1, 'INTEGRITE_ALTEREE') === 1, 'altération journalisée (INTEGRITE_ALTEREE)');
    const notif = (await db.query("SELECT id_user, document_id FROM notifications WHERE tenant_id = $1 AND type = 'archives'", [t])).rows;
    ok(notif.some((x) => x.id_user === archiviste.id && x.document_id === d1) && !notif.some((x) => x.id_user === agent.id),
      'altération signalée aux gestionnaires de l\'archivage (archives.manage), pas aux agents, notification liée au document');
    fs.rmSync(cheminV1);
    res = await integrite.verifierDocument(t, d1);
    ok(res[0].statut === 'introuvable' && await audit(d1, 'FICHIER_INTROUVABLE') === 1, 'fichier disparu : introuvable, journalisé');
    fs.writeFileSync(cheminV1, 'Facture F-2026-001 — 1 200 000 FCFA');
    res = await integrite.verifierDocument(t, d1);
    ok(res[0].statut === 'intacte' && await audit(d1, 'INTEGRITE_RETABLIE') === 1, 'fichier restauré à l\'identique : intégrité rétablie, journalisée');
    const anomaliesAvant = await integrite.anomalies(t, archiviste);
    ok(anomaliesAvant.length === 0, 'plus aucune anomalie en cours');

    // Rattrapage d'un fichier versé avant la 031.
    fs.writeFileSync(path.join(FILES_DIR, `ancien-${s}.txt`), 'abc');
    const ancien = (await db.query(
      `INSERT INTO document_files (document_id, version, original_name, stored_name, mime_type, file_size)
       VALUES ($1, 2, 'ancien.txt', $2, 'text/plain', 3) RETURNING id`, [d2, `ancien-${s}.txt`])).rows[0].id;
    const perdu = (await db.query(
      `INSERT INTO document_files (document_id, version, original_name, stored_name, mime_type, file_size)
       VALUES ($1, 3, 'perdu.txt', $2, 'text/plain', 3) RETURNING id`, [d2, `perdu-${s}.txt`])).rows[0].id;
    for (let i = 0; i < 20 && (await db.query('SELECT 1 FROM document_files WHERE id = ANY($1) AND empreinte_sha256 IS NULL AND integrite_statut IS NULL', [[ancien, perdu]])).rowCount; i += 1) {
      // Borné à l'organisation du test : le stockage du test est un dossier
      // temporaire, les fichiers des autres organisations y seraient « perdus ».
      await integrite.rattraperEmpreintes({ lot: 50, tenantId: t });
    }
    const rattrapes = (await db.query('SELECT id, empreinte_sha256, empreinte_origine, integrite_statut FROM document_files WHERE id = ANY($1) ORDER BY id', [[ancien, perdu]])).rows;
    ok(rattrapes[0].empreinte_sha256.trim() === SHA_ABC && rattrapes[0].empreinte_origine === 'rattrapage' && rattrapes[0].integrite_statut === 'intacte',
      'rattrapage : empreinte calculée sur le fichier stocké, origine « rattrapage »');
    ok(rattrapes[1].empreinte_sha256 === null && rattrapes[1].integrite_statut === 'introuvable', 'rattrapage d\'un fichier déjà perdu : introuvable, sans empreinte');
    ok(!(await db.query("SELECT 1 FROM notifications WHERE tenant_id = $1 AND type = 'archives' AND message LIKE '%perdu.txt%'", [t])).rowCount,
      'fichier déjà perdu découvert au rattrapage : journalisé sans alerter (pas d\'inondation)');
    const rapport = await integrite.rapport(t);
    ok(rapport.fichiers.total === 4 && rapport.fichiers.avec_empreinte === 3 && rapport.fichiers.introuvables === 1 && rapport.doublons === 1,
      `rapport : ${rapport.fichiers.total} fichiers, ${rapport.fichiers.avec_empreinte} empreintes, ${rapport.fichiers.introuvables} introuvable, ${rapport.doublons} doublon`);

    // --- Journal chaîné ------------------------------------------------------
    let journal = await integrite.verifierJournal(t);
    ok(journal.integre && journal.lignes >= 4 && journal.tete.conforme && journal.dernier_rang === journal.lignes,
      `journal chaîné intègre (${journal.lignes} maillons, tête conforme)`);
    const sceau = await integrite.sceller(t, { user: archiviste });
    ok(sceau.nouveau && sceau.rang === journal.dernier_rang && sceau.hash === journal.dernier_hash, 'sceau manuel : tête de chaîne figée');
    ok((await integrite.sceller(t, { user: archiviste })).nouveau === false, 'sceau identique au dernier : pas de doublon');
    const cible = (await db.query("SELECT id, chaine_rang FROM audit_logs WHERE tenant_id = $1 AND action = 'INTEGRITE_ALTEREE'", [t])).rows[0];
    const retoucher = async (sql, params) => {
      const c = await db.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SET LOCAL docuflow.audit_override = 'on'");
        await c.query(sql, params);
        await c.query('COMMIT');
      } finally { c.release(); }
    };
    await retoucher("UPDATE audit_logs SET details_json = details_json || '{\"constatee\": null}' WHERE id = $1", [cible.id]);
    journal = await integrite.verifierJournal(t);
    ok(!journal.integre && journal.anomalies.total === 1 && journal.anomalies.premieres[0].anomalie === 'alteree'
      && Number(journal.anomalies.premieres[0].debut) === Number(cible.chaine_rang), 'ligne retouchée (même avec le drapeau de purge) : altération localisée au bon rang');
    // Remise en l'état exact : l'empreinte constatée lors de l'altération.
    await retoucher("UPDATE audit_logs SET details_json = details_json - 'constatee' || jsonb_build_object('constatee', $2::text) WHERE id = $1",
      [cible.id, integrite.empreinteTampon(Buffer.from('Facture F-2026-001 — 9 200 000 FCFA'))]);
    journal = await integrite.verifierJournal(t);
    ok(journal.integre, 'contenu d\'origine rétabli : la chaîne redevient intègre (l\'empreinte porte bien sur le contenu)');

    const purgee = (await db.query("SELECT id, chaine_rang FROM audit_logs WHERE tenant_id = $1 AND action = 'FICHIER_INTROUVABLE' AND object_id = $2", [t, d1])).rows[0];
    await retoucher('DELETE FROM audit_logs WHERE id = $1', [purgee.id]);
    journal = await integrite.verifierJournal(t);
    ok(journal.integre && journal.lignes_purgees === 1 && journal.purges_declarees === 1, 'purge administrative (drapeau 014) : déclarée, la chaîne reste vérifiable');
    await db.query('DELETE FROM audit_chaine_purges WHERE tenant_id = $1', [t]);
    journal = await integrite.verifierJournal(t);
    ok(!journal.integre && journal.anomalies.premieres.some((x) => x.anomalie === 'discontinuite'), 'trace de purge effacée : la ligne manquante apparaît (discontinuité)');

    await db.query("INSERT INTO audit_logs (tenant_id, action) VALUES ($1, 'Dernière entrée')", [t]);
    const derniere = (await db.query('SELECT id FROM audit_logs WHERE tenant_id = $1 ORDER BY chaine_rang DESC LIMIT 1', [t])).rows[0];
    await retoucher('DELETE FROM audit_logs WHERE id = $1', [derniere.id]);
    await db.query('DELETE FROM audit_chaine_purges WHERE tenant_id = $1 AND rang_fin = (SELECT dernier_rang FROM audit_chaine_tetes WHERE tenant_id = $1)', [t]);
    journal = await integrite.verifierJournal(t);
    ok(!journal.tete.conforme, 'fin du journal tronquée sans trace : la tête de chaîne le révèle');
    ok(journal.sceaux.total === 1 && journal.sceaux.liste[0].etat === 'conforme', 'le sceau antérieur reste conforme');

    // --- Gel juridique --------------------------------------------------------
    const d3 = await nouveauDocument(t, { date: '2010-01-01' });
    await verser(t, d3, 'Contrat de bail — 2010', archiviste);
    const gel = await integrite.poserGel(t, d3, { motif: 'Contentieux locatif', reference: 'RG 26/104' }, archiviste);
    ok(gel.reference === 'RG 26/104' && gel.pose_par === 'Archi', 'gel posé, auteur et référence enregistrés');
    let refus = null;
    try { await integrite.poserGel(t, d3, { motif: 'Encore' }, archiviste); } catch (err) { refus = err; }
    ok(refus && refus.status === 409 && refus.code === 'DEJA_GELE', 'second gel actif : refusé (409)');
    refus = null;
    try { await integrite.poserGel(t, d3, { motif: '  ' }, archiviste); } catch (err) { refus = err; }
    ok(refus && refus.status === 400, 'gel sans motif : refusé (400)');
    let erreurBase = null;
    try { await db.query('UPDATE documents SET deleted_at = now() WHERE id = $1', [d3]); } catch (err) { erreurBase = err; }
    ok(integrite.estErreurGel(erreurBase), 'base : corbeille refusée par le trigger (requête directe)');
    erreurBase = null;
    try { await db.query('DELETE FROM document_files WHERE document_id = $1', [d3]); } catch (err) { erreurBase = err; }
    ok(integrite.estErreurGel(erreurBase), 'base : retrait de version refusé');
    erreurBase = null;
    try { await db.query('DELETE FROM documents WHERE id = $1', [d3]); } catch (err) { erreurBase = err; }
    ok(integrite.estErreurGel(erreurBase), 'base : destruction refusée');

    const req = (user, params) => ({ user: { ...user, tenant_id: t }, params, ip: '127.0.0.1' });
    let r = reponse();
    await documentController.deleteDocument(req(archiviste, { id: String(d3) }), r);
    ok(r.statut === 409 && r.corps.code === 'GEL_JURIDIQUE' && r.corps.gel.reference === 'RG 26/104', 'API : mise à la corbeille → 409 GEL_JURIDIQUE');
    const fichierD3 = (await db.query('SELECT id FROM document_files WHERE document_id = $1', [d3])).rows[0].id;
    r = reponse();
    await documentController.deleteFile(req(archiviste, { id: String(d3), fileId: String(fichierD3) }), r);
    ok(r.statut === 409 && r.corps.code === 'GEL_JURIDIQUE', 'API : retrait de version → 409, connexion rendue une seule fois (pas de plantage)');

    const politique = await retentionService.createPolicy({ tenantId: t, name: 'Bail 5 ans', retentionYears: 5, actionOnExpiry: 'delete' });
    const bilanRetention = await retentionService.applyRetention(t);
    ok(bilanRetention.suspendus.some((e) => e.documentId === d3) && !bilanRetention.erreurs.length, 'rétention échue sur un document gelé : destruction suspendue, sans erreur');
    ok(!(await db.query('SELECT deleted_at FROM documents WHERE id = $1', [d3])).rows[0].deleted_at, 'document gelé toujours hors corbeille');
    await retentionService.deletePolicy(t, politique.id);

    ok((await integrite.listerGels(t, archiviste)).length === 1 && (await integrite.listerGels(t2, autre)).length === 0, 'gels : visibles dans l\'organisation seulement');
    await db.query('UPDATE documents SET dossier_id = $1 WHERE id = $2', [dossier, d3]);
    ok((await integrite.listerGels(t, agent)).length === 0, 'gel d\'un document hors périmètre : masqué');
    await db.query('UPDATE documents SET dossier_id = NULL WHERE id = $1', [d3]);

    // --- Certificat --------------------------------------------------------
    const cert = await integrite.certificat(t, d3, archiviste);
    ok(cert.fichiers.length === 1 && cert.fichiers[0].empreinte_sha256 === integrite.empreinteTampon(Buffer.from('Contrat de bail — 2010'))
      && cert.gel && cert.gel.reference === 'RG 26/104' && /^[0-9a-f]{64}$/.test(cert.empreinte_certificat),
      'certificat : fichiers et empreintes, gel en cours, empreinte du certificat');
    ok(cert.evenements.some((e) => e.action === 'Gel juridique posé' && e.rang > 0 && /^[0-9a-f]{64}$/.test(e.empreinte)), 'certificat : événements avec leur maillon de chaîne');
    let verif = await integrite.verifierCertificat(t, cert.numero, cert.empreinte_certificat);
    ok(verif.trouve && verif.conforme === true && verif.rang_journal > 0, 'certificat présenté : retrouvé au journal, empreinte conforme');
    verif = await integrite.verifierCertificat(t, cert.numero, 'a'.repeat(64));
    ok(verif.trouve && verif.conforme === false, 'certificat retouché : empreinte non conforme');
    ok(!(await integrite.verifierCertificat(t2, cert.numero)).trouve, 'certificat d\'une autre organisation : inconnu');

    // Levée, puis destruction possible.
    refus = null;
    try { await integrite.leverGel(t, d3, {}, archiviste); } catch (err) { refus = err; }
    ok(refus && refus.status === 400, 'levée sans motif : refusée');
    const leve2 = await integrite.leverGel(t, d3, { motif: 'Jugement définitif du 12/10/2026' }, archiviste);
    ok(leve2.leve_at && leve2.motif_levee.startsWith('Jugement'), 'gel levé, motif conservé');
    r = reponse();
    await documentController.deleteDocument(req(archiviste, { id: String(d3) }), r);
    ok(r.statut === 200, 'après levée : mise à la corbeille acceptée');
    ok(await audit(d3, 'GEL_POSE') === 1 && await audit(d3, 'GEL_LEVE') === 1 && await audit(d3, 'CERTIFICAT_EMIS') === 1,
      'pose, levée et certificat journalisés');

    // --- Isolement, puis suppression des organisations de test -------------
    ok((await integrite.rapport(t2)).fichiers.total === 0 && (await integrite.verifierJournal(t2)).lignes === 0, 'autre organisation : rapport et journal vides');
    await integrite.poserGel(t, d1, { motif: 'Avant suppression' }, archiviste);
    const c = await db.pool.connect();
    let supprimee = false;
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL docuflow.audit_override = 'on'");
      await c.query("SET LOCAL docuflow.gel_override = 'on'");
      await c.query('DELETE FROM tenants WHERE id = ANY($1)', [[t, t2]]);
      await c.query('COMMIT');
      supprimee = true;
    } catch (err) {
      await c.query('ROLLBACK');
      console.error(err.message);
    } finally { c.release(); }
    ok(supprimee && !(await db.query('SELECT 1 FROM audit_chaine_tetes WHERE tenant_id = $1', [t])).rowCount
      && !(await db.query('SELECT 1 FROM audit_chaine_purges WHERE tenant_id = $1', [t])).rowCount,
      'organisation supprimée (super administrateur) : gels, journal, tête et traces partent avec elle');
    await db.pool.end();
  }
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Intégrité cohérente — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
