// ============================================================================
// archivage.test.js — archivage réglementaire (migration 032).
// 1. SANS BASE : calcul d'échéance selon le point de départ, règles DUA,
//    séparation des tâches.
// 2. AVEC BASE : DUA par classe, vue « sort final », gel juridique écarté,
//    bordereau (création, proposition, auto-validation refusée, rejet,
//    validation, exécution), pierre tombale (fichiers détruits, absente de la
//    corbeille, non restaurable), procès-verbal vérifiable, isolement.
// Exécution : npm run test:archivage
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'docuflow-archivage-'));
const { FILES_DIR } = require('./config/paths');
const archivage = require('./services/archivageService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

(async () => {
  console.log('\n1. Sans base');
  const doc = { date_document: '2010-03-15', created_at: '2012-01-01T10:00:00Z', archive_at: null };
  ok(String(archivage.departDua(doc, 'date_document').depart).startsWith('2010-03-15') && String(archivage.departDua(doc, 'creation').depart).startsWith('2012-01-01')
    && !archivage.departDua(doc, 'archivage').depart, 'point de départ : date du document, création, archivage (non archivé : pas de départ)');
  const e = archivage.calculerEcheance(doc, { dua_annees: 10, dua_point_depart: 'date_document' }, '2026-10-26');
  ok(e && String(e.echeance).startsWith('2020-03-15'), 'échéance = départ + DUA');
  ok((() => { try { archivage.validerRegle({ dua_annees: 5 }); return false; } catch (err) { return err.status === 400; } })(), 'DUA sans sort final : refusée');
  const droits = { manage: true, validate: true };
  const b = { statut: 'propose', created_by: 1, propose_par: 1 };
  ok(!archivage.actionsPermises(b, 1, droits).valider && archivage.actionsPermises(b, 2, droits).valider, 'séparation des tâches : l\'auteur ne valide pas son bordereau');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const roleService = require('./services/roleService');
    const integrite = require('./services/integriteService');
    const { addFileToDocument } = require('./services/documentIndexService');
    const s = Date.now();
    const tenant = async (nom) => (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`${nom} ${s}`, `${nom.toLowerCase()}-${s}`])).rows[0].id;
    const t = await tenant('Arch');
    const t2 = await tenant('Ailleurs');
    await roleService.provisionRoles(t);
    await roleService.provisionRoles(t2);
    const utilisateur = async (tid, role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username",
      [tid, `${nom.toLowerCase()}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const archi = await utilisateur(t, 'archiviste', 'Archi');
    const resp = await utilisateur(t, 'responsable', 'Resp');
    const autre = await utilisateur(t2, 'admin', 'Autre');
    const classeElim = (await db.query("INSERT INTO metadata_schemas (tenant_id, name, is_default) VALUES ($1, 'Bon de commande', FALSE) RETURNING id", [t])).rows[0].id;
    const classeConserv = (await db.query("INSERT INTO metadata_schemas (tenant_id, name, is_default) VALUES ($1, 'Délibération', FALSE) RETURNING id", [t])).rows[0].id;
    await archivage.definirDua(t, classeElim, { dua_annees: 5, dua_point_depart: 'date_document', sort_final: 'elimination', dua_reference: 'Tableau de gestion, ligne 12' }, archi);
    await archivage.definirDua(t, classeConserv, { dua_annees: 10, dua_point_depart: 'date_document', sort_final: 'conservation' }, archi);
    let n = 0;
    const nouveau = async (classe, date, contenu) => {
      const id = (await db.query(
        `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by, classe_id, date_document)
         VALUES ($1, $2, 'D', 'A', 'Fournisseur', 2015, 'disponible', $3, $4, $5) RETURNING id`, [t, `A-${s}-${++n}`, archi.id, classe, date])).rows[0].id;
      const nom = `a${s}-${n}.txt`;
      fs.writeFileSync(path.join(FILES_DIR, nom), contenu);
      await addFileToDocument(t, id, archi.id, { path: path.join(FILES_DIR, nom), filename: nom, originalname: `bon-${n}.txt`, mimetype: 'text/plain', size: contenu.length });
      return { id, fichier: path.join(FILES_DIR, nom) };
    };
    const vieux1 = await nouveau(classeElim, '2015-01-10', 'Bon 1');
    const vieux2 = await nouveau(classeElim, '2016-02-11', 'Bon 2');
    const gele = await nouveau(classeElim, '2014-05-01', 'Bon gelé');
    const recent = await nouveau(classeElim, '2025-06-01', 'Bon récent');
    const delib = await nouveau(classeConserv, '2010-01-01', 'Délibération');
    await integrite.poserGel(t, gele.id, { motif: 'Contrôle fiscal' }, archi);

    // --- Sort final -----------------------------------------------------------
    const vue = await archivage.vueSortFinal(t, archi, { horizon: 0 });
    const lignes = vue.groupes.flatMap((g) => g.documents);
    ok(vue.resume.a_eliminer === 3 && vue.resume.a_verser === 1, 'échus : 3 à éliminer (dont 1 gelé), 1 à verser');
    ok(!lignes.some((l) => l.id === recent.id), 'document dont la DUA court encore : absent');
    ok(lignes.find((l) => l.id === gele.id)?.eligible === false && /gel/i.test(lignes.find((l) => l.id === gele.id).motif || ''), 'document gelé : non éligible, motif affiché');
    ok((await archivage.echeanceDocument(t, vieux1.id)).echu === true, 'fiche : échéance atteinte signalée');

    // --- Bordereau -----------------------------------------------------------
    const cree = await archivage.creerBordereau(t, { intitule: 'Bons de commande 2015-2016', document_ids: [vieux1.id, vieux2.id, gele.id, recent.id] }, archi);
    const bid = cree.bordereau.id;
    ok(cree.bordereau.numero.startsWith('BE-') && cree.ajoutes.length === 2, 'bordereau créé : seuls les documents éligibles inscrits (gelé et non échu écartés)');
    await archivage.proposer(t, bid, archi);
    ok((await attendreErreur(() => archivage.valider(t, bid, archi)))?.status === 403, 'l\'archiviste ne valide pas son propre bordereau');
    ok((await attendreErreur(() => archivage.rejeter(t, bid, resp, '')))?.status === 400, 'rejet sans motif : refusé');
    await archivage.rejeter(t, bid, resp, 'Vérifier le bon 2 : litige en cours ?');
    ok((await archivage.detailBordereau(t, bid, archi)).statut === 'rejete', 'bordereau rejeté');
    await archivage.reprendre(t, bid, archi);
    await archivage.proposer(t, bid, archi);
    await archivage.valider(t, bid, resp);
    ok((await archivage.detailBordereau(t, bid, resp)).statut === 'valide', 'validé par un autre que le proposant');

    // --- Visa de l'autorité d'archives (décret n° 2007-532, art. 44) ---------
    ok((await attendreErreur(() => archivage.executer(t, bid, archi, { mode_destruction: 'sur_place' })))?.status === 409, 'sans visa de la DAN : exécution refusée');
    await archivage.transmettre(t, bid, archi);
    const transmis = await archivage.detailBordereau(t, bid, archi);
    ok(transmis.statut === 'transmis' && /Archives Nationales/.test(transmis.visa_autorite || '') && transmis.actions.saisir_visa, 'bordereau transmis à la DAN, en attente de visa');
    ok((await attendreErreur(() => archivage.enregistrerVisa(t, bid, { decision: 'refuse', numero: 'V-1', date: '2026-01-05' }, archi)))?.status === 400, 'refus de visa sans observations : refusé');
    await archivage.enregistrerVisa(t, bid, { decision: 'refuse', numero: 'DAN/2026/011', date: '2026-01-05', observations: 'Bon 2 lié à un marché en cours.' }, archi);
    const refuse = await archivage.detailBordereau(t, bid, archi);
    ok(refuse.statut === 'rejete' && /Visa refusé/.test(refuse.motif_rejet || ''), 'visa refusé : bordereau rejeté, motif de l\'autorité conservé');
    await archivage.reprendre(t, bid, archi);
    await archivage.proposer(t, bid, archi);
    await archivage.valider(t, bid, resp);
    await archivage.transmettre(t, bid, archi);
    ok((await attendreErreur(() => archivage.enregistrerVisa(t, bid, { decision: 'partiel', numero: 'V', date: '2999-01-01', exclus: [vieux2.id] }, archi)))?.status === 400, 'visa daté du futur : refusé');
    await archivage.enregistrerVisa(t, bid, { decision: 'partiel', numero: 'DAN/2026/014', date: '2026-02-10', observations: 'Bon 2 à conserver.', exclus: [vieux2.id] }, archi);
    const vise = await archivage.detailBordereau(t, bid, archi);
    ok(vise.statut === 'vise' && vise.lignes.find((l) => l.document_id === vieux2.id)?.exclu_visa, 'visa partiel : bordereau visé, le bon 2 exclu');
    ok((await attendreErreur(() => archivage.executer(t, bid, archi, {})))?.status === 400, 'exécution sans mode de destruction : refusée');
    ok((await attendreErreur(() => archivage.executer(t, bid, archi, { mode_destruction: 'prestataire' })))?.status === 400, 'destruction par prestataire sans nom : refusée');

    const res = await archivage.executer(t, bid, archi, { mode_destruction: 'prestataire', prestataire: 'Broyage Bénin SARL', controle_par: 'M. Agent DAN' });
    ok(res.elimines.length === 1 && !fs.existsSync(vieux1.fichier) && fs.existsSync(vieux2.fichier), 'exécution : seul le document visé est éliminé, l\'exclu reste intact');
    ok(res.ecartes.some((e) => e.document_id === vieux2.id && /visa/.test(e.motif)), 'le document exclu par la DAN est écarté, motif inscrit');
    const tombe = (await db.query('SELECT elimine_at, deleted_at, elimine_bordereau_id FROM documents WHERE id = $1', [vieux1.id])).rows[0];
    ok(tombe.elimine_at && tombe.deleted_at && tombe.elimine_bordereau_id === bid, 'pierre tombale : la ligne reste, marquée éliminée');
    ok((await db.query('SELECT count(*)::int AS n FROM document_files WHERE document_id = $1', [vieux1.id])).rows[0].n === 0, 'plus aucune version en base');
    ok((await attendreErreur(() => db.query('UPDATE documents SET deleted_at = NULL WHERE id = $1', [vieux1.id]))) !== null, 'base : un document éliminé ne se restaure pas');
    ok((await attendreErreur(() => db.query("UPDATE bordereaux_elimination SET intitule = 'retouché' WHERE id = $1", [bid]))) !== null, 'base : un bordereau exécuté est inaltérable');
    const corbeille = await db.query('SELECT id FROM documents WHERE tenant_id = $1 AND deleted_at IS NOT NULL AND elimine_at IS NULL', [t]);
    ok(!corbeille.rows.some((r) => r.id === vieux1.id), 'un document éliminé n\'apparaît pas dans la corbeille');
    ok(fs.existsSync(gele.fichier), 'le document gelé est intact');

    // --- Procès-verbal ------------------------------------------------------
    const pv = await archivage.procesVerbal(t, bid, archi);
    ok(pv.totaux.elimines === 1 && pv.empreinte.conforme === true && pv.lignes.every((l) => l.masque || (l.fichiers || []).every((f) => f.empreinte_sha256)),
      'procès-verbal : 1 éliminé, empreintes des fichiers détruits, empreinte du PV conforme');
    ok(pv.bordereau.visa_numero === 'DAN/2026/014' && pv.bordereau.prestataire === 'Broyage Bénin SARL'
      && archivage.corpsPv(pv.bordereau, []).visa?.numero === 'DAN/2026/014' && archivage.corpsPv(pv.bordereau, []).destruction?.mode === 'prestataire',
      'procès-verbal : visa de la DAN et mode de destruction couverts par l\'empreinte');
    ok(!('visa' in archivage.corpsPv({ numero: 'BE-1' }, [])), 'PV antérieur à la 036 : contenu (et empreinte) inchangé');
    ok((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'DOCUMENT_ELIMINE'", [t])).rows[0].n === 1, 'élimination inscrite au journal chaîné');
    ok((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action IN ('ELIMINATION_TRANSMISE', 'VISA_ELIMINATION_REFUSE', 'VISA_ELIMINATION_ACCORDE')", [t])).rows[0].n === 4, 'transmissions et visas journalisés');
    ok((await integrite.verifierJournal(t)).integre, 'journal chaîné intègre après l\'élimination');

    // --- Conservation, isolement ---------------------------------------------
    await archivage.decider(t, [delib.id], { decision: 'versement', note: 'Versement aux archives définitives' }, archi);
    ok((await archivage.vueSortFinal(t, archi, { horizon: 0 })).resume.a_verser === 0, 'versement décidé : sort de la liste à traiter');
    ok((await attendreErreur(() => archivage.detailBordereau(t2, bid, autre)))?.status === 404 && (await archivage.listerBordereaux(t2)).length === 0, 'autre organisation : rien de visible');

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
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Archivage cohérent — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
