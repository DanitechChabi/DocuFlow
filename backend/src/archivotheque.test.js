// ============================================================================
// archivotheque.test.js — archivothèque virtuelle (migration 045).
// Trois conditions pour publier (communicable, sans donnée personnelle,
// autorisée), fichier figé à la proposition, vitrine publique sans donnée
// interne, retrait, règle de communicabilité durcie après coup, périmètre
// de lecture, cloisonnement entre organisations.
// Exécution : npm run test:archivotheque
// ============================================================================
const archivotheque = require('./services/archivothequeService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

(async () => {
  console.log('\n1. Sans base');
  const s1 = archivotheque.lireSaisie({ sans_donnees_personnelles: true, notice: '  Une notice ', date_affichee: 'vers 1962' }, { titre: 'Titre du document' });
  ok(s1.titre === 'Titre du document' && s1.notice === 'Une notice' && s1.date_affichee === 'vers 1962' && s1.theme === null, 'saisie : le titre du document par défaut, textes rognés');
  ok((() => { try { archivotheque.lireSaisie({ titre: 'T' }); return false; } catch (e) { return e.status === 400 && e.code === 'DONNEES_PERSONNELLES'; } })()
    && (() => { try { archivotheque.lireSaisie({ sans_donnees_personnelles: true }); return false; } catch (e) { return e.status === 400; } })(),
    'sans déclaration sur les données personnelles, ou sans titre : refusé');
  ok(archivotheque.TYPES_PUBLIES.has('application/pdf') && archivotheque.TYPES_PUBLIES.has('image/jpeg') && !archivotheque.TYPES_PUBLIES.has('application/msword'), 'se publient : les PDF et les images');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const roleService = require('./services/roleService');
    const aclService = require('./services/aclService');
    const settingsService = require('./services/settingsService');
    const s = Date.now();
    const slug = `vitrine-${s}`;
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Vitrine ${s}`, slug])).rows[0].id;
    const t2 = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Ailleurs ${s}`, `vitrine-ailleurs-${s}`])).rows[0].id;
    await roleService.provisionRoles(t);
    await roleService.provisionRoles(t2);
    const utilisateur = async (tenant, role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username, full_name",
      [tenant, `${nom.toLowerCase()}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const archi = await utilisateur(t, 'archiviste', 'Archi');
    const chef = await utilisateur(t, 'responsable', 'Chef');
    const autre = await utilisateur(t2, 'admin', 'Autre');
    const classe = async (nom, communicabilite) => (await db.query(
      'INSERT INTO metadata_schemas (tenant_id, name, communicabilite) VALUES ($1, $2, $3) RETURNING id', [t, nom, communicabilite])).rows[0].id;
    const libre = await classe('Photographie', 'libre');
    const etatCivil = await classe('Acte de naissance', 'etat_civil');
    const dossier = (await db.query("INSERT INTO document_folders (tenant_id, name) VALUES ($1, 'Réservé') RETURNING id", [t])).rows[0].id;
    const doc = async (titre, plus = {}) => (await db.query(
      `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by, description, classe_id, date_document, dossier_id)
       VALUES ($1, $2, 'D', 'A', 'X', 1962, 'archivé', $3, $4, $5, $6, $7) RETURNING id`,
      [t, `V-${s}-${Math.random()}`, archi.id, titre, plus.classe || libre, plus.date || '1962-08-01', plus.dossier || null])).rows[0].id;
    const fichier = async (documentId, nom, mime, version = 1) => (await db.query(
      `INSERT INTO document_files (document_id, version, original_name, stored_name, mime_type, file_size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, 1234, $6) RETURNING id`, [documentId, version, nom, `${s}-${Math.random()}-${nom}`, mime, archi.id])).rows[0].id;
    const photo = await doc('Inauguration du marché central');
    const fPhoto = await fichier(photo, 'inauguration.jpg', 'image/jpeg');
    const plan = await doc('Plan du premier lotissement');
    await fichier(plan, 'plan.pdf', 'application/pdf');
    const sansFichier = await doc('Registre non numérisé');
    const word = await doc('Compte rendu');
    await fichier(word, 'cr.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const naissance = await doc('Acte de naissance n° 12', { classe: etatCivil, date: '2020-03-04' });
    await fichier(naissance, 'acte.pdf', 'application/pdf');
    const reserve = await doc('Pièce d\'un dossier réservé', { dossier });
    await fichier(reserve, 'reserve.pdf', 'application/pdf');
    const saisie = { sans_donnees_personnelles: true, notice: 'Photographie prise le jour de l\'ouverture.', date_affichee: '1er août 1962', theme: 'Histoire de la commune' };

    // --- Proposer : les conditions ------------------------------------------------
    ok((await attendreErreur(() => archivotheque.proposer(t, photo, { ...saisie, sans_donnees_personnelles: false }, archi)))?.code === 'DONNEES_PERSONNELLES', 'sans déclaration sur les données personnelles : refusé');
    ok((await attendreErreur(() => archivotheque.proposer(t, sansFichier, saisie, archi)))?.status === 400
      && (await attendreErreur(() => archivotheque.proposer(t, word, saisie, archi)))?.code === 'TYPE_NON_PUBLIABLE', 'document sans fichier, ou fichier qui ne se lit pas dans un navigateur : refusé');
    const refus = await attendreErreur(() => archivotheque.proposer(t, naissance, saisie, archi));
    ok(refus?.status === 403 && refus.code === 'NON_COMMUNICABLE' && /04\/03\/2120/.test(refus.message), `acte d'état civil de 2020 : pas communicable avant 100 ans (${refus?.message})`);
    ok((await attendreErreur(() => archivotheque.proposer(t2, photo, saisie, autre)))?.status === 404, 'document d\'une autre organisation : introuvable');
    const p1 = await archivotheque.proposer(t, photo, saisie, archi);
    ok(p1.statut === 'proposee' && p1.titre === 'Inauguration du marché central' && p1.fichier.id === fPhoto && p1.propose_par === 'Archi' && p1.autorise_par === null, 'proposition enregistrée, avec le fichier du jour');
    const nChef = (await db.query("SELECT title, message, lien FROM notifications WHERE id_user = $1 AND type = 'archives'", [chef.id])).rows;
    ok(nChef.length === 1 && /attend votre autorisation/.test(nChef[0].title) && nChef[0].lien === '/documents/archivotheque', 'qui peut autoriser est prévenu');

    // --- Vitrine : fermée, puis ouverte ---------------------------------------------
    ok((await archivotheque.vitrine(slug)) === null && (await archivotheque.fichierPublic(slug, p1.id)) === null, 'archivothèque non activée : la page publique ne répond pas');
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'archivotheque_active', 'true'), ($1, 'archivotheque_presentation', 'Les archives de la commune.')", [t]);
    settingsService.invalidate(t);
    let v = await archivotheque.vitrine(slug);
    ok(v && v.nom === `Vitrine ${s}` && v.presentation === 'Les archives de la commune.' && v.pieces.length === 0 && (await archivotheque.fichierPublic(slug, p1.id)) === null, 'pièce seulement proposée : pas encore en ligne');

    // --- Autoriser -------------------------------------------------------------------
    ok((await attendreErreur(() => archivotheque.autoriser(t2, p1.id, autre)))?.status === 404, 'pièce d\'une autre organisation : introuvable');
    const pub = await archivotheque.autoriser(t, p1.id, chef);
    ok(pub.statut === 'publiee' && pub.autorise_par === 'Chef' && pub.autorise_at, 'publication autorisée par une personne habilitée');
    ok((await attendreErreur(() => archivotheque.autoriser(t, p1.id, chef)))?.status === 409 && (await attendreErreur(() => archivotheque.proposer(t, photo, saisie, archi)))?.code === 'DEJA_PUBLIEE', 'déjà publiée : ni seconde autorisation, ni modification sans retrait');
    ok((await db.query("SELECT 1 FROM notifications WHERE id_user = $1 AND title = 'Archivothèque : pièce publiée'", [archi.id])).rows.length === 1, 'l\'auteur de la proposition apprend la publication');
    v = await archivotheque.vitrine(slug);
    const piece = v.pieces[0];
    ok(v.pieces.length === 1 && piece.titre === 'Inauguration du marché central' && piece.type === 'image' && piece.theme === 'Histoire de la commune' && v.themes.join() === 'Histoire de la commune', 'pièce en ligne, avec son thème');
    ok(Object.keys(piece).sort().join() === 'date_affichee,id,notice,publiee_le,theme,titre,type', `la vitrine ne livre rien d'interne : ni référence, ni nom d'agent, ni identifiant de document (${Object.keys(piece).join()})`);
    const f = await archivotheque.fichierPublic(slug, p1.id);
    ok(f && f.fichier.id === fPhoto && f.titre === piece.titre && (await archivotheque.fichierPublic(`vitrine-ailleurs-${s}`, p1.id)) === null, 'fichier servi pour la pièce publiée, pas par la vitrine d\'une autre organisation');
    await archivotheque.fichierPublic(slug, p1.id, { compter: true });
    ok((await archivotheque.pourDocument(t, photo)).vues === 1, 'consultations comptées à l\'ouverture d\'une pièce, pas au chargement des vignettes');
    // Une version déposée après coup ne part pas en ligne d'elle-même.
    await fichier(photo, 'inauguration-non-floutee.jpg', 'image/jpeg', 2);
    ok((await archivotheque.fichierPublic(slug, p1.id)).fichier.id === fPhoto, 'fichier figé à la proposition : la nouvelle version reste interne');

    // --- Retrait, nouvelle proposition -------------------------------------------------
    const ret = await archivotheque.retirer(t, p1.id, { motif: 'Un visage reconnaissable' }, archi);
    ok(ret.statut === 'retiree' && ret.retire_motif === 'Un visage reconnaissable' && (await archivotheque.vitrine(slug)).pieces.length === 0 && (await archivotheque.fichierPublic(slug, p1.id)) === null, 'pièce retirée : hors ligne aussitôt');
    ok((await attendreErreur(() => archivotheque.autoriser(t, p1.id, chef)))?.status === 409, 'une pièce retirée ne se republie pas sans nouvelle proposition');
    const p1b = await archivotheque.proposer(t, photo, { ...saisie, titre: 'Inauguration du marché (floutée)' }, archi);
    ok(p1b.id === p1.id && p1b.statut === 'proposee' && p1b.autorise_par === null && p1b.fichier.version === 2 && p1b.titre === 'Inauguration du marché (floutée)', 'nouvelle proposition : autorisation remise à zéro, dernière version du fichier');
    await archivotheque.autoriser(t, p1.id, chef);

    // --- La règle se durcit, le document disparaît --------------------------------------
    const p2 = await archivotheque.proposer(t, plan, { sans_donnees_personnelles: true }, archi);
    await archivotheque.autoriser(t, p2.id, chef);
    ok((await archivotheque.vitrine(slug)).pieces.length === 2 && (await archivotheque.vitrine(slug)).pieces.some((x) => x.type === 'pdf'), 'deux pièces en ligne, dont un PDF');
    await db.query("UPDATE metadata_schemas SET communicabilite = 'surete' WHERE id = $1", [libre]);
    await db.query("UPDATE documents SET date_document = '2010-01-01' WHERE id = $1", [plan]);
    v = await archivotheque.vitrine(slug);
    ok(v.pieces.length === 1 && v.pieces[0].id === p1.id && (await archivotheque.fichierPublic(slug, p2.id)) === null, 'règle de communicabilité durcie après publication : la pièce n\'est plus servie');
    await db.query("UPDATE metadata_schemas SET communicabilite = 'libre' WHERE id = $1", [libre]);
    await db.query('UPDATE documents SET deleted_at = now() WHERE id = $1', [photo]);
    ok((await archivotheque.vitrine(slug)).pieces.map((x) => x.id).join() === String(p2.id), 'document mis à la corbeille : sa pièce sort de la vitrine');

    // --- Périmètre de lecture ---------------------------------------------------------------
    const p3 = await archivotheque.proposer(t, reserve, { sans_donnees_personnelles: true }, archi);
    await aclService.setAcl(t, dossier, { subject_type: 'user', subject_id: archi.id, level: 'manage' }, archi.id);
    aclService.invalidate();
    const vuChef = await archivotheque.lister(t, chef);
    const vuArchi = await archivotheque.lister(t, archi);
    ok(!vuChef.pieces.some((x) => x.id === p3.id) && vuArchi.pieces.some((x) => x.id === p3.id) && (await attendreErreur(() => archivotheque.autoriser(t, p3.id, chef)))?.code === 'HORS_PERIMETRE',
      'pièce d\'un dossier restreint : invisible et non autorisable pour qui n\'y a pas accès');
    ok(vuArchi.active === true && vuArchi.slug === slug && vuArchi.droits.proposer === true && vuArchi.droits.autoriser === false && vuChef.droits.autoriser === true && vuChef.droits.proposer === false,
      'droits : l\'archiviste propose, le responsable autorise');
    ok((await archivotheque.lister(t2, autre)).pieces.length === 0 && (await archivotheque.vitrine(`vitrine-ailleurs-${s}`)) === null, 'autre organisation : aucune pièce, pas de vitrine');
    const journal = (await db.query("SELECT action FROM audit_logs WHERE tenant_id = $1 AND action LIKE 'ARCHIVOTHEQUE_%' ORDER BY id", [t])).rows.map((r) => r.action.replace('ARCHIVOTHEQUE_', ''));
    ok(journal.join() === 'PROPOSEE,PUBLIEE,RETIREE,PROPOSEE,PUBLIEE,PROPOSEE,PUBLIEE,PROPOSEE', `chaque geste est au journal d'audit (${journal.join()})`);

    const cx = await db.pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query("SET LOCAL docuflow.audit_override = 'on'");
      await cx.query('DELETE FROM tenants WHERE id = ANY($1)', [[t, t2]]);
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { cx.release(); }
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Archivothèque cohérente — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
