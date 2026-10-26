// ============================================================================
// classes.test.js — classes de documents (modèle M-Files) : charte de
// nommage, reconnaissance, modèles DocuFlow, plan de classement, rangement.
// 1. SANS BASE : charte et reconnaissance de la classe.
// 2. AVEC BASE (DB_HOST ou DATABASE_URL) : installation, application à un
//    document (titre, compteur, rangement par année), garde de suppression,
//    isolement entre organisations.
// Exécution : npm run test:classes
// ============================================================================
const { rendreNom, cle } = require('./services/classeService');
const { proposer } = require('./services/indexSuggestionService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };

(async () => {
  console.log('\n1. Charte de nommage et reconnaissance (sans base)');
  ok(cle('N° de facture') === 'n de facture' && cle('Année') === 'annee', 'libellés comparés sans accents ni casse, « N° » compris');
  ok(rendreNom('FACF-{année}-{N° de facture} — {Fournisseur}', { annee: 2026, proprietes: { 'n de facture': 'F-118', fournisseur: 'SBEE' } })
    === 'FACF-2026-F-118 — SBEE', 'jetons de propriétés et année');
  ok(rendreNom('FACF-{année}-{N° de facture} — {Fournisseur}', { annee: 2026, proprietes: { fournisseur: 'SBEE' } })
    === 'FACF-2026 — SBEE', 'jeton vide : son séparateur disparaît');
  ok(rendreNom('CA-{année}-{compteur} — {Expéditeur}', { annee: 2026, compteur: 7 }) === 'CA-2026-0007', 'compteur sur 4 chiffres');
  ok(rendreNom('{code}_{compteur:3}', { code: 'PV', compteur: 12 }) === 'PV_012', 'largeur du compteur réglable');
  ok(rendreNom('DAT — {N° de dossier} — {Demandeur}', { fiche: { num_dossier: '2024/118' }, proprietes: { demandeur: 'SOTRA' } })
    === 'DAT — 2024/118 — SOTRA', 'repli sur la fiche (n° de dossier)');
  ok(rendreNom('{Inconnu}', {}) === '', 'jeton inconnu : rien d\'inventé');

  const classes = [{ id: 1, nom: 'Facture fournisseur', mots_cles: 'facture, invoice' }, { id: 2, nom: 'Facture client', mots_cles: 'facture client' },
    { id: 3, nom: 'Prorogation', mots_cles: 'prorogation, prolongation' }];
  const val = (p) => p.find((x) => x.champ === 'classe_id');
  ok(val(proposer('FACTURE N° F-2026-118\nFournisseur : SBEE', { classes }))?.valeur === 1, 'facture reconnue par ses mots de reconnaissance');
  ok(val(proposer('Facture client n° 45 — SOTRA', { classes }))?.valeur === 2, 'à égalité de position, la forme la plus longue l\'emporte');
  ok(val(proposer('Objet : demande de prolongation du délai', { classes }))?.affichage === 'Prorogation', 'synonyme reconnu, libellé affiché');
  ok(val(proposer('', { classes, nomFichier: 'prorogation_2024_118.pdf' }))?.confiance === 'moyenne', 'sans texte : classe tirée du nom du fichier');
  ok(!val(proposer('Rapport annuel d\'activité', { classes })), 'aucune classe ne correspond : rien proposé');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const classeService = require('./services/classeService');
    const metadataService = require('./services/metadataService');
    const s = Date.now();
    const nouveauTenant = async (n) => (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test classes ${n} ${s}`, `test-cls-${n}-${s}`])).rows[0].id;
    const t = await nouveauTenant('a');
    const t2 = await nouveauTenant('b');

    const plan = await classeService.installerPlan(t, 'entreprise', null);
    ok(plan.crees === 25, `plan « Entreprise » : 25 dossiers créés (${plan.crees})`);
    ok((await classeService.installerPlan(t, 'entreprise', null)).crees === 0, 'réinstaller le plan ne crée rien en double');
    ok((await classeService.installerPlan(t, 'inconnu', null)) === null, 'plan inconnu refusé');

    const inst = await classeService.installerClasses(t, ['FACF', 'CA']);
    ok(inst.installees.length === 2, 'deux classes installées depuis les modèles');
    ok((await classeService.installerClasses(t, ['FACF'])).ignorees[0] === 'Facture fournisseur', 'classe déjà présente : laissée telle quelle');
    const schemas = await metadataService.getSchemas(t);
    const facf = schemas.find((x) => x.name === 'Facture fournisseur');
    const dossier310 = (await db.query("SELECT id FROM document_folders WHERE tenant_id = $1 AND name = '310 Factures fournisseurs'", [t])).rows[0].id;
    ok(facf.code === 'FACF' && facf.fields.length === 8 && facf.dossier_defaut_id === dossier310 && facf.sous_dossier_annee,
      'classe installée : code, 8 propriétés, rangée dans « 310 Factures fournisseurs », par année');
    // Référentiel béninois : règle de conservation posée à l'installation.
    ok(facf.dua_annees === 10 && facf.sort_final === 'elimination' && /OHADA/.test(facf.dua_reference),
      'classe installée : DUA 10 ans, élimination, justifiée par l\'Acte uniforme OHADA');
    const ca0 = schemas.find((x) => x.code === 'CA');
    ok(ca0.dua_annees === 5 && ca0.sort_final === 'tri', 'courrier arrivé : 5 ans puis tri (décret 2007-532, art. 38)');
    // Appliquer le référentiel : seulement aux classes sans règle, jamais d'écrasement.
    const sansRegle = await metadataService.createSchema(t, { name: 'Acte de naissance', code: 'ECN' });
    const inconnue = await metadataService.createSchema(t, { name: 'Classe maison', code: 'MAI' });
    const admin = { id: null, tenant_id: t, username: 'test', full_name: 'Test', role: 'admin' };
    const ref = await classeService.appliquerReferentiel(t, admin);
    ok(ref.appliquees.includes('Acte de naissance') && ref.deja.includes('Facture fournisseur') && ref.inconnues.includes('Classe maison'),
      'référentiel appliqué aux seules classes sans règle et reconnues');
    const ecn = (await db.query('SELECT dua_annees, sort_final FROM metadata_schemas WHERE id = $1', [sansRegle.id])).rows[0];
    ok(ecn.dua_annees === 10 && ecn.sort_final === 'conservation', 'acte de naissance : conservation définitive (art. 44, établit un droit)');
    ok((await db.query('SELECT dua_annees FROM metadata_schemas WHERE id = $1', [inconnue.id])).rows[0].dua_annees === null, 'classe inconnue : aucune durée inventée');
    ok((await classeService.appliquerReferentiel(t, admin)).appliquees.length === 0, 'réappliquer : rien ne change');
    const journal = await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'DUA_MODIFIEE'", [t]);
    ok(journal.rows[0].n === 1, 'la règle proposée est journalisée comme une saisie');
    const commune = await classeService.installerPlan(t2, 'commune', null);
    ok(commune.crees === 28, `plan « Commune (Bénin) » : 28 dossiers créés (${commune.crees})`);
    const catal = await classeService.catalogue(t);
    ok(catal.classes.find((c) => c.code === 'ECN').conservation.communicabilite === 'etat_civil' && /Archives Nationales/.test(catal.avertissement_conservation),
      'catalogue : règle et communicabilité proposées, avec l\'avertissement de validation par la DAN');
    ok(catal.classes.find((c) => c.code === 'FACF').installee && catal.plans.find((p) => p.code === 'entreprise').installe, 'catalogue : installé signalé');

    // Document de la classe
    const doc = (await db.query(
      "INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, date_document, classe_id) VALUES ($1, $2, 'À indexer', 'À indexer', 'À indexer', 2026, 'à indexer', '2025-11-03', $3) RETURNING id",
      [t, `CLS-${s}`, facf.id])).rows[0].id;
    const champ = (label) => facf.fields.find((f) => f.label === label).id;
    await metadataService.setDocumentMetadata(t, doc, [
      { fieldId: champ('N° de facture'), value: 'F-118' }, { fieldId: champ('Fournisseur'), value: 'SBEE' }, { fieldId: champ('Statut de paiement'), value: 'payee' }]);
    const r = await classeService.appliquer(t, doc, null);
    const apres = (await db.query('SELECT description, type_document, dossier_id FROM documents WHERE id = $1', [doc])).rows[0];
    ok(apres.description === 'FACF-2025-F-118 — SBEE', `titre calculé par la charte, année tirée de la date du document (${apres.description})`);
    ok(apres.type_document === 'Facture fournisseur', 'type synchronisé avec la classe (vues et filtres existants)');
    const sousDossier = (await db.query('SELECT name, parent_id FROM document_folders WHERE id = $1', [apres.dossier_id])).rows[0];
    ok(sousDossier.name === '2025' && sousDossier.parent_id === dossier310 && r.dossier_id === apres.dossier_id, 'rangé dans « 310 Factures fournisseurs / 2025 », créé au besoin');

    await metadataService.setDocumentMetadata(t, doc, [{ fieldId: champ('Fournisseur'), value: 'SONEB' }]);
    await classeService.appliquer(t, doc, null);
    ok((await db.query('SELECT description FROM documents WHERE id = $1', [doc])).rows[0].description === 'FACF-2025-F-118 — SONEB', 'le titre suit les propriétés');

    // Compteur
    const ca = (await metadataService.getSchemas(t)).find((x) => x.name === 'Courrier arrivé');
    const docCa = async () => (await db.query(
      "INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, classe_id) VALUES ($1, $2, 'x', 'x', 'x', 2026, 'disponible', $3) RETURNING id",
      [t, `CA-${s}-${Math.random()}`, ca.id])).rows[0].id;
    const c1 = await docCa(); const c2 = await docCa();
    const n1 = (await classeService.appliquer(t, c1, null)).numero;
    const n2 = (await classeService.appliquer(t, c2, null)).numero;
    const n1bis = (await classeService.appliquer(t, c1, null)).numero;
    ok(n1 === 1 && n2 === 2 && n1bis === 1, 'compteur : 1, 2… attribué une seule fois par document');
    ok(await classeService.apercu(t, { modele: ca.modele_nom, classe_id: ca.id, fiche: { annee: 2026 } }) === 'CA-2026-0003', 'aperçu : le prochain numéro, sans le consommer');

    // Classé à la main : jamais déplacé
    const manuel = (await db.query(
      "INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, classe_id, dossier_id) VALUES ($1, $2, 'x', 'x', 'x', 2026, 'disponible', $3, $4) RETURNING id",
      [t, `MAN-${s}`, facf.id, dossier310])).rows[0].id;
    await classeService.appliquer(t, manuel, null);
    ok((await db.query('SELECT dossier_id FROM documents WHERE id = $1', [manuel])).rows[0].dossier_id === dossier310, 'document déjà classé : laissé où il est');

    // Suppression et isolement
    const refus = await metadataService.deleteSchema(t, facf.id);
    ok(refus && refus.refus, 'classe utilisée : suppression refusée');
    const defaut = await metadataService.createSchema(t, { name: 'Communes', isDefault: true });
    ok((await metadataService.deleteSchema(t, defaut.id)).refus, 'propriétés communes : non supprimables');
    const vide = await metadataService.createSchema(t, { name: 'Vide', code: 'vd' });
    ok(vide.code === 'VD' && (await metadataService.deleteSchema(t, vide.id)) === true, 'classe vide : code normalisé, supprimable');
    let codeRefuse = false;
    try { await metadataService.createSchema(t, { name: 'Mauvais', code: 'trop long code !' }); } catch { codeRefuse = true; }
    ok(codeRefuse, 'code invalide refusé');
    ok((await classeService.classe(t2, facf.id)) === null, 'autre organisation : classe introuvable');
    let horsTenant = false;
    try { await metadataService.createSchema(t2, { name: 'X', dossier_defaut_id: dossier310 }); } catch { horsTenant = true; }
    ok(horsTenant, 'rangement vers un dossier d\'une autre organisation refusé');
    ok((await classeService.appliquer(t2, doc, null)) === null, 'appliquer sur le document d\'une autre organisation : sans effet');

    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Classes de documents cohérentes — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})();
