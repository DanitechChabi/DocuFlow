// ============================================================================
// ged.test.js — recherche automatique dans la GED (migration 027).
//
// 1. SANS BASE : lecture des critères (replis « À indexer » ignorés).
// 2. AVEC BASE (DB_HOST ou DATABASE_URL) : contenu indexé à l'ajout d'un
//    fichier, scores, documents supprimés et autres organisations exclus,
//    dossier restreint invisible (archiviste comme demandeur), transmission
//    d'un document à une demande et ses refus. Organisation jetable à chaque
//    exécution — base de TEST uniquement.
// Exécution : npm run test:ged
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const ged = require('./services/gedMatchService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const rejette = async (p, statut, nom) => {
  try { await p; ok(false, `${nom} (aucune erreur)`); } catch (e) { ok(e.statut === statut, `${nom}${e.statut === statut ? '' : ` (obtenu ${e.statut || e.message})`}`); }
};

(async () => {
  console.log('\n1. Critères (sans base)');
  const c = ged.criteres({ num_dossier: 'À indexer', nom_entreprise: ' SOTRA ', description: 'Le bail', annee: '2022' });
  ok(c.dossier === '' && c.nom === 'SOTRA' && c.annee === 2022, 'replis « À indexer » ignorés, texte nettoyé, année lue');
  ok(c.libre === 'Le bail SOTRA', 'texte libre = description + nom');
  ok(!ged.chercheable(ged.criteres({ description: 'bail' })), 'saisie trop courte : pas de recherche');
  ok(ged.chercheable(ged.criteres({ num_acte: 'A-1' })), 'une référence suffit');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const { addFileToDocument } = require('./services/documentIndexService');
    const livraison = require('./services/gedDeliveryService');
    const aclService = require('./services/aclService');
    const { FILES_DIR } = require('./config/paths');
    const s = Date.now();
    const tenant = async (n) => (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test GED ${n} ${s}`, `test-ged-${n}-${s}`])).rows[0].id;
    const t = await tenant('a');
    const autreT = await tenant('b');
    const user = async (tid, role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, full_name",
      [tid, `${role}-${tid}-${s}`, nom, `${role}-${tid}-${s}@exemple.test`, role])).rows[0];
    const archiviste = await user(t, 'archiviste', 'Arnaud');
    const agent = await user(t, 'agent', 'Awa');
    const demandeur = await user(t, 'demandeur', 'Didier');
    const doc = async (tid, champs, contenu, dossierId = null) => {
      const d = (await db.query(
        `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, type_document, description, statut, dossier_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'disponible', $9) RETURNING id`,
        [tid, `T-${s}-${Math.random()}`, ...champs, dossierId])).rows[0].id;
      if (contenu) {
        const tmp = path.join(FILES_DIR, `test-ged-${s}-${d}.txt`);
        fs.writeFileSync(tmp, contenu);
        await addFileToDocument(tid, d, archiviste.id, { path: tmp, filename: path.basename(tmp), originalname: 'piece.txt', mimetype: 'text/plain', size: contenu.length });
      }
      return d;
    };
    const X = 'À indexer';
    const bail = await doc(t, [X, X, X, 2022, null, null], 'Contrat de bail commercial du local situé à Cotonou, quartier Ganhi. Signé le 12 mars 2022.');
    const sotra = await doc(t, ['RCCM/BJ/2020/0451', 'A-2020-77', 'SOTRA SA', 2020, 'Statuts', null], 'Statuts constitutifs de la société');
    const supprime = await doc(t, ['D-SUPPR', 'A-SUPPR', 'Effacée SARL', 2020, null, null], 'Contrat de bail commercial du local situé à Cotonou');
    await db.query('UPDATE documents SET deleted_at = now() WHERE id = $1', [supprime]);
    await doc(autreT, ['RCCM/BJ/2020/0451', 'A-2020-77', 'SOTRA SA', 2020, null, null], 'Contrat de bail commercial du local situé à Cotonou');

    // Dossier restreint : une ACL pour le seul rôle admin.
    const dossier = (await db.query("INSERT INTO document_folders (tenant_id, name) VALUES ($1, 'Direction') RETURNING id", [t])).rows[0].id;
    await db.query("INSERT INTO folder_acls (tenant_id, folder_id, subject_type, subject_id, level) VALUES ($1, $2, 'role', 'admin', 'read')", [t, dossier]);
    aclService.invalidate?.();
    const secret = await doc(t, ['DIR-2024-01', 'A-DIR-1', 'Direction générale', 2024, null, null], 'Procès-verbal confidentiel du comité de direction sur la restructuration', dossier);

    const contenu = (await db.query('SELECT contenu_texte FROM documents WHERE id = $1', [bail])).rows[0].contenu_texte;
    ok(/bail commercial/.test(contenu || ''), 'contenu extrait et conservé à l\'ajout du fichier');

    let r = await ged.chercher(t, { description: 'Le contrat de bail du local de Cotonou signé en 2022' });
    ok(r[0]?.document_id === bail && r[0].score >= ged.SEUIL_PROBABLE, `description libre → le bail, probable (${r[0]?.score})`);
    ok(!r.some((x) => x.document_id === supprime), 'document à la corbeille : exclu');
    r = await ged.chercher(t, { num_dossier: 'rccm/bj/2020/0451', num_acte: 'A-2020-77' });
    ok(r[0]?.document_id === sotra && r[0].score === 100, 'références exactes (casse ignorée) : 100');
    ok(r.length === 1, 'autre organisation : jamais proposée');
    r = await ged.chercher(t, { nom_entreprise: 'Sotra S.A.' });
    ok(r[0]?.document_id === sotra, 'faute de frappe sur le nom : retrouvé');
    r = await ged.chercher(t, { description: 'attestation de congé maternité de Mme Dossou' });
    ok(r.length === 0, 'sans rapport : rien');

    const pv = { description: 'procès-verbal du comité de direction sur la restructuration' };
    ok((await ged.chercher(t, pv))[0]?.document_id === secret, 'sans filtre, le document restreint existe bien');
    ok(!(await ged.candidatsPour(t, archiviste, pv)).some((x) => x.document_id === secret), 'archiviste hors ACL : document restreint invisible');
    ok((await ged.indicateurPour(t, demandeur, pv)).probable === false, 'demandeur : aucun indice sur un dossier restreint');
    ok((await ged.indicateurPour(t, demandeur, { description: 'Le contrat de bail du local de Cotonou signé en 2022' })).probable === true,
      'demandeur : « probablement disponible » pour un document ouvert');

    // Score enregistré sur la demande, puis transmission.
    const demande = async (statut = 'en attente') => (await db.query(
      "INSERT INTO requests (tenant_id, id_user, description, motif, statut) VALUES ($1, $2, 'Le contrat de bail du local de Cotonou signé en 2022', 'Consultation', $3) RETURNING *",
      [t, demandeur.id, statut])).rows[0];
    const d1 = await demande();
    ok((await ged.noterDemande(t, d1)) >= ged.SEUIL_PROBABLE, 'score de la demande calculé');
    ok((await db.query('SELECT ged_score FROM requests WHERE id = $1', [d1.id])).rows[0].ged_score >= ged.SEUIL_PROBABLE, 'score enregistré (badge des listes)');

    await rejette(livraison.transmettre(t, d1.id, archiviste, secret), 403, 'transmettre un document d\'un dossier fermé : 403');
    await rejette(livraison.transmettre(t, d1.id, archiviste, supprime), 404, 'transmettre un document à la corbeille : 404');
    const vide = await doc(t, ['V', 'V', 'Vide', 2020, null, null], null);
    await rejette(livraison.transmettre(t, d1.id, archiviste, vide), 409, 'document sans fichier : 409');
    await livraison.transmettre(t, d1.id, agent, bail);
    const apres = (await db.query('SELECT statut, document_id FROM requests WHERE id = $1', [d1.id])).rows[0];
    ok(apres.statut === 'livré' && apres.document_id === bail, 'transmis : la demande est livrée, le document en est le livrable');
    const pj = (await db.query('SELECT source_document_file_id, original_name FROM request_files WHERE request_id = $1', [d1.id])).rows;
    ok(pj.length === 1 && pj[0].source_document_file_id, 'une copie est jointe à la demande (le demandeur la télécharge)');
    ok((await db.query("SELECT 1 FROM audit_logs WHERE request_id = $1 AND action LIKE 'A transmis le document%'", [d1.id])).rows.length === 1, 'geste inscrit au journal d\'audit');
    ok((await db.query("SELECT 1 FROM notifications WHERE request_id = $1 AND id_user = $2", [d1.id, demandeur.id])).rows.length >= 1, 'le demandeur est prévenu');
    await rejette(livraison.transmettre(t, d1.id, archiviste, bail), 409, 'demande déjà livrée : 409');
    await rejette(livraison.transmettre(autreT, d1.id, archiviste, bail), 404, 'depuis une autre organisation : 404');

    // Rattrapage : un fichier versé « avant 027 » (jamais extrait) est indexé
    // en arrière-plan, depuis le disque local.
    const ancien = await doc(t, ['ANC-1', 'ANC-1', 'Ancienne SARL', 2015, null, null], 'Registre des délibérations du conseil communal de Ouidah, séance budgétaire');
    await db.query('UPDATE document_files SET texte_extrait = NULL, texte_extrait_at = NULL WHERE document_id = $1', [ancien]);
    await db.query('UPDATE documents SET contenu_texte = NULL WHERE id = $1', [ancien]);
    ok((await ged.chercher(t, { description: 'délibérations du conseil communal de Ouidah' })).every((x) => x.document_id !== ancien), 'avant rattrapage : contenu introuvable');
    const { rattraperContenu } = require('./services/contentIndexService');
    let tours = 0;
    while (tours < 50 && (await db.query('SELECT 1 FROM document_files WHERE document_id = $1 AND texte_extrait_at IS NULL', [ancien])).rows.length) {
      await rattraperContenu({ lot: 50 }); tours += 1;
    }
    ok((await ged.chercher(t, { description: 'délibérations du conseil communal de Ouidah' }))[0]?.document_id === ancien, 'après rattrapage : retrouvé par son contenu');

    fs.readdirSync(FILES_DIR).filter((f) => f.startsWith(`test-ged-${s}`)).forEach((f) => fs.rmSync(path.join(FILES_DIR, f), { force: true }));
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Recherche automatique cohérente — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})();
