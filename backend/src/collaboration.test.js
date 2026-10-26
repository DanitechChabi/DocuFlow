// ============================================================================
// collaboration.test.js — collaboration documentaire (migration 033).
// 1. SANS BASE : mentions, jetons de partage, état d'un lien.
// 2. AVEC BASE (DB_HOST ou DATABASE_URL) : favoris, suivi et notifications
//    (auteur exclu, désabonnement mémorisé), commentaires et mentions,
//    périmètre des dossiers, liens publics (jeton haché, expiration,
//    révocation, mot de passe, quota, corbeille), restauration de version,
//    isolement entre organisations.
// Exécution : npm run test:collaboration
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-collab-'));
const { FILES_DIR } = require('./config/paths');
const collaboration = require('./services/collaborationService');
const partage = require('./services/partageService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const lire = (flux) => new Promise((resolve, reject) => {
  const morceaux = [];
  flux.on('data', (m) => morceaux.push(m)); flux.on('error', reject); flux.on('end', () => resolve(Buffer.concat(morceaux)));
});
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

(async () => {
  console.log('\n1. Sans base');
  const m = collaboration.extraireMentions('Merci @k.mensah. et @S.Agbo, voir aussi mail@exemple.bj');
  ok(m.includes('k.mensah') && m.includes('s.agbo') && !m.some((x) => x.includes('exemple')), 'mentions : point final retiré, adresse e-mail ignorée');
  const jeton = partage.nouveauJeton();
  ok(partage.JETON_RE.test(jeton) && partage.empreinteJeton(jeton) !== jeton && /^[0-9a-f]{64}$/.test(partage.empreinteJeton(jeton)), 'jeton aléatoire, seule son empreinte SHA-256 est stockée');
  const futur = new Date(Date.now() + 86400000);
  ok(partage.etat({ expire_at: futur, nb_telechargements: 0 }) === 'actif'
    && partage.etat({ expire_at: new Date(Date.now() - 1000) }) === 'expire'
    && partage.etat({ expire_at: futur, revoque_at: new Date() }) === 'revoque'
    && partage.etat({ expire_at: futur, max_telechargements: 2, nb_telechargements: 2 }) === 'epuise', 'état d\'un lien : actif, expiré, révoqué, épuisé');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const aclService = require('./services/aclService');
    const roleService = require('./services/roleService');
    const versionService = require('./services/versionService');
    const { addFileToDocument } = require('./services/documentIndexService');
    const s = Date.now();
    const tenant = async (nom) => (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`${nom} ${s}`, `${nom.toLowerCase()}-${s}`])).rows[0].id;
    const t = await tenant('Collab');
    const t2 = await tenant('Ailleurs');
    await roleService.provisionRoles(t);
    await roleService.provisionRoles(t2);
    const utilisateur = async (tid, role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username",
      [tid, `${nom.toLowerCase()}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const archi = await utilisateur(t, 'archiviste', 'Archi');
    const agent = await utilisateur(t, 'agent', 'Agent');
    const lecteur = await utilisateur(t, 'lecteur', 'Lecteur');
    const autre = await utilisateur(t2, 'archiviste', 'Autre');
    const nouveauDocument = async (tid, auteur, dossier = null) => (await db.query(
      `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by, dossier_id)
       VALUES ($1, $2, 'D', 'A', 'SOBEBRA', 2026, 'disponible', $3, $4) RETURNING id`, [tid, `C-${s}-${Math.random()}`, auteur, dossier])).rows[0].id;
    let n = 0;
    const verser = (tid, doc, contenu, user) => {
      const nom = `c${s}-${++n}.txt`;
      fs.writeFileSync(path.join(FILES_DIR, nom), contenu);
      return addFileToDocument(tid, doc, user.id, { path: path.join(FILES_DIR, nom), filename: nom, originalname: `piece-${n}.txt`, mimetype: 'text/plain', size: Buffer.byteLength(contenu) });
    };
    const notifs = async (user) => (await db.query('SELECT title, document_id, type FROM notifications WHERE id_user = $1 ORDER BY id', [user.id])).rows;

    // --- Favoris -----------------------------------------------------------
    const d1 = await nouveauDocument(t, archi.id);
    await verser(t, d1, 'Contrat v1', archi);
    await collaboration.ajouterFavori(t, agent.id, d1);
    await collaboration.ajouterFavori(t, agent.id, d1);
    let favoris = await collaboration.listerDocumentsPersonnels(t, agent.id, 'favoris');
    ok(favoris.length === 1 && favoris[0].id === d1, 'favori ajouté (idempotent), listé dans « Mes favoris »');
    await collaboration.retirerFavori(t, agent.id, d1);
    ok((await collaboration.listerDocumentsPersonnels(t, agent.id, 'favoris')).length === 0, 'favori retiré');

    // --- Suivi et notifications -------------------------------------------
    await collaboration.suivre(t, agent.id, d1);
    await collaboration.signaler(t, d1, 'statut', { acteur: archi, de: 'disponible', vers: 'prêt' });
    ok((await notifs(agent)).some((x) => x.document_id === d1), 'abonné prévenu d\'un changement, notification liée au document');
    ok(!(await notifs(archi)).some((x) => x.type === 'suivi' && x.document_id === d1 && /statut|Statut/.test(x.title)), 'l\'auteur du geste n\'est pas prévenu de son propre geste');
    await collaboration.nePlusSuivre(t, agent.id, d1);
    const avant = (await notifs(agent)).length;
    await collaboration.signaler(t, d1, 'fiche', { acteur: archi });
    ok((await notifs(agent)).length === avant, 'désabonné : plus de notification');

    // --- Commentaires et mentions -----------------------------------------
    const doc1 = await collaboration.chargerDocument(t, d1);
    const c1 = await collaboration.creerCommentaire(t, doc1, archi, { contenu: `Merci de vérifier, @${agent.username}.` });
    ok(c1.est_auteur && c1.mentions.length === 1, 'commentaire publié, mention résolue');
    ok((await notifs(agent)).some((x) => x.document_id === d1 && x.type !== 'suivi'), 'mentionné prévenu même sans suivre le document');
    ok((await collaboration.etatSuivi(t, archi.id, d1)).suivi === true, 'qui commente suit le document');
    const rep = await collaboration.creerCommentaire(t, doc1, agent, { contenu: 'Vérifié.', parent_id: c1.id });
    ok(rep.parent_id === c1.id, 'réponse rattachée au commentaire');
    const refusModif = await attendreErreur(() => collaboration.modifierCommentaire(t, doc1, agent, c1.id, { contenu: 'piraté' }));
    ok(refusModif && refusModif.status === 403, 'modifier le commentaire d\'un autre : refusé');
    await collaboration.modifierCommentaire(t, doc1, archi, c1.id, { contenu: 'Merci de vérifier (corrigé).' });
    await collaboration.supprimerCommentaire(t, doc1, agent, rep.id);
    const fil = (await collaboration.listerCommentaires(t, d1, archi)).commentaires;
    const racine = fil.find((c) => c.id === c1.id);
    const reponse = racine.reponses.find((c) => c.id === rep.id);
    ok(racine.modifie_at && reponse.supprime && reponse.contenu === null,
      'modification datée ; suppression : trace « supprimé », contenu effacé');
    ok((await attendreErreur(() => collaboration.creerCommentaire(t, doc1, archi, { contenu: '   ' }))).status === 400, 'commentaire vide refusé');

    // --- Périmètre --------------------------------------------------------
    const dossier = (await db.query("INSERT INTO document_folders (tenant_id, name) VALUES ($1, 'RH') RETURNING id", [t])).rows[0].id;
    await db.query("INSERT INTO folder_acls (tenant_id, folder_id, subject_type, subject_id, level) VALUES ($1, $2, 'user', $3, 'manage')", [t, dossier, String(archi.id)]);
    const dRh = await nouveauDocument(t, archi.id, dossier);
    aclService.invalidate();
    const docRh = await collaboration.chargerDocument(t, dRh);
    await collaboration.creerCommentaire(t, docRh, archi, { contenu: `Pour info @${agent.username}` });
    ok(!(await notifs(agent)).some((x) => x.document_id === dRh), 'mention d\'une personne hors périmètre : aucune notification (le document n\'est pas révélé)');
    ok(!(await collaboration.mentionnables(t, docRh, {})).some((u) => u.id === agent.id), 'hors périmètre : non proposé à la mention');

    // --- Liens de partage publics -----------------------------------------
    const lien = await partage.creerPartage(t, d1, archi, { duree_jours: 7 });
    const stocke = (await db.query('SELECT jeton_hash FROM document_partages WHERE id = $1', [lien.partage.id])).rows[0].jeton_hash.trim();
    ok(stocke === partage.empreinteJeton(lien.jeton) && stocke !== lien.jeton, 'lien créé : seule l\'empreinte du jeton est en base');
    let r = await partage.resoudre(lien.jeton);
    const ouvert = await partage.ouvrirFichier(r.fichier);
    ok(sha(await lire(ouvert.flux)) === sha(Buffer.from('Contrat v1')), 'accès public : les octets exacts de la version courante');
    ok((await attendreErreur(() => partage.resoudre(partage.nouveauJeton()))).status === 404, 'jeton inconnu : 404');
    ok((await attendreErreur(() => partage.creerPartage(t, d1, archi, { duree_jours: 91 }))).status === 400, 'au-delà de 90 jours : refusé');
    const borne = await partage.creerPartage(t, d1, archi, { max_telechargements: 1, mot_de_passe: 'secret123' });
    ok(await partage.reserverTelechargement(borne.partage.id) && !(await partage.reserverTelechargement(borne.partage.id)), 'quota de téléchargements respecté');
    ok((await attendreErreur(() => partage.resoudre(borne.jeton))).status === 410, 'lien épuisé : 410');
    const prot = await partage.creerPartage(t, d1, archi, { mot_de_passe: 'secret123' });
    r = await partage.resoudre(prot.jeton);
    const { preuve } = partage.emettrePreuve(r.partage);
    ok(partage.verifierPreuve(r.partage, preuve) && !partage.verifierPreuve(r.partage, 'faux'), 'mot de passe : preuve de session signée, une fausse est refusée');
    await partage.revoquerPartage(t, d1, lien.partage.id, archi, {});
    ok((await attendreErreur(() => partage.resoudre(lien.jeton))).status === 410, 'lien révoqué : 410');
    ok((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND object_id = $2 AND action IN ('PARTAGE_CREE','PARTAGE_REVOQUE')", [t, d1])).rows[0].n >= 4,
      'création et révocation journalisées (journal chaîné)');
    const fixe = await partage.creerPartage(t, d1, archi, {});
    await db.query('UPDATE documents SET deleted_at = now() WHERE id = $1', [d1]);
    ok((await attendreErreur(() => partage.resoudre(fixe.jeton))).status === 410, 'document en corbeille : le lien ne donne plus rien');
    await db.query('UPDATE documents SET deleted_at = NULL WHERE id = $1', [d1]);

    // --- Restauration de version ------------------------------------------
    await verser(t, d1, 'Contrat v2', archi);
    const v1 = (await db.query('SELECT id, empreinte_sha256 FROM document_files WHERE document_id = $1 AND version = 1', [d1])).rows[0];
    const res = await versionService.restaurerVersion(t, d1, v1.id, archi, {});
    const v3 = (await db.query('SELECT version, empreinte_sha256, stored_name FROM document_files WHERE document_id = $1 ORDER BY version DESC LIMIT 1', [d1])).rows[0];
    ok(res.version === 3 && v3.empreinte_sha256.trim() === v1.empreinte_sha256.trim()
      && fs.readFileSync(path.join(FILES_DIR, v3.stored_name), 'utf8') === 'Contrat v1', 'version 1 restaurée en version 3 : même contenu, même empreinte');
    const courante = (await db.query('SELECT id FROM document_files WHERE document_id = $1 AND version = 3', [d1])).rows[0].id;
    ok((await attendreErreur(() => versionService.restaurerVersion(t, d1, courante, archi, {}))).status === 409,
      'restaurer la version courante : refusé');

    // --- Isolement ---------------------------------------------------------
    ok((await collaboration.listerCommentaires(t2, d1, autre)).commentaires.length === 0 && (await collaboration.listerDocumentsPersonnels(t2, autre.id, 'suivis')).length === 0,
      'autre organisation : rien de visible');

    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL docuflow.audit_override = 'on'");
      await c.query("SET LOCAL docuflow.gel_override = 'on'");
      await c.query('DELETE FROM tenants WHERE id = ANY($1)', [[t, t2]]);
      await c.query('COMMIT');
    } catch (err) { await c.query('ROLLBACK'); console.error(err.message); } finally { c.release(); }
    void lecteur;
    await db.pool.end();
  }
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Collaboration cohérente — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
