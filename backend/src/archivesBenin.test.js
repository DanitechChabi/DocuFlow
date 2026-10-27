// ============================================================================
// archivesBenin.test.js — conformité au décret n° 2007-532 (migration 036).
// 1. SANS BASE : délais de communicabilité (art. 32-33), éligibilité au
//    versement (art. 46), visa requis avant exécution (art. 44).
// 2. AVEC BASE : bordereau de versement (création, refus motivés,
//    transmission figée par empreinte, prise en charge, inaltérabilité),
//    communicabilité réglée par la classe, lien de partage public refusé
//    avant le délai puis accepté sur autorisation référencée, journal.
// Exécution : npm run test:archives-benin
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-benin-'));
const { FILES_DIR } = require('./config/paths');
const archivage = require('./services/archivageService');
const versements = require('./services/versementService');
const communicabilite = require('./services/communicabiliteService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

(async () => {
  console.log('\n1. Sans base');
  const c = communicabilite.calculer;
  ok(c({ categorie: 'etat_civil', date_document: '1990-04-02' }, '2026-10-27').a_partir_du === '2090-04-02'
    && !c({ categorie: 'etat_civil', date_document: '1990-04-02' }, '2026-10-27').communicable, 'état civil : communicable 100 ans après l\'acte (art. 33)');
  ok(c({ categorie: null, date_document: '2000-01-01', verse_archives_publiques: true }, '2026-10-27').a_partir_du === '2030-01-01'
    && !c({ categorie: null, date_document: '2000-01-01', verse_archives_publiques: true }, '2026-10-27').communicable,
    'versé aux archives publiques : règle générale des 30 ans (art. 32)');
  ok(c({ categorie: 'general', date_document: '2025-01-01' }, '2026-10-27').communicable, 'non versé : la règle générale ne bloque pas la communication administrative');
  ok(c({ categorie: 'libre', date_document: '2026-01-01' }, '2026-10-27').communicable, 'catégorie libre : communicable immédiatement');
  const perso = c({ categorie: 'personnel', date_document: '2020-01-01' }, '2026-10-27');
  ok(!perso.communicable && /naissance/.test(perso.raison), 'dossier de personnel sans date de naissance : jamais réputé communicable');
  ok(c({ categorie: 'personnel', naissance: '1930-05-01' }, '2026-10-27').communicable === true, 'dossier de personnel : 90 ans après la naissance');
  ok(communicabilite.ajouterAnnees('2000-02-29', 30) === '2030-02-28', '29 février reporté au 28');

  ok(versements.ageEnAnnees('2016-10-28', '2026-10-27') === 9 && versements.ageEnAnnees('2016-10-27', '2026-10-27') === 10, 'âge en années révolues');
  const base = { statut: 'archivé', sort_final: 'conservation', date_document: '2010-01-01', echeance: null, jours_restants: null };
  ok(versements.motifNonVersable(base, 'archives_publiques', { aujourdhui: '2026-10-27' }) === null, 'document de plus de 10 ans : versable aux archives publiques (art. 46)');
  ok(versements.motifNonVersable({ ...base, date_document: '2022-01-01' }, 'archives_publiques', { aujourdhui: '2026-10-27' }) === 'trop_recent', 'document récent : refusé aux archives publiques');
  ok(versements.motifNonVersable({ ...base, date_document: '2022-01-01' }, 'pre_archivage', { aujourdhui: '2026-10-27' }) === null, 'document récent : accepté au pré-archivage');
  ok(versements.motifNonVersable({ ...base, sort_final: 'elimination' }, 'archives_publiques', { aujourdhui: '2026-10-27' }) === 'sort_elimination', 'sort « élimination » : ne se verse pas');
  ok(versements.motifNonVersable({ ...base, statut: 'à indexer' }, 'pre_archivage') === 'statut', 'document en cours d\'indexation : non versable');
  const droits = { manage: true, validate: true };
  ok(!archivage.actionsPermises({ statut: 'valide', visa_requis: true }, 1, droits).executer
    && archivage.actionsPermises({ statut: 'valide', visa_requis: true }, 1, droits).transmettre
    && archivage.actionsPermises({ statut: 'vise', visa_requis: true }, 1, droits).executer
    && archivage.actionsPermises({ statut: 'valide', visa_requis: false }, 1, droits).executer, 'visa requis : exécution seulement une fois visé');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const roleService = require('./services/roleService');
    const partage = require('./services/partageService');
    const { addFileToDocument } = require('./services/documentIndexService');
    const s = Date.now();
    const tenant = async (nom) => (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`${nom} ${s}`, `${nom.toLowerCase()}-${s}`])).rows[0].id;
    const t = await tenant('Commune');
    await roleService.provisionRoles(t);
    const utilisateur = async (role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username",
      [t, `${nom.toLowerCase()}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const archi = await utilisateur('archiviste', 'Archi');
    const agent = await utilisateur('agent', 'Agent');
    const classe = async (nom, regle) => {
      const id = (await db.query('INSERT INTO metadata_schemas (tenant_id, name, is_default) VALUES ($1, $2, FALSE) RETURNING id', [t, nom])).rows[0].id;
      await archivage.definirDua(t, id, regle, archi);
      return id;
    };
    const naissances = await classe('Acte de naissance', { dua_annees: 10, dua_point_depart: 'date_document', sort_final: 'conservation', communicabilite: 'etat_civil' });
    const deliberations = await classe('Délibération', { dua_annees: 10, dua_point_depart: 'date_document', sort_final: 'conservation', communicabilite: 'libre' });
    ok((await db.query('SELECT communicabilite FROM metadata_schemas WHERE id = $1', [naissances])).rows[0].communicabilite === 'etat_civil', 'communicabilité réglée sur la classe');
    ok((await attendreErreur(() => archivage.definirDua(t, deliberations, { dua_annees: 10, sort_final: 'conservation', communicabilite: 'secret' }, archi)))?.status === 400, 'catégorie de communicabilité inconnue : refusée');
    let n = 0;
    const nouveau = async (cls, date, statut = 'archivé') => {
      const id = (await db.query(
        `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by, classe_id, date_document)
         VALUES ($1, $2, 'D', 'A', 'Commune', 2000, $3, $4, $5, $6) RETURNING id`, [t, `BJ-${s}-${++n}`, statut, archi.id, cls, date])).rows[0].id;
      const nom = `bj${s}-${n}.txt`;
      fs.writeFileSync(path.join(FILES_DIR, nom), `Pièce ${n}`);
      await addFileToDocument(t, id, archi.id, { path: path.join(FILES_DIR, nom), filename: nom, originalname: `piece-${n}.txt`, mimetype: 'text/plain', size: 8 });
      return id;
    };
    const acte1998 = await nouveau(naissances, '1998-03-14');
    const acte2001 = await nouveau(naissances, '2001-07-09');
    const delib2024 = await nouveau(deliberations, '2024-02-01');
    const enCours = await nouveau(deliberations, '2010-01-01', 'à indexer');

    // --- Communicabilité et partage public ------------------------------------
    const etat = await communicabilite.etatDocument(t, acte1998);
    ok(!etat.communicable && etat.a_partir_du === '2098-03-14', 'acte de naissance de 1998 : communicable au public en 2098');
    const refus = await attendreErreur(() => partage.creerPartage(t, acte1998, archi, { duree_jours: 7 }));
    ok(refus?.status === 403 && refus.code === 'NON_COMMUNICABLE', 'lien public vers un acte non communicable : refusé');
    const refusAgent = await attendreErreur(() => partage.creerPartage(t, acte1998, agent, { duree_jours: 7, autorisation_communication: 'Comité permanent, avis n° 4/2026' }));
    ok(refusAgent?.status === 403, 'autorisation saisie par un agent non habilité : refusée');
    const lien = await partage.creerPartage(t, acte1998, archi, { duree_jours: 7, autorisation_communication: 'Comité permanent, avis n° 4/2026' });
    ok(Boolean(lien.jeton), 'lien créé sur autorisation référencée');
    ok((await db.query("SELECT details_json FROM audit_logs WHERE tenant_id = $1 AND action = 'COMMUNICATION_ANTICIPEE'", [t])).rows[0]?.details_json?.autorisation === 'Comité permanent, avis n° 4/2026',
      'communication anticipée journalisée avec la référence de l\'autorisation');
    ok(Boolean((await partage.creerPartage(t, delib2024, archi, { duree_jours: 7 })).jeton), 'délibération (communication libre) : lien créé sans autorisation');
    ok((await archivage.echeanceDocument(t, acte1998)).communicabilite?.a_partir_du === '2098-03-14', 'fiche : la communicabilité est affichée');

    // --- Bordereau de versement ----------------------------------------------
    const cree = await versements.creer(t, {
      intitule: 'Registres de naissances 1998-2001', destination: 'archives_publiques',
      service_destinataire: 'Archives départementales', document_ids: [acte1998, acte2001, delib2024, enCours],
    }, archi);
    const vid = cree.versement.id;
    ok(cree.versement.numero.startsWith('BV-') && cree.ajoutes.length === 2 && cree.refuses.length === 2, 'bordereau de versement créé : 2 inscrits, 2 refusés et motivés');
    ok(cree.refuses.some((r) => r.id === delib2024 && /10 ans/.test(r.motif)) && cree.refuses.some((r) => r.id === enCours && /indexation/.test(r.motif)),
      'refus motivés : trop récent pour les archives publiques, indexation en cours');
    const autre = await versements.creer(t, { destination: 'pre_archivage', document_ids: [acte1998] }, archi);
    ok(autre.refuses[0]?.motif === versements.MOTIFS.autre_versement, 'un document ne figure que sur un bordereau en cours');
    await versements.annuler(t, autre.versement.id, { motif: 'Doublon' }, archi);
    await versements.transmettre(t, vid, archi);
    const transmis = await versements.detail(t, vid, archi);
    ok(transmis.statut === 'transmis' && transmis.empreinte && transmis.empreinte_conforme === true && transmis.totaux.dates_extremes?.debut === '1998-03-14',
      'transmis : liste figée, empreinte conforme, dates extrêmes calculées');
    ok((await attendreErreur(() => versements.ajouter(t, vid, [delib2024], archi)))?.status === 409, 'bordereau transmis : plus d\'ajout');
    ok((await attendreErreur(() => versements.priseEnCharge(t, vid, { recepisse_date: '2026-10-01' }, archi)))?.status === 400, 'prise en charge sans numéro de récépissé : refusée');
    await versements.priseEnCharge(t, vid, { recepisse_numero: 'AD/2026/118', recepisse_date: '2026-10-20', pris_en_charge_par_nom: 'M. Hounkpatin' }, archi);
    const verse = (await db.query('SELECT verse_at, verse_versement_id, statut FROM documents WHERE id = $1', [acte1998])).rows[0];
    ok(verse.verse_at && verse.verse_versement_id === vid && verse.statut === 'archivé', 'document versé : marqué, archivé, toujours consultable');
    ok((await db.query("SELECT decision FROM decisions_sort_final WHERE document_id = $1", [acte2001])).rows[0]?.decision === 'versement', 'versement aux archives publiques : vaut décision de sort final');
    ok((await attendreErreur(() => db.query("UPDATE bordereaux_versement SET intitule = 'retouché' WHERE id = $1", [vid]))) !== null, 'base : un bordereau pris en charge est inaltérable');
    ok((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'DOCUMENT_VERSE'", [t])).rows[0].n === 2, 'versements inscrits au journal chaîné');
    const encore = await versements.creer(t, { destination: 'pre_archivage', document_ids: [acte1998] }, archi);
    ok(encore.refuses[0]?.motif === versements.MOTIFS.verse, 'un document versé ne se reverse pas');

    const cx = await db.pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query("SET LOCAL docuflow.audit_override = 'on'");
      await cx.query("SET LOCAL docuflow.gel_override = 'on'");
      await cx.query('DELETE FROM tenants WHERE id = $1', [t]);
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { cx.release(); }
    await db.pool.end();
  }
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Archives du Bénin cohérentes — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
