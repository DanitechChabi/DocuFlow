// ============================================================================
// recherche.test.js — recherche avancée, recherches enregistrées et alertes,
// échéancier, paquet d'archive (migration 035).
// 1. SANS BASE : écrivain ZIP relu par un lecteur indépendant (Python
//    zipfile), CRC, noms UTF-8 ; normalisation des critères.
// 2. AVEC BASE : critères, périmètre, corbeille, facettes, extraits ;
//    recherches privées / partagées ; alerte (une fois, nouveaux seulement) ;
//    échéances dérivées (idempotence) et rappels (une fois) ; paquet
//    (manifeste, empreintes conformes aux octets) ; isolement.
// Exécution : npm run test:recherche
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-recherche-'));
const { FILES_DIR } = require('./config/paths');
const { EcrivainZip, crc32 } = require('./helpers/zip');
const recherche = require('./services/rechercheService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };
const LIRE_ZIP = `import sys, zipfile, json
z = zipfile.ZipFile(sys.argv[1])
print(json.dumps({"test": z.testzip(), "noms": z.namelist(), "contenus": {n: z.read(n).decode("utf-8", "replace") for n in z.namelist() if n.endswith((".txt", ".json", ".sha256"))}}))`;
const lireZip = (fichier) => JSON.parse(execFileSync('python3', ['-I', '-c', LIRE_ZIP, fichier]).toString());

(async () => {
  console.log('\n1. Sans base');
  ok(crc32(Buffer.from('123456789')) === 0xCBF43926, 'CRC-32 : vecteur de référence');
  const morceaux = [];
  const zip = new EcrivainZip((b) => { morceaux.push(b); });
  await zip.ajouter('fichiers/Reçu été.txt', 'Contenu accentué : été, garçon');
  await zip.ajouter('gros.txt', 'A'.repeat(50000));
  await zip.terminer('essai');
  const chemin = path.join(process.env.UPLOADS_DIR, 'essai.zip');
  fs.writeFileSync(chemin, Buffer.concat(morceaux));
  const lu = lireZip(chemin);
  ok(lu.test === null && lu.noms.includes('fichiers/Reçu été.txt') && lu.contenus['fichiers/Reçu été.txt'] === 'Contenu accentué : été, garçon'
    && lu.contenus['gros.txt'].length === 50000, 'ZIP relu par Python : CRC justes, nom UTF-8, compression');
  ok(fs.statSync(chemin).size < 5000, 'contenu répétitif compressé (deflate)');
  ok((await attendreErreur(() => recherche.normaliserCriteres({ annee: 'abc' })))?.status === 400 || (() => { try { recherche.normaliserCriteres({ annee: 'abc' }); return false; } catch (e) { return e.status === 400; } })(),
    'critère invalide : 400');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const aclService = require('./services/aclService');
    const roleService = require('./services/roleService');
    const echeances = require('./services/echeanceService');
    const paquets = require('./services/paquetService');
    const { addFileToDocument } = require('./services/documentIndexService');
    const s = Date.now();
    const tenant = async (nom) => (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`${nom} ${s}`, `${nom.toLowerCase()}-${s}`])).rows[0].id;
    const t = await tenant('Rech');
    const t2 = await tenant('Ailleurs');
    await roleService.provisionRoles(t);
    const utilisateur = async (tid, role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username",
      [tid, `${nom.toLowerCase()}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const archi = await utilisateur(t, 'archiviste', 'Archi');
    const agent = await utilisateur(t, 'agent', 'Agent');
    const autre = await utilisateur(t2, 'archiviste', 'Autre');
    const classe = (await db.query("INSERT INTO metadata_schemas (tenant_id, name, is_default) VALUES ($1, 'Contrat', FALSE) RETURNING id", [t])).rows[0].id;
    const champ = (await db.query("INSERT INTO metadata_fields (schema_id, name, label, type, est_echeance) VALUES ($1, 'date_de_fin', 'Date de fin', 'date', true) RETURNING id", [classe])).rows[0].id;
    const dossier = (await db.query("INSERT INTO document_folders (tenant_id, name) VALUES ($1, 'Direction') RETURNING id", [t])).rows[0].id;
    let n = 0;
    const doc = async ({ entreprise, annee = 2026, texte = '', classeId = null, dossierId = null, fichier = null }) => {
      const id = (await db.query(
        `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by, classe_id, dossier_id, contenu_texte)
         VALUES ($1, $2, 'D', 'A', $3, $4, 'disponible', $5, $6, $7, $8) RETURNING id`, [t, `R-${s}-${++n}`, entreprise, annee, archi.id, classeId, dossierId, texte])).rows[0].id;
      if (fichier) {
        const nom = `r${s}-${n}.txt`;
        fs.writeFileSync(path.join(FILES_DIR, nom), fichier);
        await addFileToDocument(t, id, archi.id, { path: path.join(FILES_DIR, nom), filename: nom, originalname: `piece ${n}.txt`, mimetype: 'text/plain', size: Buffer.byteLength(fichier) });
      }
      return id;
    };
    const d1 = await doc({ entreprise: 'SOBEBRA', texte: 'Contrat de maintenance des groupes électrogènes', classeId: classe, fichier: 'Contrat SOBEBRA — maintenance des groupes' });
    const d2 = await doc({ entreprise: 'BÂTIR PLUS', annee: 2025, texte: 'Facture de travaux de toiture', fichier: 'Facture toiture' });
    const d3 = await doc({ entreprise: 'SOBEBRA', texte: 'Note confidentielle de maintenance', dossierId: dossier });
    await db.query("INSERT INTO folder_acls (tenant_id, folder_id, subject_type, subject_id, level) VALUES ($1, $2, 'user', $3, 'manage')", [t, dossier, String(archi.id)]);
    aclService.invalidate();
    await db.query("INSERT INTO metadata_values (document_id, field_id, value_json) VALUES ($1, $2, '\"2026-12-31\"')", [d1, champ]);

    // --- Recherche --------------------------------------------------------
    let r = await recherche.rechercher(t, archi, { texte: 'maintenance' });
    ok(r.total === 2 && r.resultats.some((x) => x.id === d3), 'texte intégral : le contenu des fichiers est cherché');
    ok(r.resultats.some((x) => x.extrait && x.extrait.some((seg) => seg.s)), 'extrait avec mots surlignés');
    r = await recherche.rechercher(t, agent, { texte: 'maintenance' });
    ok(r.total === 1 && !r.resultats.some((x) => x.id === d3), 'hors périmètre : le document du dossier restreint n\'apparaît pas');
    r = await recherche.rechercher(t, archi, { entreprise: 'sobebra', annee_min: 2026 });
    ok(r.total === 2, 'combinaison entreprise + année');
    r = await recherche.rechercher(t, archi, { classe_id: classe });
    ok(r.total === 1 && r.resultats[0].id === d1, 'critère de classe');
    r = await recherche.rechercher(t, archi, {});
    ok(r.facettes && JSON.stringify(r.facettes).includes('2025'), 'facettes calculées (années, classes, statuts)');
    await db.query('UPDATE documents SET deleted_at = now() WHERE id = $1', [d2]);
    ok((await recherche.rechercher(t, archi, { texte: 'toiture' })).total === 0, 'corbeille exclue');
    await db.query('UPDATE documents SET deleted_at = NULL WHERE id = $1', [d2]);

    // --- Recherches enregistrées et alertes -------------------------------
    const privee = await recherche.creerRecherche(t, archi, { nom: 'Contrats SOBEBRA', criteres: { entreprise: 'SOBEBRA' }, alerte: true });
    await recherche.creerRecherche(t, archi, { nom: 'Toutes les factures', criteres: { texte: 'facture' }, partagee: true });
    const vuesAgent = await recherche.listerRecherches(t, agent);
    ok(vuesAgent.length === 1 && vuesAgent[0].nom === 'Toutes les factures', 'recherche partagée visible des autres, la privée non');
    ok((await attendreErreur(() => recherche.modifierRecherche(t, agent, vuesAgent[0].id, { nom: 'piraté' })))?.status >= 403, 'recherche partagée : non modifiable par un autre');
    let bilan = await recherche.verifierAlertes({ tenantId: t, forcer: true });
    ok(bilan.documents === 0, 'alerte activée : l\'existant n\'est pas notifié');
    const d4 = await doc({ entreprise: 'SOBEBRA', texte: 'Avenant n° 2' });
    bilan = await recherche.verifierAlertes({ tenantId: t, forcer: true });
    const notifAlerte = (await db.query("SELECT message FROM notifications WHERE id_user = $1 AND tenant_id = $2", [archi.id, t])).rows;
    ok(bilan.documents === 1 && notifAlerte.length >= 1, 'nouveau document correspondant : notifié');
    bilan = await recherche.verifierAlertes({ tenantId: t, forcer: true });
    ok(bilan.documents === 0, 'déjà signalé : pas deux fois');
    void privee; void d4;

    // --- Échéancier ---------------------------------------------------------
    await echeances.deriver({ tenantId: t });
    await echeances.deriver({ tenantId: t });
    let liste = await echeances.deDocument(t, d1);
    ok(liste.length === 1 && liste[0].date_echeance === '2026-12-31' && liste[0].source === 'metadonnee', 'échéance dérivée de la propriété « Date de fin », sans doublon');
    const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await db.query("UPDATE metadata_values SET value_json = $2 WHERE document_id = $1", [d1, JSON.stringify(demain)]);
    await echeances.deriver({ tenantId: t, documentId: d1 });
    liste = await echeances.deDocument(t, d1);
    ok(liste.length === 1 && liste[0].date_echeance === demain, 'date changée : l\'échéance suit (mise à jour, pas de doublon)');
    const manuelle = await echeances.creer(t, d1, archi, { libelle: 'Renouvellement du contrat', date_echeance: demain, rappel_jours_avant: 5 });
    const r1 = await echeances.envoyerRappels({ tenantId: t });
    const r2 = await echeances.envoyerRappels({ tenantId: t });
    ok(r1 >= 2 && r2 === 0, 'rappel J-n envoyé une fois, pas deux');
    ok((await echeances.lister(t, agent)).length === 2 && (await echeances.lister(t, agent)).every((e) => e.document_id === d1), 'échéancier borné au périmètre');
    const traitee = await echeances.traiter(t, manuelle.id, archi, { commentaire: 'Renouvelé pour 2 ans' });
    ok(traitee.statut === 'traitee' && traitee.traitee_par, 'échéance traitée, auteur noté');
    ok((await attendreErreur(() => echeances.creer(t, d1, archi, { libelle: '', date_echeance: demain })))?.status === 400, 'échéance sans libellé : refusée');

    // --- Paquet d'archive ---------------------------------------------------
    const prepare = await paquets.preparer(t, archi, [d1, d2]);
    const octets = [];
    const bilanPaquet = await paquets.exporter(t, archi, prepare, (b) => { octets.push(b); });
    const zipPaquet = path.join(process.env.UPLOADS_DIR, 'paquet.zip');
    fs.writeFileSync(zipPaquet, Buffer.concat(octets));
    const p = lireZip(zipPaquet);
    const manifeste = JSON.parse(p.contenus['manifeste.json']);
    ok(p.test === null && p.noms.includes('index.html') && p.noms.includes('empreintes.sha256') && manifeste.documents.length === 2, 'paquet : ZIP valide, manifeste, index, empreintes');
    const fic = manifeste.documents.flatMap((x) => x.fichiers);
    ok(fic.every((f) => f.conforme === true) && fic.some((f) => f.empreinte_exportee === sha(Buffer.from('Contrat SOBEBRA — maintenance des groupes'))), 'empreintes exportées conformes aux octets et à l\'archivage');
    ok(bilanPaquet.empreinte === sha(Buffer.concat(octets)) && (await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'PAQUET_EXPORTE'", [t])).rows[0].n === 2,
      'export journalisé avec l\'empreinte du ZIP');
    ok((await attendreErreur(() => paquets.preparer(t, agent, [d3])))?.status === 403, 'paquet hors périmètre : refusé');
    ok((await attendreErreur(() => paquets.preparer(t2, autre, [d1])))?.status === 404, 'autre organisation : document introuvable');

    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL docuflow.audit_override = 'on'");
      await c.query("SET LOCAL docuflow.gel_override = 'on'");
      await c.query('DELETE FROM tenants WHERE id = ANY($1)', [[t, t2]]);
      await c.query('COMMIT');
    } catch (err) { await c.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { c.release(); }
    await db.pool.end();
  }
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Recherche cohérente — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
